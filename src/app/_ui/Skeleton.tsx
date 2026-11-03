/* Loading states that hold the shape of the page they stand in for. A line drawn at a
   fixed width is capped at its column, so on a phone the shape reflows, not the page. */

export function DashboardSkeleton() {
  return (
    <div className="page reading" aria-busy="true" aria-label="Loading the dashboard">
      <div className="sk line" style={{ width: 360, maxWidth: "100%" }} />
      <div className="sk sk-hero" />
      <div className="sk sk-map" />
      <div className="sk sk-panel" />
      {[0, 1, 2].map((i) => (
        <div className="section" key={i}>
          <div className="sk line" style={{ width: 220, maxWidth: "100%", height: 20, marginBottom: 20 }} />
          {[0, 1, 2, 3].map((j) => (
            <div className="sk line" key={j} style={{ width: `${80 - j * 14}%`, marginBottom: 10 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="page reading" aria-busy="true" aria-label="Loading the review board">
      <div className="sk line" style={{ width: 240, maxWidth: "100%", height: 28, marginBottom: 12 }} />
      <div className="sk line" style={{ width: 320, maxWidth: "100%", marginBottom: 40 }} />
      {[0, 1, 2].map((i) => (
        <div className="sk line" key={i} style={{ width: `${70 - i * 10}%`, marginBottom: 14 }} />
      ))}
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading the grid">
      <div className="sk line" style={{ width: 200, maxWidth: "100%", height: 28, marginBottom: 24 }} />
      <div className="sk-rows" style={{ border: "1px solid var(--rule)", borderRadius: 6 }}>
        {Array.from({ length: 9 }, (_, i) => <div key={i} />)}
      </div>
    </div>
  );
}
