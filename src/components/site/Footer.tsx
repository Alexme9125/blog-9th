import Link from "next/link";
import { ArrowUpRight, ArrowUp } from "lucide-react";
import { Brand } from "./Header";
import type { SiteSettings } from "@/lib/content/types";
import styles from "./Site.module.css";
export function Footer({ settings }: { settings: SiteSettings }) {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerTop}`}>
        <div>
          <Link href="/">
            <Brand name={settings.name} />
          </Link>
          <p>{settings.footer}</p>
        </div>
        <div className={styles.footerStatement}>
          在已知与未知之间，
          <br />
          留一扇想象的窗。
        </div>
        <Link className={styles.backTop} href="#top" aria-label="回到顶部">
          <ArrowUp size={23} />
        </Link>
      </div>
      <div className={`container ${styles.footerBottom}`}>
        <span>
          © {new Date().getFullYear()} {settings.name}
        </span>
        <span className={styles.footerCoordinates}>
          SCIENCE · HUMANITIES · IMAGINATION
        </span>
        <nav className={styles.footerLinks} aria-label="社团与服务">
          <Link href="/about">关于社团</Link>
          <Link href="/join">申请入社</Link>
          <Link href="/subscribe">邮件订阅</Link>
          <Link href="/privacy">隐私政策</Link>
          <Link href="/rss.xml">RSS<ArrowUpRight size={13} /></Link>
        </nav>
      </div>
    </footer>
  );
}
