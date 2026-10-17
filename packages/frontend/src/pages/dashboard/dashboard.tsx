import { AppLayout } from '../../components/AppLayout';
import { mockAgents, mockSecurityEvents, mockSessions, statCards } from '../../data/mockData';

export function DashboardPage() {
  return (
    <AppLayout>
      <section className="stats-grid">
        {statCards.map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-label">{stat.label}</div>
            <div className={`stat-value ${stat.tone}`}>{stat.value}</div>
          </div>
        ))}
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Workforce</p>
              <h2>Recent monitoring sessions</h2>
            </div>
          </div>

          <div className="table-wrap mini-table">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Device</th>
                  <th>Manager</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {mockSessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.agent}</td>
                    <td>{session.device}</td>
                    <td>{session.manager}</td>
                    <td>{session.started}</td>
                    <td>{session.duration}</td>
                    <td><span className={`status-pill ${session.status.toLowerCase()}`}>{session.status}</span></td>
                    <td><a className="link-btn" href={`/monitor/${session.id}`}>View</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Threat watch</p>
              <h2>Recent security events</h2>
            </div>
          </div>

          <div className="activity-list">
            {mockSecurityEvents.map((event) => (
              <div key={event.title} className="activity-item">
                <div>
                  <strong>{event.title}</strong>
                  <div className="muted">{event.time}</div>
                </div>
                <span className={`status-pill ${event.severity.toLowerCase()}`}>{event.severity}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel margin-top">
        <div className="section-head">
          <div>
            <p className="eyebrow">Authorized agents</p>
            <h2>Live agent roster</h2>
          </div>
        </div>

        <div className="agent-list">
          {mockAgents.map((agent) => (
            <div className="agent-card" key={agent.id}>
              <div className="agent-top">
                <strong>{agent.name}</strong>
                <span className={`status-pill ${agent.status.toLowerCase()}`}>{agent.status}</span>
              </div>
              <div className="agent-details">
                <div>Department: {agent.department}</div>
                <div>PC: {agent.device}</div>
                <div>Last seen: {agent.lastSeen}</div>
              </div>
              <div className="card-actions">
                <a className="primary-btn small-btn" href={`/agents/${agent.id}`}>View</a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppLayout>
  );
}
