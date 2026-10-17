export type AgentStatus = 'Online' | 'Offline' | 'Monitoring';
export type DeviceStatus = 'Online' | 'Offline' | 'Disabled';
export type SessionStatus = 'Active' | 'Ended' | 'Queued';

export type AgentRecord = {
  id: string;
  name: string;
  department: string;
  device: string;
  status: AgentStatus;
  lastSeen: string;
  monitoring: string;
  assignedManager: string;
};

export type SecurityEvent = {
  title: string;
  severity: 'Warning' | 'Alert' | 'Critical';
  time: string;
};

export type SessionRecord = {
  id: string;
  manager: string;
  agent: string;
  device: string;
  reason: string;
  started: string;
  ended?: string;
  duration: string;
  status: SessionStatus;
};

export const mockAgents = [
  {
    id: 'AG-101',
    name: 'Juan Dela Cruz',
    department: 'Customer Support',
    device: 'PC-AGENT-001',
    status: 'Online' as AgentStatus,
    lastSeen: '2 minutes ago',
    monitoring: 'Not Monitoring',
    assignedManager: 'Maria Santos',
  },
  {
    id: 'AG-102',
    name: 'Alicia Gomez',
    department: 'Operations',
    device: 'OP-WS-014',
    status: 'Monitoring' as AgentStatus,
    lastSeen: 'Now',
    monitoring: 'Active',
    assignedManager: 'Maria Santos',
  },
  {
    id: 'AG-103',
    name: 'Nina Cruz',
    department: 'Engineering',
    device: 'ENG-WS-003',
    status: 'Offline' as AgentStatus,
    lastSeen: '12 minutes ago',
    monitoring: 'Not Monitoring',
    assignedManager: 'David Chen',
  },
  {
    id: 'AG-104',
    name: 'Marcus Lee',
    department: 'Finance',
    device: 'FIN-WS-009',
    status: 'Online' as AgentStatus,
    lastSeen: '1 minute ago',
    monitoring: 'Not Monitoring',
    assignedManager: 'Maria Santos',
  },
];

export const mockDevices = [
  {
    id: 'PC-AGENT-001',
    hostname: 'PC-AGENT-001',
    agent: 'Juan Dela Cruz',
    os: 'Windows 11',
    status: 'Online' as DeviceStatus,
    lastSeen: '30 seconds ago',
    clientVersion: 'v1.0.0',
    registrationDate: '2026-09-01',
    lastHeartbeat: '2026-09-27T10:30:00Z',
    credentialStatus: 'Verified',
    certificateStatus: 'Valid',
    lastAuth: '2026-09-27T10:30:11Z',
  },
  {
    id: 'OP-WS-014',
    hostname: 'OP-WS-014',
    agent: 'Alicia Gomez',
    os: 'Windows 11',
    status: 'Online' as DeviceStatus,
    lastSeen: '18 seconds ago',
    clientVersion: 'v1.0.0',
    registrationDate: '2026-08-15',
    lastHeartbeat: '2026-09-27T10:31:00Z',
    credentialStatus: 'Verified',
    certificateStatus: 'Valid',
    lastAuth: '2026-09-27T10:31:15Z',
  },
  {
    id: 'ENG-WS-003',
    hostname: 'ENG-WS-003',
    agent: 'Nina Cruz',
    os: 'Windows 10',
    status: 'Offline' as DeviceStatus,
    lastSeen: '11 minutes ago',
    clientVersion: 'v0.9.7',
    registrationDate: '2026-08-11',
    lastHeartbeat: '2026-09-27T10:20:00Z',
    credentialStatus: 'Expired',
    certificateStatus: 'Pending',
    lastAuth: '2026-09-27T10:20:40Z',
  },
];

export const mockSessions = [
  {
    id: 'MS-1001',
    manager: 'Maria Santos',
    agent: 'Juan Dela Cruz',
    device: 'PC-AGENT-001',
    reason: 'Operational supervision',
    started: '2026-09-27 09:15',
    ended: '2026-09-27 09:28',
    duration: '00:13:42',
    status: 'Ended' as SessionStatus,
  },
  {
    id: 'MS-1002',
    manager: 'David Chen',
    agent: 'Alicia Gomez',
    device: 'OP-WS-014',
    reason: 'Quality review',
    started: '2026-09-27 10:10',
    ended: '-',
    duration: '00:22:05',
    status: 'Active' as SessionStatus,
  },
  {
    id: 'MS-1003',
    manager: 'Maria Santos',
    agent: 'Marcus Lee',
    device: 'FIN-WS-009',
    reason: 'Compliance walkthrough',
    started: '2026-09-27 08:30',
    ended: '2026-09-27 08:40',
    duration: '00:10:00',
    status: 'Ended' as SessionStatus,
  },
];

export const mockAuditLogs = [
  { timestamp: '2026-09-27 10:31', user: 'Maria Santos', action: 'MONITORING_STARTED', target: 'PC-AGENT-001', ip: '10.0.0.24', result: 'SUCCESS' },
  { timestamp: '2026-09-27 10:20', user: 'David Chen', action: 'LOGIN', target: 'System', ip: '10.0.0.15', result: 'SUCCESS' },
  { timestamp: '2026-09-27 10:05', user: 'Juan Dela Cruz', action: 'FAILED_LOGIN', target: 'Portal', ip: '10.0.0.80', result: 'BLOCKED' },
  { timestamp: '2026-09-27 09:57', user: 'Maria Santos', action: 'ROLE_CHANGED', target: 'Alicia Gomez', ip: '10.0.0.24', result: 'SUCCESS' },
];

export const mockSecurityEvents = [
  { title: 'Suspicious login', severity: 'Warning', time: '2h ago' },
  { title: 'Permission denied', severity: 'Alert', time: '45m ago' },
  { title: 'Device authentication failure', severity: 'Critical', time: '18m ago' },
];

export const mockUsers = [
  { id: 'USR-100', name: 'Maria Santos', email: 'maria@agentwatch.local', role: 'Manager', department: 'Operations', status: 'Active', lastLogin: '2h ago' },
  { id: 'USR-101', name: 'David Chen', email: 'david@agentwatch.local', role: 'Team Leader', department: 'Engineering', status: 'Active', lastLogin: '1h ago' },
  { id: 'USR-102', name: 'Nina Cruz', email: 'nina@agentwatch.local', role: 'Agent', department: 'Engineering', status: 'Active', lastLogin: '15m ago' },
  { id: 'USR-103', name: 'Alicia Gomez', email: 'alicia@agentwatch.local', role: 'Agent', department: 'Operations', status: 'Active', lastLogin: '8m ago' },
];

export const mockRoles = [
  { name: 'ADMIN', permissions: ['users.read', 'users.create', 'security.manage', 'audit.read'] },
  { name: 'MANAGER', permissions: ['agents.read', 'sessions.create', 'sessions.read', 'audit.read'] },
  { name: 'TEAM_LEADER', permissions: ['agents.read', 'devices.read', 'sessions.read'] },
  { name: 'IT_SUPPORT', permissions: ['devices.read', 'devices.register', 'security.read'] },
  { name: 'AGENT', permissions: ['agents.read'] },
];

export const statCards = [
  { label: 'Online agents', value: '18', tone: 'success' },
  { label: 'Offline agents', value: '2', tone: 'neutral' },
  { label: 'Active monitoring', value: '3', tone: 'info' },
  { label: 'Security events', value: '1', tone: 'warning' },
];

export const dashboardSummary = {
  onlineAgents: 18,
  offlineAgents: 2,
  activeMonitoring: 3,
  securityEvents: 1,
};
