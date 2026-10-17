/**
* hooks/useWebRTCMonitor.ts — WebRTC Monitoring Hook (Manager side)
*
* Implements the complete WebRTC connection lifecycle for the Manager:
*
*  1. Connect WebSocket to /ws/signal
*  2. Send AUTH message (sessionId + webrtcToken + userJwt)
*  3. Receive AUTHENTICATED → receive TURN credentials
*  4. Wait for PEER_READY (agent has joined)
*  5. Receive OFFER from agent
*  6. Create RTCPeerConnection with TURN/STUN config
*  7. Set remote description (agent's offer)
*  8. Create answer
*  9. Set local description
* 10. Send ANSWER via WebSocket
* 11. Exchange ICE candidates (both directions)
* 12. Connection state → 'connected'
* 13. ontrack fires → set video.srcObject to remote stream
*
* SECURITY:
* - webrtcToken is fetched from the backend (never from localStorage)
* - userJwt is the current access token (from authStore)
* - Only an authenticated, MFA-verified manager can connect
* - The WebSocket server verifies identity from the JWT (not from client claim)
*/

import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting_for_agent'
  | 'negotiating'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'ended';

export interface UseWebRTCMonitorOptions {
  /** Backend session ID from POST /api/sessions */
  sessionId: string;
  /** Short-lived WebRTC token returned by POST /api/sessions */
  webrtcToken: string;
  /** Current user's access JWT (from authStore) */
  userJwt: string;
  /** Backend WebSocket URL — defaults to same host */
  wsUrl?: string;
}

export interface UseWebRTCMonitorResult {
  status: ConnectionStatus;
  remoteStream: MediaStream | null;
  connectionError: string | null;
  disconnect: () => void;
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export function useWebRTCMonitor({
  sessionId,
  webrtcToken,
  userJwt,
  wsUrl,
}: UseWebRTCMonitorOptions): UseWebRTCMonitorResult {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const cleanedUpRef = useRef(false);

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const cleanup = useCallback((reason?: string) => {
    if (cleanedUpRef.current) return;
    cleanedUpRef.current = true;

    if (reason) {
      console.info(`[WebRTC] Cleanup: ${reason}`);
    }

    // Close WebSocket
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'END_SESSION' })); } catch { /* ignore */ }
      ws.close(1000, 'Monitor stopped');
    }
    wsRef.current = null;

    // Close peer connection
    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pcRef.current = null;

    // Release stream
    setRemoteStream(null);
  }, []);

  const disconnect = useCallback(() => {
    setStatus('ended');
    cleanup('manual disconnect');
  }, [cleanup]);

  // ── Main Effect ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId || !webrtcToken || !userJwt) return;

    cleanedUpRef.current = false;
    iceQueueRef.current = [];

    const resolvedWsUrl = wsUrl ?? import.meta.env.VITE_WS_URL ??
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/signal`;

    setStatus('connecting');
    setConnectionError(null);

    // ── 1. Open WebSocket ──────────────────────────────────────────────────

    const ws = new WebSocket(resolvedWsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // ── 2. Send AUTH ─────────────────────────────────────────────────────
      ws.send(JSON.stringify({
        type: 'AUTH',
        sessionId,
        token: webrtcToken,
        authToken: userJwt,
        role: 'MANAGER',
      }));
    };

    ws.onerror = (ev) => {
      console.error('[WebRTC] WebSocket error', ev);
      setConnectionError('WebSocket connection failed');
      setStatus('failed');
      cleanup('ws error');
    };

    ws.onclose = (ev) => {
      if (!cleanedUpRef.current && status !== 'ended') {
        console.warn(`[WebRTC] WebSocket closed: ${ev.code} ${ev.reason}`);
        if (ev.code === 4010 || ev.code === 4011) {
          setConnectionError('Authentication failed — please log in again');
        } else if (ev.code !== 1000) {
          setConnectionError(`Connection lost (${ev.code})`);
          setStatus('disconnected');
        }
      }
    };

    // ── 3. Handle signaling messages ──────────────────────────────────────

    ws.onmessage = async (event: MessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string) as Record<string, unknown>;
      } catch {
        console.warn('[WebRTC] Received non-JSON message');
        return;
      }

      const type = msg['type'] as string;

      switch (type) {
        case 'AUTHENTICATED': {
          // ── 3. Got TURN credentials ──────────────────────────────────────
          const turnServers = (msg['turnServers'] as RTCIceServer[] | undefined) ?? [];
          const iceServers: RTCIceServer[] = [
            { urls: DEFAULT_STUN },
            ...turnServers,
          ];

          // ── 6. Create RTCPeerConnection ──────────────────────────────────
          const pc = new RTCPeerConnection({ iceServers });
          pcRef.current = pc;

          pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.info(`[WebRTC] Connection state: ${state}`);
            if (state === 'connected') {
              setStatus('connected');
            } else if (state === 'disconnected') {
              setStatus('disconnected');
            } else if (state === 'failed') {
              setConnectionError('WebRTC connection failed — check STUN/TURN config');
              setStatus('failed');
              cleanup('pc failed');
            } else if (state === 'closed') {
              setStatus('ended');
            }
          };

          // ── 11. Send ICE candidates to agent ──────────────────────────────
          pc.onicecandidate = (ev) => {
            if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'ICE_CANDIDATE',
                candidate: ev.candidate.toJSON(),
              }));
            }
          };

          // ── 13. Receive remote stream ─────────────────────────────────────
          pc.ontrack = (ev) => {
            console.info('[WebRTC] Remote track received', ev.track.kind);
            if (ev.streams[0]) {
              setRemoteStream(ev.streams[0]);
              setStatus('connected');
            }
          };

          setStatus('waiting_for_agent');
          break;
        }

        case 'PEER_READY': {
          // Agent has joined — waiting for them to send an offer
          setStatus('negotiating');
          console.info('[WebRTC] Peer ready — waiting for offer');
          break;
        }

        case 'OFFER': {
          // ── 5. Agent sent an offer ────────────────────────────────────────
          const pc = pcRef.current;
          if (!pc) break;

          setStatus('negotiating');
          const sdp = msg['sdp'] as RTCSessionDescriptionInit;

          // ── 7. Set remote description ──────────────────────────────────────
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));

          // Drain queued ICE candidates
          for (const candidate of iceQueueRef.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* skip */ }
          }
          iceQueueRef.current = [];

          // ── 8. Create answer ───────────────────────────────────────────────
          const answer = await pc.createAnswer();

          // ── 9. Set local description ──────────────────────────────────────
          await pc.setLocalDescription(answer);

          // ── 10. Send ANSWER ────────────────────────────────────────────────
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'ANSWER',
              sdp: answer,
            }));
          }
          break;
        }

        case 'ICE_CANDIDATE': {
          // ── 11. Agent sent ICE candidates ─────────────────────────────────
          const candidate = msg['candidate'] as RTCIceCandidateInit;
          const pc = pcRef.current;

          if (pc && pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* skip */ }
          } else {
            // Queue until remote description is set
            iceQueueRef.current.push(candidate);
          }
          break;
        }

        case 'PEER_DISCONNECTED': {
          console.warn('[WebRTC] Agent disconnected');
          setConnectionError('Agent disconnected');
          setStatus('disconnected');
          break;
        }

        case 'ERROR': {
          const errorMsg = msg['error'] as string;
          console.error('[WebRTC] Server error:', errorMsg);
          setConnectionError(errorMsg);
          setStatus('failed');
          break;
        }
      }
    };

    return () => {
      cleanup('component unmount');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, webrtcToken, userJwt]);

  return { status, remoteStream, connectionError, disconnect };
}
