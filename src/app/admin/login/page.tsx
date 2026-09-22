import Link from "next/link";
import { Brand } from "@/components/site/Header";
import { LoginForm } from "@/components/admin/LoginForm";
import styles from "@/components/admin/Admin.module.css";
export const metadata = {
  title: "登录创作后台",
  robots: { index: false, follow: false },
};
export default function LoginPage() {
  return (
    <main id="main" className={styles.loginPage}>
      <div className={styles.loginStory}>
        <Link href="/">
          <Brand />
        </Link>
        <div className={styles.loginStoryCenter}>
          <span className="eyebrow">A PLACE FOR YOUR IDEAS</span>
          <h1>
            让想法，
            <br />
            留下自己的轨迹。
          </h1>
          <p>用科学与人文创造幻想中的未来</p>
          <svg viewBox="0 0 400 220" fill="none" aria-hidden="true">
            <ellipse
              cx="210"
              cy="100"
              rx="155"
              ry="63"
              transform="rotate(-25 210 100)"
              stroke="#667f9a"
            />
            <ellipse
              cx="210"
              cy="100"
              rx="155"
              ry="63"
              transform="rotate(25 210 100)"
              stroke="#88b8c7"
            />
            <path d="M160 0h35L285 220h-35Z" fill="#2454bd" opacity=".8" />
            <path
              d="M50 100h320M210 15v170"
              stroke="#91a4ad"
              strokeWidth=".6"
            />
            <circle cx="210" cy="100" r="10" fill="#dce3e5" stroke="#344f63" />
            <rect x="71" y="155" width="7" height="7" fill="#344f63" />
          </svg>
        </div>
        <Link href="/" className="text-link">
          ← 返回网站
        </Link>
      </div>
      <section className={styles.loginPanel}>
        <span className="eyebrow">DARWIN / CREATIVE STUDIO</span>
        <h2>欢迎回来。</h2>
        <p>继续记录你的观察与想象。</p>
        <LoginForm />
      </section>
    </main>
  );
}
