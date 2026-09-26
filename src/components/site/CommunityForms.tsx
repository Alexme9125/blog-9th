"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, Mail } from "lucide-react";
import {
  subscribe,
  submitApplication,
  confirmSubscription,
  unsubscribe,
  confirmApplicationReceipt,
} from "@/lib/community/actions";
import styles from "./Community.module.css";

export function CommunityForm({
  kind,
  available,
}: {
  kind: "subscribe" | "join";
  available: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    if (!data.has("consent")) {
      setError("请先阅读并同意隐私政策。");
      setBusy(false);
      return;
    }
    const common = {
      email: String(data.get("email") || ""),
      consent: true as const,
      website: String(data.get("website") || ""),
    };
    try {
      const result =
        kind === "subscribe"
          ? await subscribe(common)
          : await submitApplication({
              ...common,
              name: String(data.get("name") || ""),
              interests: String(data.get("interests") || ""),
              introduction: String(data.get("introduction") || ""),
            });
      if (result.ok) setMessage(result.message);
      else setError(result.error);
    } catch {
      setError("暂时无法提交，请稍后重试。你填写的内容仍保留在这里。");
    } finally {
      setBusy(false);
    }
  }
  if (!available)
    return (
      <section className={styles.form}>
        <Mail size={28} strokeWidth={1} />
        <h2>
          {kind === "subscribe" ? "邮件订阅尚未开放" : "入社申请暂未开放"}
        </h2>
        <p>社团正在准备邮件服务，请稍后再来。</p>
        <div className={styles.actions}>
          <Link
            className="button secondary"
            href={kind === "subscribe" ? "/rss.xml" : "/about"}
          >
            {kind === "subscribe" ? "先订阅 RSS" : "了解社团"}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
    );
  if (message)
    return (
      <section className={styles.form} role="status">
        <Check size={28} strokeWidth={1} />
        <h2>请查看邮箱</h2>
        <p>{message}</p>
        <p className={styles.hint}>
          如果没有收到，请检查垃圾邮件文件夹。确认链接有时效，请及时完成。
        </p>
        <div className={styles.actions}>
          <button className="button secondary" onClick={() => setMessage("")}>
            重新填写
          </button>
          <Link href="/">返回首页</Link>
        </div>
      </section>
    );
  return (
    <form className={styles.form} onSubmit={submit}>
      <h2>{kind === "join" ? "入社申请表" : "订阅社团刊物"}</h2>
      <div className={styles.fields}>
        <div className={styles.trap} aria-hidden="true">
          <label htmlFor="community-website">个人主页（请留空）</label>
          <input
            id="community-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        {kind === "join" && (
          <div className="field">
            <label htmlFor="community-name">姓名 / 称呼</label>
            <input
              id="community-name"
              name="name"
              required
              maxLength={80}
              autoComplete="name"
              placeholder="希望我们如何称呼你"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="community-email">邮箱</label>
          <input
            id="community-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
          />
          <small>
            我们会发送一封确认邮件，确认后
            {kind === "join" ? "提交申请并发送表单副本" : "才开始接收推送"}。
          </small>
        </div>
        {kind === "join" && (
          <>
            <div className="field">
              <label htmlFor="community-interests">兴趣方向</label>
              <input
                id="community-interests"
                name="interests"
                required
                maxLength={300}
                placeholder="例如：动漫、自然科学、社会科学、AI"
              />
            </div>
            <div className="field">
              <label htmlFor="community-intro">自我介绍</label>
              <textarea
                id="community-intro"
                name="introduction"
                required
                rows={6}
                maxLength={5000}
                placeholder="聊聊你的兴趣，以及希望在社团一起做的事情。"
              />
            </div>
          </>
        )}
        <label className={styles.consent}>
          <input name="consent" type="checkbox" required />
          <span>
            我已阅读
            <Link href="/privacy" target="_blank">
              隐私政策
            </Link>
            ，同意将所填信息用于
            {kind === "join"
              ? "入社申请处理及发送申请副本"
              : "邮件订阅及发送确认邮件"}
            。{kind === "subscribe" && "可以随时通过邮件中的链接退订。"}
          </span>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className="button" disabled={busy}>
          {busy ? "正在提交…" : "发送确认邮件"}
          <ArrowUpRight size={16} />
        </button>
      </div>
      {kind === "join" && (
        <p className={styles.hint}>
          申请邮箱确认后，社团会收到申请表，你也会收到一份副本。提交申请不代表已获准入社。
        </p>
      )}
    </form>
  );
}

export function EmailConfirmation({
  kind,
  token,
}: {
  kind: "subscribe" | "unsubscribe" | "join";
  token: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const label =
    kind === "subscribe"
      ? "确认订阅"
      : kind === "unsubscribe"
        ? "确认退订"
        : "确认邮箱并提交申请";
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const result = await (kind === "subscribe"
        ? confirmSubscription(token)
        : kind === "unsubscribe"
          ? unsubscribe(token)
          : confirmApplicationReceipt(token));
      if (result.ok) setMessage(result.message);
      else setError(result.error);
    } catch {
      setError("请求未完成，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.form}>
      <h2>{message ? "操作已完成" : label}</h2>
      <p role="status">
        {message ||
          (kind === "unsubscribe"
            ? "确认后，你将不再收到社团的文章推送。"
            : kind === "join"
              ? "确认这个邮箱属于你后，我们会提交你的申请，并向你发送申请表副本。"
              : "确认后，你将收到社团通过邮件推送的文章摘要和链接。")}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!token && (
        <p className="form-error">
          链接缺少确认信息，请从邮件中重新打开完整链接。
        </p>
      )}
      <div className={styles.actions}>
        {!message && (
          <button
            className="button"
            disabled={busy || !token}
            onClick={confirm}
          >
            {busy ? "处理中…" : label}
          </button>
        )}
        <Link href={kind === "join" ? "/join" : "/subscribe"}>
          {message ? "返回" : "重新填写"}
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </section>
  );
}
