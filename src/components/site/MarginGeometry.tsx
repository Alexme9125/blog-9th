import styles from "./MarginGeometry.module.css";

export function MarginGeometry({ variant }: { variant: "journal" | "studio" }) {
  return (
    <div className={`${styles.geometry} ${styles[variant]}`} aria-hidden="true">
      <svg
        className={styles.left}
        viewBox="0 0 280 540"
        fill="none"
        focusable="false"
      >
        <path d="M24 68H214V458H24V68Z" />
        <path d="M60 382V100H250V310" />
        <path className={styles.secondary} d="M0 280H280M106 20V520" />
        <path d="M202 458H226M214 446V470M48 100H72M60 88V112" />
        <path className={styles.secondary} d="M24 486H90M24 498H62" />
      </svg>
      <svg
        className={styles.right}
        viewBox="0 0 320 420"
        fill="none"
        focusable="false"
      >
        <path d="M34 80H258V332H34V80Z" />
        <path d="M72 44H294V278H226" />
        <path
          className={styles.secondary}
          d="M160 104L278 222L160 340L42 222L160 104Z"
        />
        <path d="M246 80H270M258 68V92M22 332H46M34 320V344" />
        <path className={styles.secondary} d="M108 376H294M224 364V388" />
      </svg>
    </div>
  );
}
