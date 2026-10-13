# Deployment Guide

## Local development

```bash
npm install
npm run dev
```

## Infrastructure

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Production notes

- Run behind HTTPS and a reverse proxy.
- Keep secrets in environment variables only.
- Use Postgres and Redis managed services where possible.
- Restrict the WebRTC TURN/STUN configuration to authorized infrastructure.
- Expose only the required ports, with internal-only networking for the database and Redis services.

## Vercel frontend

Deploy only the Vite frontend to Vercel; the Express backend is a separate service.
For the npm workspace repository, set the Vercel Root Directory to the repository
root (`.`), use `npm ci` as the install command, and use
`npm run build --workspace=@agentwatch/frontend` as the build command. The output
directory is `packages/frontend/dist`. Select Node.js 24 to match the versions
resolved in the root workspace lockfile.

Set `VITE_API_URL` in Vercel's Production and Preview environments to the public
HTTPS API base URL, including `/api`. Set `VITE_WS_URL` to the public WSS signaling
URL, including `/ws/signal`. These values are embedded in the frontend bundle and
must not contain credentials. Configure backend secrets, PostgreSQL, Redis, Firebase,
and TURN credentials only in the backend hosting provider's environment settings.

Host the backend on a Node.js platform that supports persistent WebSocket
connections and can connect to the managed PostgreSQL and Redis services. A
serverless frontend deployment does not deploy or provide those backend services.
