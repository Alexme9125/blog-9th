"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Save, Send } from "lucide-react";
import { RichEditor } from "./RichEditor";
import {
  saveSpecialPage,
  publishSpecialPage,
} from "@/lib/special-pages/actions";
import type { AdminSpecialPage } from "@/lib/special-pages/types";
import admin from "./Admin.module.css";
import styles from "./Service.module.css";

export function SpecialPageEditor({ initial }: { initial: AdminSpecialPage }) {
  const [record, setRecord] = useState(initial);
  const [draft, setDraft] = useState(initial.draft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function save(publish: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await saveSpecialPage({
        key: record.key,
        expectedVersion: record.version,
        ...draft,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRecord(result.data);
      setDirty(false);
      if (publish) {
        const published = await publishSpecialPage({
          key: record.key,
          expectedVersion: result.data.version,
        });
        if (!published.ok) {
          setError(published.error);
          return;
        }
        setRecord(published.data);
      }
      setMessage(
        publish
          ? "页面已发布，访客现在可以阅读。"
          : "草稿已保存，公开页面保持原样。",
      );
      router.refresh();
    } catch {
      setError("保存未完成，请检查连接后重试。修改仍保留在编辑器中。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className={admin.editorHeading}>
        <div>
          <Link className={admin.backLink} href="/admin/special-pages">
            <ArrowLeft size={14} />
            特殊页面
          </Link>
          <h1>
            {record.title}
            <span className={admin.status}>
              {record.published ? "已发布" : "默认内容"}
            </span>
          </h1>
        </div>
        <div className={admin.editorActions}>
          <Link
            className="button secondary"
            href={"/" + record.key}
            target="_blank"
          >
            查看公开页
            <ArrowUpRight size={14} />
          </Link>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => save(false)}
          >
            <Save size={15} />
            保存草稿
          </button>
          <button className="button" disabled={busy} onClick={() => save(true)}>
            <Send size={15} />
            {record.published ? "更新发布" : "发布"}
          </button>
        </div>
      </header>
      <div className={admin.editorNotice} aria-live="polite">
        {error ? (
          <span className="form-error" role="alert">
            {error}
          </span>
        ) : (
          <span>
            {busy
              ? "正在保存…"
              : message ||
                (dirty
                  ? "有尚未保存的修改"
                  : "编辑后保存草稿，确认内容后发布。")}
          </span>
        )}
      </div>
      <div className={styles.stack}>
        <section className={styles.card}>
          <div className="field">
            <label htmlFor="special-intro">页面简介</label>
            <textarea
              id="special-intro"
              maxLength={500}
              rows={3}
              disabled={busy}
              value={draft.intro}
              onChange={(e) => {
                setDraft({ ...draft, intro: e.target.value });
                setDirty(true);
              }}
            />
          </div>
          <p className={styles.hint}>
            固定地址：/{record.key}
            。页尾入口始终指向这里，保存草稿不会改变公开内容。
            {record.key === "privacy" &&
              "请按社团实际运营方式补充联系方式和资料保留安排。"}
          </p>
        </section>
        <div inert={busy || undefined}>
          <RichEditor
            value={draft.body}
            onChange={(body) => {
              setDraft((d) => ({ ...d, body }));
              setDirty(true);
            }}
          />
        </div>
      </div>
    </>
  );
}
