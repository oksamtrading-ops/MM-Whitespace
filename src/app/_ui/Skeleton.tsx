/* Loading states that hold the shape of the page they stand in for. */

export function DashboardSkeleton() {
  return (
    <div className="reading" aria-busy="true" aria-label="Loading the dashboard">
      <div className="sk line" style={{ width: 360 }} />
      <div className="sk sk-hero" />
      <div className="sk sk-map" />
      <div className="sk-ledger">
        {[0, 1, 2, 3].map((i) => <div className="sk fig" key={i} />)}
      </div>
      {[0, 1, 2].map((i) => (
        <div className="section" key={i}>
          <div className="sk line" style={{ width: 220, height: 20, marginBottom: 20 }} />
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
    <div className="reading" aria-busy="true" aria-label="Loading the review board">
      <div className="sk line" style={{ width: 240, height: 28, marginBottom: 12 }} />
      <div className="sk line" style={{ width: 320, marginBottom: 40 }} />
      {[0, 1, 2].map((i) => (
        <div className="sk line" key={i} style={{ width: `${70 - i * 10}%`, marginBottom: 14 }} />
      ))}
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the grid">
      <div className="sk line" style={{ width: 200, height: 28, marginBottom: 24 }} />
      <div className="sk-rows" style={{ border: "1px solid var(--rule)", borderRadius: 6 }}>
        {Array.from({ length: 9 }, (_, i) => <div key={i} />)}
      </div>
    </div>
  );
}
