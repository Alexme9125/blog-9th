"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, LocateFixed } from "lucide-react";
import {
  saveSiteAccess,
  type getAdminSiteAccess,
} from "@/lib/site-access/actions";
import shared from "./Admin.module.css";
import styles from "./SiteAccessSettings.module.css";

type AccessSettings = Awaited<ReturnType<typeof getAdminSiteAccess>>;

export function SiteAccessSettings({ initial }: { initial: AccessSettings }) {
  const [saved, setSaved] = useState(initial);
  const [publicUrl, setPublicUrl] = useState(initial.config.publicUrl);
  const [aliases, setAliases] = useState(
    initial.config.trustedOrigins.join("\n"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await saveSiteAccess({
        publicUrl,
        trustedOrigins: aliases
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(result.data);
      setPublicUrl(result.data.config.publicUrl);
      setAliases(result.data.config.trustedOrigins.join("\n"));
      setMessage("访问地址已保存并生效。从新地址进入后台时，请重新登录。");
      router.refresh();
    } catch {
      setError("访问地址保存失败，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${shared.panel} ${shared.formPanel} ${styles.panel}`}
      aria-labelledby="access-heading"
    >
      <div className={styles.heading}>
        <div>
          <h2 id="access-heading">访问域名</h2>
          <p>设置网站对外使用的地址，以及可以进入创作后台的其他入口。</p>
        </div>
        <Globe2 aria-hidden="true" size={24} strokeWidth={1.2} />
      </div>
      <form onSubmit={submit} aria-label="访问域名设置">
        <fieldset disabled={busy} className={styles.fields}>
          <div className="field">
            <label htmlFor="site-public-url">主要访问地址</label>
            <div className={styles.addressInput}>
              <input
                id="site-public-url"
                name="publicUrl"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                placeholder={saved.publicUrl}
                value={publicUrl}
                onChange={(event) => {
                  setPublicUrl(event.target.value);
                  setMessage("");
                }}
                aria-describedby="site-public-url-help"
              />
              <button
                className={shared.smallButton}
                type="button"
                onClick={() => {
                  setPublicUrl(window.location.origin);
                  setMessage("");
                  setError("");
                }}
              >
                <LocateFixed size={15} aria-hidden="true" />
                使用当前地址
              </button>
            </div>
            <p className={styles.hint} id="site-public-url-help">
              输入域名或完整地址，如
              https://journal.example.com。用于登录、分享链接与订阅；留空使用服务器配置。
            </p>
          </div>
          <div className="field">
            <label htmlFor="site-trusted-origins">
              其他允许登录的地址 <span className={styles.optional}>可选</span>
            </label>
            <textarea
              id="site-trusted-origins"
              name="trustedOrigins"
              rows={3}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={22000}
              placeholder="https://www.example.com"
              value={aliases}
              onChange={(event) => {
                setAliases(event.target.value);
                setMessage("");
              }}
              aria-describedby="site-trusted-origins-help"
            />
            <p className={styles.hint} id="site-trusted-origins-help">
              每行一个，最多 10 个。迁移域名时可在这里保留旧入口。
              {saved.production
                ? "生产环境须使用 HTTPS。"
                : "本地开发允许使用 HTTP 回环地址。"}
            </p>
          </div>
        </fieldset>
        <div className={styles.status}>
          <dl>
            <div>
              <dt>已生效主地址</dt>
              <dd>
                <code>{saved.publicUrl}</code>
              </dd>
            </div>
            <div>
              <dt>服务器保留入口</dt>
              <dd>
                <code>{saved.environmentOrigin}</code>
              </dd>
            </div>
          </dl>
          <details>
            <summary>查看允许登录的地址</summary>
            <ul>
              {saved.trustedOrigins.map((origin) => (
                <li key={origin}>
                  <code>{origin}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>
        <p className={styles.hint}>
          保存后立即生效。请先让新域名指向服务器并配置好
          HTTPS；这里不会修改域名解析或证书。服务器保留入口可用于配置出错后的恢复。
        </p>
        <div className={styles.actions}>
          <div aria-live="polite">
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : message ? (
              <p className="form-success" role="status">
                {message}
              </p>
            ) : null}
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "正在保存…" : "保存访问地址"}
          </button>
        </div>
      </form>
    </section>
  );
}
