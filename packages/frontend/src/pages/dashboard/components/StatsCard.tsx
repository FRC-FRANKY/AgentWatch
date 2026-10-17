type StatsCardProps = {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'info' | 'neutral';
};

export function StatsCard({ label, value, tone = 'info' }: StatsCardProps) {
  return (
    <article className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
    </article>
  );
}
