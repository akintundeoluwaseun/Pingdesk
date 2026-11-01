export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton sk-eyebrow" />
      <div className="skeleton sk-title" />
      <div className="skeleton sk-line" />
      <div className="stats">
        <div className="skeleton sk-card" />
        <div className="skeleton sk-card" />
        <div className="skeleton sk-card" />
      </div>
      <div className="skeleton sk-panel" />
    </div>
  );
}
