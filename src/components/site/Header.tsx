"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Menu, Search, X } from "lucide-react";
import type { SiteSettings } from "@/lib/content/types";
import styles from "./Site.module.css";
export function Brand({ name = "Darwin动漫社" }: { name?: string }) {
  return (
    <span className={styles.brand}>
      <span className={styles.brandSymbol} aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <path
            d="M8 31V9h9c16 0 16 22 0 22H8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M16 31 27 9l9 22M20 23h13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="8" cy="9" r="3" fill="currentColor" />
        </svg>
      </span>
      <span>
        <strong>
          DARWIN<span className={styles.brandDot}>.</span>
        </strong>
        <small>
          {name === "Darwin动漫社" ? "动漫社 / 好奇心共同体" : name}
        </small>
      </span>
    </span>
  );
}
export function Header({ settings }: { settings: SiteSettings }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link
          href="/"
          aria-label={`${settings.name}首页`}
          onClick={() => setOpen(false)}
        >
          <Brand name={settings.name} />
        </Link>
        <nav
          aria-label="主导航"
          className={`${styles.nav} ${open ? styles.navOpen : ""}`}
        >
          {settings.navigation
            .filter((n) => n.visible)
            .sort((a, b) => a.order - b.order)
            .map((n) => (
              <Link
                key={n.id}
                href={n.href}
                className={path === n.href ? styles.navActive : ""}
                onClick={() => setOpen(false)}
              >
                {n.label}
              </Link>
            ))}
        </nav>
        <div className={styles.headerActions}>
          <Link
            className={styles.iconButton}
            href="/search"
            aria-label="搜索文章"
          >
            <Search size={19} />
          </Link>
          <span className={styles.headerDivider} />
          <Link className={styles.editorLink} href="/admin">
            创作后台
            <ArrowUpRight size={15} />
          </Link>
          <button
            className={`${styles.iconButton} ${styles.menuButton}`}
            aria-label={open ? "关闭菜单" : "打开菜单"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}
