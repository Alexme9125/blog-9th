"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="container empty-state">
      <h1>这一页暂时没有准备好。</h1>
      <p>连接可能暂时中断。你可以重试，或稍后回来。</p>
      <button className="button" onClick={reset}>
        重新加载
      </button>
    </main>
  );
}
