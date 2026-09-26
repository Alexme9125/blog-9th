"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, RefreshCw, Save, Send } from "lucide-react";
import type { AdminMailJob, MailSettings } from "@/lib/mail/types";
import { saveMailSettings, testMail, retryMailJob } from "@/lib/mail/actions";
import admin from "./Admin.module.css";
import styles from "./Service.module.css";

const statusLabels = {
  queued: "等待发送",
  processing: "发送中",
  sent: "已发送",
  failed: "发送失败",
  suppressed: "已取消",
};
const deliveryErrors: Record<string, string> = {
  SMTP_AUTH_FAILED: "邮箱认证失败，请检查用户名和授权码。",
  SMTP_TLS_FAILED: "加密连接失败，请检查服务器、端口和加密方式。",
  SMTP_TIMEOUT: "邮件服务器连接超时，将按计划重试。",
  SMTP_CONNECTION_FAILED: "无法连接邮件服务器，请检查地址和网络。",
  SMTP_CONFIGURATION_UNAVAILABLE: "邮件配置无法读取，请重新保存邮件设置。",
  SMTP_DELIVERY_FAILED: "投递未完成，请检查邮箱服务配置。",
  RECIPIENT_UNSUBSCRIBED: "收件人已退订，已取消发送。",
  POST_NO_LONGER_PUBLISHED: "文章已撤回，已取消发送。",
  APPLICATION_WITHDRAWN: "申请已撤回或删除，已取消发送。",
};
export function MailManager({
  initial,
  jobs,
}: {
  initial: MailSettings;
  jobs: AdminMailJob[];
}) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", message: "" });
  const router = useRouter();
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setFeedback({ error: "", message: "" });
    try {
      const result = await saveMailSettings({
        enabled: data.has("enabled"),
        host: String(data.get("host") || ""),
        port: Number(data.get("port")),
        security: data.get("security") === "tls" ? "tls" : "starttls",
        username: String(data.get("username") || ""),
        password: String(data.get("password") || ""),
        clearPassword: data.has("clearPassword"),
        fromName: String(data.get("fromName") || ""),
        fromEmail: String(data.get("fromEmail") || ""),
        replyTo: String(data.get("replyTo") || ""),
        applicationRecipient: String(data.get("applicationRecipient") || ""),
        notifyOnPublish: data.has("notifyOnPublish"),
        allowManualPush: data.has("allowManualPush"),
      });
      if (!result.ok) setFeedback({ error: result.error, message: "" });
      else {
        setSettings(result.data);
        (form.elements.namedItem("password") as HTMLInputElement).value = "";
        (form.elements.namedItem("clearPassword") as HTMLInputElement).checked =
          false;
        setFeedback({
          error: "",
          message: "邮件设置已保存。可以发送一封测试邮件确认配置。",
        });
        router.refresh();
      }
    } catch {
      setFeedback({ error: "保存失败，请检查连接后重试。", message: "" });
    } finally {
      setBusy(false);
    }
  }
  async function sendTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback({ error: "", message: "" });
    try {
      const result = await testMail({
        to: String(new FormData(event.currentTarget).get("to") || ""),
      });
      setFeedback(
        result.ok
          ? {
              error: "",
              message: "测试邮件已加入发送队列，请刷新下方记录查看结果。",
            }
          : { error: result.error, message: "" },
      );
      router.refresh();
    } catch {
      setFeedback({ error: "测试请求未完成，请重试。", message: "" });
    } finally {
      setBusy(false);
    }
  }
  async function retry(id: string) {
    setBusy(true);
    setFeedback({ error: "", message: "" });
    try {
      const result = await retryMailJob(id);
      setFeedback(
        result.ok
          ? { error: "", message: "已重新加入发送队列。" }
          : { error: result.error, message: "" },
      );
      router.refresh();
    } catch {
      setFeedback({ error: "重试未完成，请稍后重试。", message: "" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={admin.pageHeading}>
        <div>
          <span className="eyebrow">DARWIN / CORRESPONDENCE</span>
          <h1>邮件设置</h1>
          <p>连接社团邮箱，让新文章和入社申请及时送达。</p>
        </div>
        <Mail size={28} strokeWidth={1} />
      </header>
      <div role="status" aria-live="polite">
        {feedback.error ? (
          <p className="form-error" role="alert">
            {feedback.error}
          </p>
        ) : (
          feedback.message && <p className="form-success">{feedback.message}</p>
        )}
      </div>
      <div className={styles.stack}>
        <form className={styles.card} onSubmit={save}>
          <h2>SMTP 发信服务</h2>
          <p>
            使用邮箱服务商提供的服务器和授权码。密码保存后不会回显；留空保留已保存的密码。
          </p>
          <label className={styles.check}>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.enabled}
            />
            <span>
              启用邮件发送
              <small>关闭后暂停邮件发送和新的订阅、入社申请。</small>
            </span>
          </label>
          <div className={styles.fields}>
            <div className="field">
              <label htmlFor="mail-host">SMTP 服务器</label>
              <input
                id="mail-host"
                name="host"
                defaultValue={settings.host}
                placeholder="smtp.example.com"
                maxLength={253}
              />
            </div>
            <div className="field">
              <label htmlFor="mail-port">端口</label>
              <input
                id="mail-port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={settings.port}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="mail-security">连接加密</label>
              <select
                id="mail-security"
                name="security"
                defaultValue={settings.security}
              >
                <option value="tls">TLS（通常为 465）</option>
                <option value="starttls">STARTTLS（通常为 587）</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mail-user">SMTP 用户名</label>
              <input
                id="mail-user"
                name="username"
                defaultValue={settings.username}
                autoComplete="off"
                maxLength={320}
              />
            </div>
            <div className={"field " + styles.full}>
              <label htmlFor="mail-password">密码 / 邮箱授权码</label>
              <input
                id="mail-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder={
                  settings.hasPassword ? "已保存；留空保留" : "输入邮箱授权码"
                }
                maxLength={1024}
              />
              <label className={styles.check}>
                <input type="checkbox" name="clearPassword" />
                清除已保存的密码
              </label>
            </div>
            <div className="field">
              <label htmlFor="mail-name">发件人名称</label>
              <input
                id="mail-name"
                name="fromName"
                defaultValue={settings.fromName}
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor="mail-from">发件邮箱</label>
              <input
                id="mail-from"
                name="fromEmail"
                type="email"
                defaultValue={settings.fromEmail}
                maxLength={254}
              />
            </div>
            <div className="field">
              <label htmlFor="mail-reply">回复邮箱（选填）</label>
              <input
                id="mail-reply"
                name="replyTo"
                type="email"
                defaultValue={settings.replyTo}
                maxLength={254}
              />
            </div>
            <div className="field">
              <label htmlFor="mail-applications">入社申请收件邮箱</label>
              <input
                id="mail-applications"
                name="applicationRecipient"
                type="email"
                defaultValue={settings.applicationRecipient}
                maxLength={254}
              />
              <small>
                申请人确认邮箱后，向此邮箱发送申请表；申请人同时收到副本。
              </small>
            </div>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              name="notifyOnPublish"
              defaultChecked={settings.notifyOnPublish}
            />
            <span>
              新文章首次发布时向已确认的订阅者推送
              <small>更新已发布文章或撤回后重发，不重复推送。</small>
            </span>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              name="allowManualPush"
              defaultChecked={settings.allowManualPush}
            />
            <span>
              允许后台手动推送文章
              <small>
                管理员和编辑可在“订阅与入社”选择已发布文章，确认接收人数后发送。
              </small>
            </span>
          </label>
          <div className={styles.actions}>
            <button className="button" disabled={busy}>
              <Save size={15} />
              {busy ? "处理中…" : "保存邮件设置"}
            </button>
          </div>
        </form>
        <form className={styles.card} onSubmit={sendTest}>
          <h2>测试发送</h2>
          <p>使用已经保存的配置发送测试邮件，请先保存上方设置。</p>
          <div className="field">
            <label htmlFor="mail-test">接收测试邮件的邮箱</label>
            <input
              id="mail-test"
              name="to"
              type="email"
              required
              maxLength={254}
            />
          </div>
          <div className={styles.actions}>
            <button
              className="button secondary"
              disabled={busy || !settings.enabled}
            >
              <Send size={15} />
              发送测试邮件
            </button>
          </div>
        </form>
        <section className={admin.panel}>
          <div className={admin.panelHeading}>
            <h2>最近发送记录</h2>
            <button
              className={admin.smallButton}
              onClick={() => router.refresh()}
              disabled={busy}
            >
              <RefreshCw size={14} />
              刷新
            </button>
          </div>
          <div
            className={admin.tableScroll}
            tabIndex={0}
            role="region"
            aria-label="邮件发送记录，可横向滚动"
          >
            <table className={admin.table}>
              <thead>
                <tr>
                  <th>主题 / 收件邮箱</th>
                  <th>状态</th>
                  <th>尝试次数</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {job.subject}
                      <br />
                      <small>{job.to}</small>
                    </td>
                    <td>
                      {statusLabels[job.status]}
                      {job.lastError && (
                        <div className="form-error">
                          {deliveryErrors[job.lastError] ||
                            "这封邮件暂未发送，请检查配置或记录状态。"}
                        </div>
                      )}
                    </td>
                    <td>{job.attempts}</td>
                    <td>
                      {new Date(job.sentAt || job.createdAt).toLocaleString(
                        "zh-CN",
                      )}
                    </td>
                    <td>
                      {job.status === "failed" && (
                        <button
                          className={admin.smallButton}
                          disabled={busy}
                          onClick={() => retry(job.id)}
                        >
                          重新发送
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!jobs.length && (
            <p className={styles.emptyPanel}>
              还没有发送记录。保存配置后，先发送一封测试邮件。
            </p>
          )}
        </section>
      </div>
    </>
  );
}
