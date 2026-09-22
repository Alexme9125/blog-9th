import Link from "next/link";
export function MissingPage() {
  return (
    <main
      id="main"
      className="container"
      style={{
        minHeight: "65vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        paddingBlock: 70,
      }}
    >
      <span className="eyebrow">OUTSIDE THE KNOWN COORDINATES</span>
      <span
        style={{
          font: "100px var(--serif)",
          color: "var(--mist)",
          lineHeight: 1.4,
        }}
      >
        404
      </span>
      <h1 style={{ font: "30px var(--serif)" }}>这条轨迹，暂时没有终点。</h1>
      <p className="muted" style={{ lineHeight: 1.9 }}>
        页面可能已移动，或还没有被创造。
        <br />
        回到熟悉的地方，开始新的探索。
      </p>
      <Link className="button secondary" href="/">
        回到首页 ↗
      </Link>
    </main>
  );
}
