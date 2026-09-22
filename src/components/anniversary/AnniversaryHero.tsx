"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowDown, Pause, Play, RotateCcw } from "lucide-react";
import { AnniversaryArt } from "./AnniversaryArt";
import {
  anniversaryFrame,
  ANNIVERSARY_DURATION_MS,
  ANNIVERSARY_SCENES,
  type AnniversaryFrame,
} from "./timeline";
import { anniversaryStyles } from "./palette";
import styles from "./AnniversaryHero.module.css";

const captions = [
  "想象开花 / ACGN",
  "观察与演算 / SCIENCE + AI",
  "理解彼此 / HUMANITIES",
  "未来，继续 / DARWIN",
];
function subscribeMotion(listener: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
const initialFrame = anniversaryFrame(0);
const finalFrame = anniversaryFrame(ANNIVERSARY_DURATION_MS);
function paintStyles(element: HTMLElement, frame: AnniversaryFrame) {
  for (const [property, value] of Object.entries(anniversaryStyles(frame))) {
    element.style.setProperty(property, value);
  }
}
export function AnniversaryHero({
  slogan,
  name = "Darwin动漫社",
  description,
}: {
  slogan: string;
  name?: string;
  description?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const elapsed = useRef(0);
  const committedFrameKey = useRef("0:0");
  const [frame, setFrame] = useState<AnniversaryFrame>(initialFrame);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [assets, setAssets] = useState<Record<string, boolean>>({});
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const pageVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
  const ready = Boolean(assets.spray && assets.cluster && assets.archive);
  const shown = reduced ? finalFrame : frame;
  const running =
    ready && !paused && visible && pageVisible && !reduced && !shown.finished;
  const settleAsset = useCallback(
    (key: string) =>
      setAssets((current) =>
        current[key] ? current : { ...current, [key]: true },
      ),
    [],
  );
  const paint = useCallback((time: number) => {
    const next = anniversaryFrame(time);
    const key = `${next.from}:${next.to}`;
    if (committedFrameKey.current !== key) {
      // Keep the previous visual frame intact until React has committed the
      // scene visibility. Resetting phase first would revive the leaving scene.
      setFrame(next);
      return;
    }
    if (root.current) paintStyles(root.current, next);
  }, []);
  useLayoutEffect(() => {
    // Scene attributes and their phase/colours must reach the screen together.
    if (root.current) paintStyles(root.current, shown);
    committedFrameKey.current = `${frame.from}:${frame.to}`;
  }, [frame, shown]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (reduced) {
      elapsed.current = ANNIVERSARY_DURATION_MS;
      paint(elapsed.current);
      return;
    }
    if (!running) return;
    let request = 0;
    let previous: number | undefined;
    function tick(now: number) {
      if (previous !== undefined)
        elapsed.current = Math.min(
          ANNIVERSARY_DURATION_MS,
          elapsed.current + Math.min(now - previous, 100),
        );
      previous = now;
      paint(elapsed.current);
      if (elapsed.current < ANNIVERSARY_DURATION_MS)
        request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [running, reduced, paint]);
  function replay() {
    elapsed.current = 0;
    setPaused(false);
    paint(0);
  }
  const standardSlogan = slogan === "用科学与人文创造幻想中的未来";
  return (
    <section
      ref={root}
      className={styles.hero}
      data-edition="anniversary-9"
      data-scene={ANNIVERSARY_SCENES[shown.from]}
      data-transitioning={shown.from !== shown.to}
      data-running={running}
      data-finished={shown.finished}
      data-ready={ready}
      aria-label="社团九周年"
    >
      <div className={styles.grid} aria-hidden="true" />
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <div className={styles.eyebrow}>
            <span />
            {name}
            <i />
            9TH ANNIVERSARY
          </div>
          <h1 className={!standardSlogan ? styles.customSlogan : undefined}>
            {standardSlogan ? (
              <>
                用科学与人文
                <br />
                <span>创造幻想中的未来</span>
              </>
            ) : (
              slogan
            )}
          </h1>
          <p>
            {description ||
              "在动画与科学之间，在理性与想象之间。记录我们的观察、思考，以及尚未发生的可能。"}
          </p>
          <a href="#journal" className={styles.explore}>
            开始探索
            <ArrowDown size={17} />
          </a>
          <div className={styles.subjects}>
            ACGN
            <span />
            SCIENCE
            <span />
            HUMANITIES
            <span />
            AI
          </div>
        </div>
        <div
          className={styles.figure}
          role="group"
          aria-label="九周年主视觉：花卉动漫、科学与AI、人文、现代四种风格的细线数字9"
        >
          <AnniversaryArt frame={shown} onAssetSettled={settleAsset} />
          <div className={styles.caption}>
            <span>{captions[shown.to]}</span>
            {!reduced && (
              <button
                type="button"
                onClick={
                  shown.finished ? replay : () => setPaused((value) => !value)
                }
                disabled={!ready}
                aria-label={
                  shown.finished
                    ? "重播四幕周年动画"
                    : paused
                      ? "继续周年动画"
                      : "暂停周年动画"
                }
              >
                {shown.finished ? (
                  <RotateCcw size={13} />
                ) : paused ? (
                  <Play size={13} />
                ) : (
                  <Pause size={13} />
                )}
                <span>
                  {shown.finished ? "重播" : paused ? "继续" : "暂停"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className={styles.bottom}>
        <span>九年同行，想象未止。</span>
        <span>STAY CURIOUS. KEEP IMAGINING.</span>
      </div>
    </section>
  );
}
