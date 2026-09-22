"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeOwnPassword } from "@/lib/cms/users";
import styles from "./Admin.module.css";
export function PasswordForm({ forced }: { forced: boolean }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (data.get("newPassword") !== data.get("confirm")) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await changeOwnPassword(
        String(data.get("currentPassword")),
        String(data.get("newPassword")),
      );
      if (!result.ok) setError(result.error);
      else {
        router.push("/admin/login");
        router.refresh();
      }
    } catch {
      setError("保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={styles.loginForm}>
      <p className="muted">
        {forced
          ? "首次登录需要更换临时密码。"
          : "更换密码后，请使用新密码重新登录。"}
      </p>
      <div className="field">
        <label htmlFor="currentPassword">当前密码</label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="newPassword">新密码（至少 12 位）</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="confirm">再次输入新密码</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "正在保存…" : "保存新密码"}
      </button>
    </form>
  );
}
