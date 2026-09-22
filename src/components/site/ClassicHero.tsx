"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, Pause, Play } from "lucide-react";
import styles from "./Hero.module.css";
export function ClassicHero({
  slogan,
  name = "Darwin动漫社",
  description,
}: {
  slogan: string;
  name?: string;
  description?: string;
}) {
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const media = window.matchMedia(
      "(hover: hover) and (prefers-reduced-motion: no-preference)",
    );
    const move = (e: PointerEvent) => {
      if (!media.matches || paused) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty(
        "--pointer-x",
        `${(e.clientX - r.left - r.width / 2) * 0.006}px`,
      );
      el.style.setProperty(
        "--pointer-y",
        `${(e.clientY - r.top - r.height / 2) * 0.009}px`,
      );
    };
    const reset = () => {
      el.style.setProperty("--pointer-x", "0px");
      el.style.setProperty("--pointer-y", "0px");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", reset);
    if (paused) reset();
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
    };
  }, [paused]);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    if (root.current) o.observe(root.current);
    return () => o.disconnect();
  }, []);
  const first = slogan === "用科学与人文创造幻想中的未来";
  return (
    <section
      ref={root}
      className={`${styles.hero} ${paused || !visible ? styles.paused : ""}`}
      aria-label="社团介绍"
    >
      <div className={styles.heroGrid} />
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <div className={styles.eyebrow}>
            <span />
            {name} / AN OPEN JOURNAL
          </div>
          <h1 className={!first ? styles.customSlogan : undefined}>
            {first ? (
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
            {description || (
              <>
                在动画与科学之间，在理性与想象之间。
                <br />
                记录我们的观察、思考，以及尚未发生的可能。
              </>
            )}
          </p>
          <a href="#journal" className={styles.explore}>
            开始探索
            <ArrowDown size={17} />
          </a>
          <div className={styles.subjects}>
            <span>ACGN</span>
            <i />
            SCIENCE
            <i />
            HUMANITIES
            <i />
            AI
          </div>
        </div>
        <div className={styles.figure}>
          <svg
            className={styles.drawing}
            viewBox="0 0 600 500"
            fill="none"
            role="img"
            aria-label="由轨道、波形与连接节点组成的科学图版"
          >
            <defs>
              <pattern
                id="dots"
                width="32"
                height="32"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1" cy="1" r="1" fill="#344F63" opacity=".22" />
              </pattern>
              <clipPath id="figureClip">
                <rect x="0" y="0" width="600" height="500" />
              </clipPath>
            </defs>
            <g clipPath="url(#figureClip)">
              <rect width="600" height="500" fill="url(#dots)" />
              <path d="M415-20h100L200 520H100Z" fill="#2454BD" opacity=".92" />
              <path d="M535-20h36L256 520h-36Z" fill="#88B8C7" opacity=".72" />
              <path
                d="M0 105H600M0 385H600M106 0V500M496 0V500"
                stroke="#748C97"
                strokeWidth=".6"
                opacity=".5"
              />
              <g className={styles.orbit}>
                <ellipse
                  cx="300"
                  cy="250"
                  rx="246"
                  ry="149"
                  transform="rotate(-32 300 250)"
                  stroke="#344F63"
                  strokeWidth="1"
                />
                <ellipse
                  cx="300"
                  cy="250"
                  rx="246"
                  ry="149"
                  transform="rotate(38 300 250)"
                  stroke="#667F9A"
                  strokeWidth="1"
                />
                <ellipse
                  cx="300"
                  cy="250"
                  rx="137"
                  ry="226"
                  transform="rotate(-12 300 250)"
                  stroke="#F1F0EA"
                  strokeWidth="1.2"
                />
                <circle
                  cx="504"
                  cy="110"
                  r="8"
                  fill="#F1F0EA"
                  stroke="#344F63"
                />
                <circle cx="128" cy="402" r="5" fill="#2454BD" />
              </g>
              <g className={styles.wave}>
                <path
                  d={Array.from({ length: 181 }, (_, i) => {
                    const t = (i / 180) * Math.PI * 2;
                    return `${i ? "L" : "M"}${(300 + 126 * Math.sin(3 * t + 0.7)).toFixed(3)},${(250 + 90 * Math.sin(2 * t)).toFixed(3)}`;
                  }).join(" ")}
                  stroke="#F1F0EA"
                  strokeWidth="2.4"
                />
                <path
                  d={Array.from({ length: 181 }, (_, i) => {
                    const t = (i / 180) * Math.PI * 2;
                    return `${i ? "L" : "M"}${(300 + 126 * Math.sin(3 * t + 1)).toFixed(3)},${(250 + 90 * Math.sin(2 * t)).toFixed(3)}`;
                  }).join(" ")}
                  stroke="#BBD8DE"
                  strokeWidth=".8"
                />
              </g>
              <g stroke="#344F63" strokeWidth="1">
                <path d="m72 152 97-61 92 43M169 91l17 93 75-50M450 322l68 52-94 59-34-70 60-41Z" />
                <path d="m424 433 26-111" />
              </g>
              {[
                [72, 152],
                [169, 91],
                [261, 134],
                [186, 184],
                [450, 322],
                [518, 374],
                [424, 433],
                [390, 363],
              ].map(([x, y], i) => (
                <rect
                  key={i}
                  x={x - 4}
                  y={y - 4}
                  width="8"
                  height="8"
                  fill={i % 2 ? "#2454BD" : "#344F63"}
                />
              ))}
              <g stroke="#344F63">
                <path d="M285 250h30m-15-15v30M95 105h22m-11-11v22M485 385h22m-11-11v22" />
                <circle cx="300" cy="250" r="18" />
              </g>
              <g
                fill="#344F63"
                fontFamily="monospace"
                fontSize="9"
                letterSpacing="1"
              >
                <text x="18" y="28">
                  FIG. 01 / IMAGINATION FIELD
                </text>
                <text x="18" y="46" fontSize="7">
                  x = sin(3t + φ) · y = sin(2t)
                </text>
                <text x="490" y="92">
                  [ X,Y ]
                </text>
                <text x="72" y="177">
                  NODE A
                </text>
                <text x="434" y="453">
                  NODE B
                </text>
                <text x="25" y="473">
                  OBSERVE / CONNECT / CREATE
                </text>
                <text x="527" y="474">
                  ∞
                </text>
              </g>
              <rect x="264" y="37" width="74" height="23" fill="#F1F0EA" />
              <text
                x="275"
                y="52"
                fill="#2454BD"
                fontFamily="monospace"
                fontSize="11"
              >
                φ = 0.7
              </text>
            </g>
          </svg>
          <div className={styles.figureCaption}>
            <span>图 01 / 想象的发生场</span>
            <button
              onClick={() => setPaused(!paused)}
              aria-label={paused ? "播放首屏动画" : "暂停首屏动画"}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
              <span>{paused ? "播放" : "暂停"}</span>
            </button>
          </div>
        </div>
      </div>
      <div className={styles.heroBottom}>
        <span>保持好奇 / STAY CURIOUS</span>
        <span>向下，发现新的连接 ↓</span>
      </div>
    </section>
  );
}
