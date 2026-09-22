import Image from "next/image";
import { useId } from "react";
import { NINE_PATH, type AnniversaryFrame } from "./timeline";
import styles from "./AnniversaryHero.module.css";

export function AnniversaryArt({
  frame,
  onAssetSettled,
}: {
  frame: AnniversaryFrame;
  onAssetSettled: (name: string) => void;
}) {
  const gradient = useId().replaceAll(":", "");
  function state(index: number) {
    if (frame.from === frame.to)
      return index === frame.from ? "active" : "hidden";
    return index === frame.from
      ? "leaving"
      : index === frame.to
        ? "arriving"
        : "hidden";
  }
  function photo(file: string, key: string) {
    return (
      <Image
        src={`/images/anniversary-9/${file}.webp`}
        width={1024}
        height={1024}
        alt=""
        unoptimized
        loading="eager"
        onLoad={() => onAssetSettled(key)}
        onError={() => onAssetSettled(key)}
      />
    );
  }
  return (
    <div className={styles.artboard} aria-hidden="true">
      <svg
        className={styles.construction}
        viewBox="0 0 600 500"
        fill="none"
        focusable="false"
      >
        <path d="M106 184H485M285 32V462M150 54H426V450H150V54Z" />
        <path d="M96 184h20m-10-10v20M475 184h20m-10-10v20M285 22v20m-10-10h20" />
        <circle cx="285" cy="184" r="143" strokeDasharray="2 10" />
      </svg>
      <div
        className={`${styles.scene} ${styles.botanical}`}
        data-state={state(0)}
      >
        <div className={`${styles.piece} ${styles.flowerTop}`}>
          <div className={styles.floating}>
            {photo("botanical-spray", "spray")}
          </div>
        </div>
        <div className={`${styles.piece} ${styles.flowerRight}`}>
          <div className={styles.floating}>
            {photo("botanical-cluster", "cluster")}
          </div>
        </div>
        <div className={`${styles.piece} ${styles.flowerFoot}`}>
          <div className={styles.floating}>
            {photo("botanical-spray", "spray")}
          </div>
        </div>
        <svg
          className={`${styles.piece} ${styles.storyboard}`}
          viewBox="0 0 140 110"
          fill="none"
          focusable="false"
        >
          <path
            d="M10 10H130V100H10Z"
            fill="#eff3ee"
            fillOpacity=".7"
            stroke="currentColor"
            strokeOpacity=".5"
          />
          <path
            d="M20 25H73V78H20ZM80 25H120V48H80ZM80 55H120V78H80Z"
            stroke="currentColor"
            strokeOpacity=".55"
          />
          <path
            d="m23 72 19-23 13 13 10-7 8 12M83 73l16-12 20 13M83 42l14-10 21 9"
            stroke="currentColor"
          />
          <circle cx="58" cy="39" r="5" stroke="currentColor" />
          <path
            d="M23 87H89M98 87H120"
            stroke="currentColor"
            strokeOpacity=".3"
          />
        </svg>
      </div>
      <div
        className={`${styles.scene} ${styles.scientific}`}
        data-state={state(1)}
      >
        <svg
          className={styles.scienceDrawing}
          viewBox="0 0 600 500"
          fill="none"
          focusable="false"
        >
          <g
            className={`${styles.piece} ${styles.scienceGrid}`}
            stroke="currentColor"
            strokeOpacity=".25"
            strokeWidth=".65"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <path
                key={i}
                d={`M${140 + i * 26} 44V370M128 ${60 + i * 26}H443`}
              />
            ))}
          </g>
          <g
            className={`${styles.piece} ${styles.scienceOrbit}`}
            stroke="currentColor"
          >
            <ellipse
              cx="285"
              cy="184"
              rx="171"
              ry="66"
              transform="rotate(-32 285 184)"
              strokeWidth="1"
            />
            <ellipse
              cx="285"
              cy="184"
              rx="141"
              ry="157"
              transform="rotate(26 285 184)"
              strokeWidth=".6"
              strokeDasharray="3 7"
            />
            <circle cx="139" cy="244" r="4" fill="var(--hero-background)" />
            <circle cx="422" cy="98" r="3" fill="currentColor" />
          </g>
          <g
            className={`${styles.piece} ${styles.neuralNet}`}
            stroke="currentColor"
            strokeWidth=".8"
          >
            <path d="m393 250 59 37-5 65-54 32-58-32 4-60 54-42Zm0 0v134m-54-92 108 60m5-65-117 65" />
            {[
              [393, 250],
              [452, 287],
              [447, 352],
              [393, 384],
              [335, 352],
              [339, 292],
            ].map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={i % 2 ? 3 : 5}
                fill="var(--hero-background)"
              />
            ))}
          </g>
          <g
            className={`${styles.piece} ${styles.scienceMeasure}`}
            stroke="currentColor"
            strokeWidth=".6"
          >
            <path d="M150 53H421M150 46v14m271-14v14M454 70V250m-7-180h14m-14 180h14M233 439l29-42" />
          </g>
        </svg>
      </div>
      <div
        className={`${styles.scene} ${styles.humanities}`}
        data-state={state(2)}
      >
        <div className={`${styles.piece} ${styles.archiveTop}`}>
          <div className={styles.floating}>
            {photo("archive-fragment", "archive")}
          </div>
        </div>
        <svg
          className={`${styles.piece} ${styles.folio}`}
          viewBox="0 0 170 190"
          fill="none"
          focusable="false"
        >
          <path
            d="m14 14 139 5 3 157-139-5Z"
            fill="#d4dfdf"
            stroke="#93a7ac"
            strokeWidth=".7"
          />
          <path
            d="m26 6 131 14-15 155L11 161Z"
            fill="#f1f0e9"
            stroke="#a8b2b0"
            strokeWidth=".7"
          />
          <path
            d="M42 120V68a36 36 0 0 1 72 0v52M52 120V70a26 26 0 0 1 52 0v50M36 120H121"
            stroke="#728b91"
          />
          <path d="m112 19 45 1-4 39Z" fill="#e0e5df" />
          <path d="M29 135H121M29 143H105" stroke="#9badae" strokeWidth=".6" />
        </svg>
        <svg
          className={`${styles.piece} ${styles.dialogue}`}
          viewBox="0 0 160 110"
          fill="none"
          focusable="false"
        >
          <path
            d="M10 10H150V100H10Z"
            fill="#e8ece7"
            stroke="#9cafb3"
            strokeWidth=".7"
          />
          <path d="M38 52h25v22H38Zm60-10h27v30H98Z" stroke="#728891" />
          <circle cx="49" cy="34" r="9" stroke="#728891" />
          <circle cx="111" cy="25" r="9" stroke="#728891" />
          <path
            d="m61 47 20 11 19-20M48 75v16m62-16v16M77 23H92M74 30H87"
            stroke="#728891"
          />
        </svg>
        <svg
          className={`${styles.piece} ${styles.paperThread}`}
          viewBox="0 0 600 500"
          fill="none"
          focusable="false"
        >
          <path
            d="M132 81C473 67 157 485 418 408"
            stroke="#849ba2"
            strokeWidth=".8"
            strokeDasharray="3 7"
          />
        </svg>
      </div>
      <svg
        className={styles.numeral}
        viewBox="0 0 600 500"
        fill="none"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={gradient}
            x1="170"
            y1="85"
            x2="385"
            y2="430"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--nine-main)" />
            <stop offset=".45" stopColor="var(--nine-light)" />
            <stop offset=".7" stopColor="var(--nine-main)" />
            <stop offset="1" stopColor="var(--nine-shadow)" />
          </linearGradient>
        </defs>
        <path
          d={NINE_PATH}
          stroke={`url(#${gradient})`}
          strokeWidth="12"
          strokeLinecap="butt"
        />
        <path
          className={styles.numeralHighlight}
          d={NINE_PATH}
          stroke="#d9e6e7"
          strokeWidth=".8"
          transform="translate(-2 -1)"
          opacity=".52"
        />
      </svg>
      <svg
        className={styles.transitionDrawing}
        viewBox="0 0 600 500"
        fill="none"
        focusable="false"
      >
        <g className={styles.transitionOrbit}>
          <circle cx="285" cy="184" r="143" />
          <path d="M154 53H416V315H154V53ZM100 184H470M285 0V410" />
        </g>
        <path d={NINE_PATH} strokeWidth="1" className={styles.traceNine} />
        <path className={styles.sweepLine} d="M155-90 462 510M128-90 435 510" />
      </svg>
      <div className={styles.anniversaryType}>
        <span>th</span>
        <span>Anniversary</span>
      </div>
    </div>
  );
}
