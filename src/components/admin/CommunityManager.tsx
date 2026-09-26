"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Mail, ArrowUpRight } from "lucide-react";
import {
  getAdminCommunity,
  changeApplicationStatus,
  deleteApplication,
  removeSubscriber,
  previewManualPush,
  sendManualPush,
} from "@/lib/community/admin";
import type { Role } from "@/lib/cms/types";
import { useDialog } from "./useDialog";
import admin from "./Admin.module.css";
import styles from "./Service.module.css";

type Community = Awaited<ReturnType<typeof getAdminCommunity>>;
type PreviewResult = Awaited<ReturnType<typeof previewManualPush>>;
type Preview = Extract<PreviewResult, { ok: true }>["data"];
type Removal = { kind: "application" | "subscriber"; id: string };
function ConfirmModal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useDialog(close);
  return (
    <div className={admin.modalBackdrop}>
      <section
        className={admin.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-confirm"
        ref={ref}
      >
        <h2 id="community-confirm">{title}</h2>
        {children}
      </section>
    </div>
  );
}
const applicationLabels = {
  pending: "待处理",
  reviewing: "审核中",
  accepted: "已通过",
  declined: "未通过",
  withdrawn: "已撤回",
};
const subscriberLabels: Record<string, string> = {
  pending: "待确认",
  confirmed: "已订阅",
  active: "已订阅",
  unsubscribed: "已退订",
};
export function CommunityManager({
  data,
  posts,
  role,
  manualEnabled,
}: {
  data: Community;
  posts: { id: string; title: string }[];
  role: Role;
  manualEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [removal, setRemoval] = useState<Removal | null>(null);
  const select = useRef<HTMLSelectElement>(null);
  const router = useRouter();
  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (!result.ok) setError(result.error || "操作未完成，请重试。");
      else {
        setMessage(success);
        router.refresh();
      }
    } catch {
      setError("操作未完成，请检查连接后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await previewManualPush(select.current?.value || "");
      if (result.ok) setPreview(result.data);
      else setError(result.error);
    } catch {
      setError("无法准备推送，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function push() {
    if (!preview) return;
    const current = preview;
    setPreview(null);
    setBusy(true);
    setError("");
    try {
      const result = await sendManualPush({
        documentId: current.documentId,
        expectedSnapshotHash: current.snapshotHash,
      });
      if (result.ok) {
        setMessage(`已为 ${result.data.queued} 位订阅者加入发送队列。`);
        router.refresh();
      } else setError(result.error);
    } catch {
      setError("推送请求未完成，请刷新后检查发送记录。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={admin.pageHeading}>
        <div>
          <span className="eyebrow">DARWIN / COMMUNITY</span>
          <h1>订阅与入社</h1>
          <p>让刊物与读者保持联系，也认真回应每一份加入社团的意愿。</p>
        </div>
        {role === "admin" && (
          <Link className="button secondary" href="/admin/mail">
            <Mail size={15} />
            邮件设置
          </Link>
        )}
      </header>
      <div className={styles.summary}>
        <span>
          <strong>{data.confirmedSubscriberCount}</strong>已确认订阅
        </span>
        <span>
          <strong>{data.subscriberCount}</strong>订阅记录
        </span>
      </div>
      <div aria-live="polite">
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          message && (
            <p className="form-success" role="status">
              {message}
            </p>
          )
        )}
      </div>
      <div className={styles.stack}>
        <form className={styles.card} onSubmit={prepare}>
          <h2>手动推送文章</h2>
          <p>
            选择一篇已发布的文章，向已确认的订阅者发送摘要与原文链接。同一篇文章不会重复发送给同一位订阅者。
          </p>
          {manualEnabled ? (
            <>
              <div className="field">
                <label htmlFor="push-post">要推送的文章</label>
                <select id="push-post" ref={select} required defaultValue="">
                  <option value="" disabled>
                    选择已发布文章
                  </option>
                  {posts.map((post) => (
                    <option value={post.id} key={post.id}>
                      {post.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.actions}>
                <button className="button" disabled={busy || !posts.length}>
                  <Send size={15} />
                  预览推送
                </button>
              </div>
            </>
          ) : (
            <p className={styles.hint}>
              手动推送尚未启用，请由管理员在“邮件设置”中开启邮件服务和手动推送。
            </p>
          )}
        </form>
        <section className={styles.card}>
          <h2>入社申请</h2>
          <p>
            最近 100 条申请。申请人确认邮箱后，社团和申请人会分别收到申请表。
            <Link href="/join" target="_blank">
              查看公开表单
              <ArrowUpRight size={13} />
            </Link>
          </p>
          {!data.applications.length && (
            <div className={styles.empty}>
              还没有入社申请。配置申请收件邮箱后，来访者即可填写表单。
            </div>
          )}
          {data.applications.map((application) => (
            <details className={styles.record} key={application.id}>
              <summary>
                <strong>{application.name || "待确认申请"}</strong>
                <span>{applicationLabels[application.status]}</span>
                <small>
                  {application.emailVerified ? "邮箱已确认" : "等待邮箱确认"} ·{" "}
                  {new Date(application.createdAt).toLocaleDateString("zh-CN")}
                </small>
              </summary>
              <div>
                <p>
                  <strong>邮箱：</strong>
                  {application.email}
                  <br />
                  <strong>兴趣方向：</strong>
                  {Array.isArray(application.interests)
                    ? application.interests.join("、")
                    : application.interests}
                </p>
                <p>{application.introduction}</p>
                <div className={styles.actions}>
                  <label>
                    处理状态
                    <select
                      aria-label={
                        (application.name || "待确认申请") + "的申请状态"
                      }
                      value={application.status}
                      disabled={busy || !application.emailVerified}
                      onChange={(event) =>
                        run(
                          () =>
                            changeApplicationStatus(
                              application.id,
                              event.target
                                .value as keyof typeof applicationLabels,
                            ),
                          "申请状态已更新。",
                        )
                      }
                    >
                      {Object.entries(applicationLabels).map(
                        ([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  {role === "admin" && (
                    <button
                      className={admin.smallButton}
                      disabled={busy}
                      onClick={() =>
                        setRemoval({ kind: "application", id: application.id })
                      }
                    >
                      删除申请资料
                    </button>
                  )}
                </div>
              </div>
            </details>
          ))}
        </section>
        <section className={admin.panel}>
          <div className={admin.panelHeading}>
            <h2>订阅者</h2>
            <span className={styles.hint}>最近 100 条</span>
          </div>
          <div
            className={admin.tableScroll}
            tabIndex={0}
            role="region"
            aria-label="订阅者列表，可横向滚动"
          >
            <table className={admin.table}>
              <thead>
                <tr>
                  <th>邮箱</th>
                  <th>状态</th>
                  <th>登记日期</th>
                  {role === "admin" && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {data.subscribers.map((subscriber) => (
                  <tr key={subscriber.id}>
                    <td>{subscriber.email}</td>
                    <td>
                      {subscriberLabels[subscriber.status] || subscriber.status}
                    </td>
                    <td>
                      {new Date(subscriber.createdAt).toLocaleDateString(
                        "zh-CN",
                      )}
                    </td>
                    {role === "admin" && (
                      <td>
                        <button
                          className={admin.smallButton}
                          disabled={busy}
                          onClick={() =>
                            setRemoval({
                              kind: "subscriber",
                              id: subscriber.id,
                            })
                          }
                        >
                          停止订阅
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.subscribers.length && (
            <p className={styles.emptyPanel}>
              还没有订阅记录。读者确认邮箱后才会收到推送。
            </p>
          )}
        </section>
      </div>
      {preview && (
        <ConfirmModal title="确认推送这篇文章？" close={() => setPreview(null)}>
          <h3>{preview.title}</h3>
          <p>{preview.excerpt || "邮件将包含文章标题和原文链接。"}</p>
          <p>
            将发送给 <strong>{preview.recipientCount}</strong>{" "}
            位尚未接收这篇文章的已确认订阅者。
          </p>
          <div className={admin.modalActions}>
            <button
              className="button secondary"
              onClick={() => setPreview(null)}
            >
              取消
            </button>
            <button
              className="button"
              disabled={busy || !preview.recipientCount}
              onClick={push}
            >
              确认发送
            </button>
          </div>
        </ConfirmModal>
      )}
      {removal && (
        <ConfirmModal
          title={
            removal.kind === "application" ? "删除申请资料？" : "停止订阅？"
          }
          close={() => setRemoval(null)}
        >
          <p>
            {removal.kind === "application"
              ? "申请资料将从站点中删除，已经送达的邮件副本不会被删除。"
              : "停止后不再发送后续推送，保留必要的退订记录；对方可以重新主动订阅。"}
          </p>
          <div className={admin.modalActions}>
            <button
              className="button secondary"
              onClick={() => setRemoval(null)}
            >
              取消
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                const current = removal;
                setRemoval(null);
                void run(
                  () =>
                    current.kind === "application"
                      ? deleteApplication(current.id)
                      : removeSubscriber(current.id),
                  "操作已完成。",
                );
              }}
            >
              确认操作
            </button>
          </div>
        </ConfirmModal>
      )}
    </>
  );
}
