import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PasswordForm } from "@/components/admin/PasswordForm";
import { Brand } from "@/components/site/Header";
import styles from "@/components/admin/Admin.module.css";
export const dynamic = "force-dynamic";
export default async function PasswordPage() {
  const user = await requireUser();
  return (
    <main id="main" className={styles.passwordPage}>
      <Link href="/">
        <Brand />
      </Link>
      <section>
        <span className="eyebrow">ACCOUNT SECURITY</span>
        <h1>设置你的密码。</h1>
        <PasswordForm forced={user.mustChangePassword} />
      </section>
    </main>
  );
}
