"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { loginErrorMessage } from "@/lib/auth/login-error";
import styles from "./Admin.module.css";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await authClient.signIn.email({
        email: String(data.get("email")),
        password: String(data.get("password")),
      });
      if (result.error) setError(loginErrorMessage(result.error));
      else {
        router.push("/admin");
        router.refresh();
      }
    } catch {
      setError("暂时无法连接，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={styles.loginForm}>
      <div className="field">
        <label htmlFor="email">邮箱</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="你的创作账号邮箱"
        />
      </div>
      <div className="field">
        <label htmlFor="password">密码</label>
        <div className={styles.passwordField}>
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="输入密码"
          />
          <button
            type="button"
            aria-label={show ? "隐藏密码" : "显示密码"}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button" type="submit" disabled={busy}>
        {busy ? "正在登录…" : "进入创作空间"}
        <ArrowRight size={17} />
      </button>
      <p className={styles.loginHint}>
        账号由社团管理员创建。
        <br />
        如需加入创作或重置密码，请联系管理员。
      </p>
    </form>
  );
}
