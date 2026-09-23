import styles from "./MembersHall.module.css";

/** Quiet exhibition frames, drawn as part of the club's scientific-plate vocabulary. */
export function MembersHallArt() {
  return (
    <svg
      className={styles.diagram}
      viewBox="0 0 360 270"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="158"
        y="24"
        width="144"
        height="174"
        fill="var(--ice)"
        fillOpacity="0.13"
      />
      <g stroke="currentColor" strokeWidth="1">
        <path d="M24 236H336M44 224V248M316 224V248" opacity="0.25" />
        <rect x="40" y="76" width="134" height="160" opacity="0.22" />
        <rect x="158" y="24" width="144" height="174" opacity="0.4" />
        <rect
          x="96"
          y="48"
          width="144"
          height="176"
          fill="var(--paper)"
          fillOpacity="0.65"
          opacity="0.6"
        />
        <path d="M108 74V60H122M214 212H228V198" opacity="0.5" />
        <circle cx="168" cy="126" r="37" opacity="0.5" />
        <path
          d="M119 126H217M168 76V176M144 192H192M153 201H183"
          opacity="0.25"
        />
        <path d="M262 48H282M272 38V58M62 204H77" opacity="0.4" />
      </g>
      <circle cx="198" cy="104" r="3" fill="var(--blue)" fillOpacity="0.4" />
      <path
        d="M238 236H268"
        stroke="var(--deep)"
        strokeWidth="2"
        opacity="0.3"
      />
    </svg>
  );
}
