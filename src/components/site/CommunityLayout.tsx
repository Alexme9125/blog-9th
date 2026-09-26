import { MarginGeometry } from "./MarginGeometry";
import styles from "./Community.module.css";
export function CommunityLayout({
  title,
  intro,
  eyebrow,
  children,
}: {
  title: string;
  intro: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className={styles.page}>
      <MarginGeometry variant="journal" />
      <div className="container">
        <header className={styles.header}>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{intro}</p>
        </header>
        {children}
      </div>
    </main>
  );
}
