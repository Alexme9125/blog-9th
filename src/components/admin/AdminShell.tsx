"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  PanelsTopLeft,
  Users,
  ImageIcon,
  Tags,
  Settings,
  LogOut,
  ArrowUpRight,
  Menu,
  X,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { Brand } from "@/components/site/Header";
import { authClient } from "@/lib/auth/client";
import type { AdminUser } from "@/lib/cms/types";
import styles from "./Admin.module.css";
const links = [
  { href: "/admin", label: "工作台", icon: LayoutDashboard },
  { href: "/admin/posts", label: "文章管理", icon: FileText },
  {
    href: "/admin/pages",
    label: "静态页面",
    icon: PanelsTopLeft,
    editor: true,
  },
  { href: "/admin/members", label: "主要成员", icon: Users, editor: true },
  { href: "/admin/media", label: "媒体库", icon: ImageIcon },
  { href: "/admin/taxonomy", label: "分类与标签", icon: Tags, editor: true },
  { href: "/admin/users", label: "账号管理", icon: ShieldCheck, admin: true },
  { href: "/admin/settings", label: "站点设置", icon: Settings, admin: true },
];
export function AdminShell({
  user,
  children,
}: {
  user: AdminUser;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    router = useRouter();
  const [open, setOpen] = useState(false);
  async function logout() {
    await authClient.signOut();
    router.push("/admin/login");
    router.refresh();
  }
  return (
    <div className={styles.shell}>
      <aside
        className={styles.sidebar + " " + (open ? styles.sidebarOpen : "")}
      >
        <Link href="/" className={styles.sideBrand}>
          <Brand />
        </Link>
        <div className={styles.sideLabel}>创作与管理 / STUDIO</div>
        <nav aria-label="后台导航">
          {links
            .filter(
              (l) =>
                (!l.admin || user.role === "admin") &&
                (!l.editor || user.role !== "author"),
            )
            .map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={
                  (
                    l.href === "/admin"
                      ? path === l.href
                      : path.startsWith(l.href)
                  )
                    ? styles.sideActive
                    : ""
                }
              >
                <l.icon size={17} />
                {l.label}
              </Link>
            ))}
        </nav>
        <div className={styles.sideBottom}>
          <Link href="/" target="_blank">
            查看网站
            <ArrowUpRight size={15} />
          </Link>
          <Link href="/admin/password">
            修改密码
            <KeyRound size={14} />
          </Link>
          <button onClick={logout}>
            退出登录
            <LogOut size={14} />
          </button>
        </div>
      </aside>
      {open && (
        <button
          className={styles.scrim}
          aria-label="关闭后台菜单"
          onClick={() => setOpen(false)}
        />
      )}
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <button
            className={styles.mobileToggle}
            aria-label={open ? "关闭后台菜单" : "打开后台菜单"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
          <span>DARWIN / CREATIVE STUDIO</span>
          <div className={styles.userBadge}>
            <i>{user.name.slice(0, 1)}</i>
            <div>
              {user.name}
              <small>
                {{ admin: "管理员", editor: "编辑", author: "作者" }[user.role]}
              </small>
            </div>
          </div>
        </header>
        <main id="main" className={styles.main}>
          {children}
        </main>
        <div className={styles.workspaceFooter}>
          保持好奇，让每一个想法都有被记录的机会。
        </div>
      </div>
    </div>
  );
}
