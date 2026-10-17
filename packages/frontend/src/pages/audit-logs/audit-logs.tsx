import { AppLayout } from '../../components/AppLayout';
import { mockAuditLogs } from '../../data/mockData';

export function AuditLogsPage() {
  return (
    <AppLayout>
      <section className="table-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Security operations</p>
            <h2>Audit Logs</h2>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {mockAuditLogs.map((entry, index) => (
                <tr key={`${entry.timestamp}-${index}`}>
                  <td>{entry.timestamp}</td>
                  <td>{entry.user}</td>
                  <td>{entry.action}</td>
                  <td>{entry.target}</td>
                  <td>{entry.ip}</td>
                  <td>{entry.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppLayout>
  );
}
