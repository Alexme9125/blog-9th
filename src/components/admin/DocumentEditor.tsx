/* eslint-disable @next/next/no-img-element -- Controlled media must bypass the public image optimizer cache. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Save,
  Send,
  History,
  RotateCcw,
  Trash2,
  ImagePlus,
  X,
} from "lucide-react";
import type {
  AdminDocument,
  DocumentData,
  DocumentKind,
  DocumentRevision,
  Member,
  Role,
  TaxonomyData,
  TransitionInput,
} from "@/lib/cms/types";
import { emptyDocument } from "@/lib/cms/types";
import {
  saveDocument,
  transitionDocument,
  getRevisions,
  restoreRevision,
} from "@/lib/cms/documents";
import { RichEditor, uploadFile } from "./RichEditor";
import { BlockEditor } from "./BlockEditor";
import styles from "./Admin.module.css";
import { useDialog } from "./useDialog";
function ConfirmationDialog({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useDialog(onClose);
  return (
    <div className={styles.modalBackdrop}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={styles.modal}
      >
        {children}
      </section>
    </div>
  );
}
const stateNames = {
  draft: "草稿",
  review: "待审核",
  published: "已发布",
  archived: "回收站",
};
export function DocumentEditor({
  initial,
  kind,
  role,
  taxonomy,
  members = [],
}: {
  initial: AdminDocument | null;
  kind: DocumentKind;
  role: Role;
  taxonomy: TaxonomyData;
  members?: Member[];
}) {
  const router = useRouter();
  const [record, setRecord] = useState(initial),
    [data, setData] = useState<DocumentData>(
      initial?.draft || { ...emptyDocument },
    ),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [history, setHistory] = useState<DocumentRevision[] | null>(null),
    [revisionKey, setRevisionKey] = useState("initial"),
    [confirmAction, setConfirmAction] = useState<
      TransitionInput["action"] | null
    >(null);
  const serial = useRef(0),
    busyRef = useRef(false),
    fileRef = useRef<HTMLInputElement>(null);
  const section = kind === "post" ? "posts" : "pages";
  const canPublish = role !== "author";
  function update(patch: Partial<DocumentData>) {
    setData((d) => ({ ...d, ...patch }));
    serial.current++;
    setDirty(true);
    setMessage("有尚未保存的修改");
  }
  const save = useCallback(
    async (auto = false): Promise<AdminDocument | null> => {
      if (busyRef.current) return null;
      if (auto && !data.title.trim()) return null;
      busyRef.current = true;
      setBusy(true);
      setError("");
      const snapshot = serial.current;
      const nextData = {
        ...data,
        slug: data.slug.trim() || "note-" + Date.now().toString(36),
      };
      try {
        const result = await saveDocument({
          id: record?.id,
          kind,
          expectedVersion: record?.version,
          data: nextData,
        });
        if (!result.ok) {
          setError(result.error);
          return null;
        }
        setRecord(result.data);
        if (serial.current === snapshot) {
          setData(result.data.draft);
          setDirty(false);
        }
        setMessage(auto ? "已自动保存" : "草稿已保存");
        if (
          window.location.pathname.endsWith("/new") &&
          serial.current === snapshot
        )
          window.history.replaceState(
            null,
            "",
            "/admin/" + section + "/" + result.data.id,
          );
        return result.data;
      } catch {
        setError("保存未完成，请检查连接后重试。你的修改仍保留在编辑器中。");
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [data, record, kind, section],
  );
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void save(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, [dirty, save]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function transition(action: TransitionInput["action"]) {
    if (busyRef.current) return;
    setConfirmAction(null);
    let current = record;
    if (dirty || !current) {
      current = await save();
      if (!current) return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await transitionDocument({
        id: current.id,
        expectedVersion: current.version,
        action,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (action === "delete" || action === "trash") {
        router.push("/admin/" + section);
        router.refresh();
        return;
      }
      if (result.data) setRecord(result.data);
      setMessage(
        (
          {
            submit: "已提交审核",
            publish: "已发布，访客现在可以阅读",
            return: "已退回草稿",
            unpublish: "已撤回公开版本",
            restore: "已从回收站恢复",
          } as Record<string, string>
        )[action] || "已更新",
      );
      router.refresh();
    } catch {
      setError("操作未完成，请重试。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function loadHistory() {
    if (!record) return;
    try {
      setHistory(history === null ? await getRevisions(record.id) : null);
    } catch {
      setError("无法读取修订记录。");
    }
  }
  async function restore(revision: DocumentRevision) {
    if (!record || busy) return;
    setBusy(true);
    try {
      const result = await restoreRevision(
        record.id,
        revision.id,
        record.version,
      );
      if (!result.ok) setError(result.error);
      else {
        setRecord(result.data);
        setData(result.data.draft);
        setDirty(false);
        setRevisionKey(revision.id + "-" + result.data.version);
        setMessage("修订已恢复为草稿，公开版本保持不变");
        setHistory(null);
      }
    } catch {
      setError("恢复失败，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function coverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const media = await uploadFile(file);
      update({ coverUrl: media.url, coverAlt: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      e.target.value = "";
    }
  }
  return (
    <>
      <header className={styles.editorHeading}>
        <div>
          <Link className={styles.backLink} href={"/admin/" + section}>
            <ArrowLeft size={14} />
            {kind === "post" ? "文章管理" : "静态页面"}
          </Link>
          <h1>
            {initial
              ? "编辑" + (kind === "post" ? "文章" : "页面")
              : "新的" + (kind === "post" ? "文章" : "页面")}
            <span className={styles.status}>
              {record ? stateNames[record.status] : "草稿"}
            </span>
          </h1>
        </div>
        <div className={styles.editorActions}>
          {record && (
            <Link
              className="button secondary"
              href={"/admin/preview/" + record.id}
              target="_blank"
            >
              预览
              <ArrowUpRight size={14} />
            </Link>
          )}
          <button
            className="button secondary"
            onClick={() => void save()}
            disabled={busy || !!record?.deletedAt}
          >
            <Save size={15} />
            保存草稿
          </button>
          {canPublish ? (
            <button
              className="button"
              disabled={busy || !!record?.deletedAt}
              onClick={() => void transition("publish")}
            >
              <Send size={15} />
              {record?.published ? "更新发布" : "发布"}
            </button>
          ) : (
            <button
              className="button"
              disabled={
                busy || !!record?.deletedAt || record?.status === "review"
              }
              onClick={() => void transition("submit")}
            >
              <Send size={15} />
              提交审核
            </button>
          )}
        </div>
      </header>
      <div className={styles.editorNotice} aria-live="polite">
        {error ? (
          <span className="form-error" role="alert">
            {error}
          </span>
        ) : (
          <span>
            {busy ? "正在保存…" : message || "修改会自动保存为草稿"}
            {record?.published && " · 当前修改不会影响已发布版本"}
          </span>
        )}
      </div>
      <div className={styles.editorLayout}>
        <div className={styles.editorMain}>
          <div className={styles.titleFields}>
            <label className={styles.srOnly} htmlFor="document-title">
              标题
            </label>
            <input
              id="document-title"
              className={styles.titleInput}
              placeholder={
                kind === "post" ? "为这篇记录起一个标题…" : "页面标题…"
              }
              value={data.title}
              onChange={(e) => update({ title: e.target.value })}
              maxLength={200}
            />
            <label className={styles.srOnly} htmlFor="document-excerpt">
              {kind === "post" ? "摘要" : "页面简介"}
            </label>
            <textarea
              id="document-excerpt"
              placeholder={
                kind === "post"
                  ? "用一两句话，让读者知道你正在思考什么。"
                  : "简短介绍这个页面。"
              }
              value={kind === "post" ? data.excerpt : data.description}
              onChange={(e) =>
                update(
                  kind === "post"
                    ? { excerpt: e.target.value }
                    : { description: e.target.value },
                )
              }
              maxLength={500}
            />
          </div>
          {kind === "post" ? (
            <RichEditor
              value={data.body}
              onChange={(body) => update({ body })}
              revisionKey={revisionKey}
            />
          ) : (
            <BlockEditor
              key={revisionKey}
              blocks={data.blocks}
              onChange={(blocks) => update({ blocks })}
              members={members}
            />
          )}
        </div>
        <aside className={styles.editorAside}>
          <section>
            <h2>发布设置</h2>
            <div className="field">
              <label htmlFor="document-slug">页面地址</label>
              <input
                id="document-slug"
                value={data.slug}
                onChange={(e) => update({ slug: e.target.value })}
                placeholder="留空自动生成"
              />
              <small>使用英文字母、数字和短横线。</small>
            </div>
            {kind === "post" && (
              <>
                <div className="field">
                  <label htmlFor="document-category">分类</label>
                  <select
                    id="document-category"
                    value={data.categoryId || ""}
                    onChange={(e) =>
                      update({ categoryId: e.target.value || null })
                    }
                  >
                    <option value="">未分类</option>
                    {taxonomy.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.checkList}>
                  <span>标签</span>
                  {taxonomy.tags.map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={data.tagIds.includes(t.id)}
                        onChange={(e) =>
                          update({
                            tagIds: e.target.checked
                              ? [...data.tagIds, t.id]
                              : data.tagIds.filter((id) => id !== t.id),
                          })
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={data.featured}
                    onChange={(e) => update({ featured: e.target.checked })}
                  />
                  推荐文章
                </label>
              </>
            )}
          </section>
          {kind === "post" && (
            <section>
              <h2>文章封面</h2>
              {data.coverUrl ? (
                <div className={styles.coverPreview}>
                  <img src={data.coverUrl} alt={data.coverAlt} />
                  <button
                    aria-label="移除封面"
                    onClick={() => update({ coverUrl: null, coverAlt: "" })}
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button
                  className={styles.coverUpload}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={23} />
                  <span>上传封面图片</span>
                  <small>JPG、PNG、WebP、AVIF · 12 MB 内</small>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                hidden
                onChange={coverUpload}
              />
              {data.coverUrl && (
                <div className="field">
                  <label htmlFor="cover-alt">图片替代文字</label>
                  <input
                    id="cover-alt"
                    value={data.coverAlt}
                    onChange={(e) => update({ coverAlt: e.target.value })}
                  />
                  <button
                    className={styles.smallButton}
                    onClick={() => fileRef.current?.click()}
                  >
                    更换封面
                  </button>
                </div>
              )}
            </section>
          )}
          {record && (
            <section>
              <h2>记录与管理</h2>
              <button className={styles.asideAction} onClick={loadHistory}>
                <History size={15} />
                修订记录<span>{history ? "收起" : "查看"}</span>
              </button>
              {history?.map((r) => (
                <div key={r.id} className={styles.revision}>
                  <strong>版本 {r.version}</strong>
                  <small>
                    {new Date(r.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {r.actorName}
                  </small>
                  <p>{r.note}</p>
                  <button
                    className={styles.smallButton}
                    disabled={busy || dirty}
                    onClick={() => void restore(r)}
                  >
                    <RotateCcw size={12} />
                    恢复为草稿
                  </button>
                </div>
              ))}
              {canPublish && record.status === "review" && (
                <button
                  className={styles.asideAction}
                  disabled={busy}
                  onClick={() => void transition("return")}
                >
                  退回修改
                  <RotateCcw size={15} />
                </button>
              )}
              {canPublish && record.published && (
                <button
                  className={styles.asideAction}
                  disabled={busy}
                  onClick={() => setConfirmAction("unpublish")}
                >
                  撤回公开版本
                  <RotateCcw size={15} />
                </button>
              )}
              {record.deletedAt ? (
                <>
                  <button
                    className={styles.asideAction}
                    disabled={busy}
                    onClick={() => void transition("restore")}
                  >
                    从回收站恢复
                    <RotateCcw size={15} />
                  </button>
                  {role === "admin" && (
                    <button
                      className={styles.asideAction}
                      onClick={() => setConfirmAction("delete")}
                    >
                      永久删除
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              ) : (
                <button
                  className={styles.asideAction}
                  disabled={busy}
                  onClick={() => setConfirmAction("trash")}
                >
                  移入回收站
                  <Trash2 size={15} />
                </button>
              )}
            </section>
          )}
        </aside>
      </div>
      {confirmAction && (
        <ConfirmationDialog onClose={() => setConfirmAction(null)}>
          <h2 id="confirm-title">
            {confirmAction === "trash"
              ? "移入回收站？"
              : confirmAction === "delete"
                ? "永久删除这条记录？"
                : "撤回公开版本？"}
          </h2>
          <p>
            {confirmAction === "delete"
              ? "内容与修订记录将永久删除，无法恢复。"
              : confirmAction === "trash"
                ? "读者将无法访问此内容。你可以稍后从回收站恢复。"
                : "内容将不再公开展示，草稿与修订记录仍然保留。"}
          </p>
          <div className={styles.modalActions}>
            <button
              className="button secondary"
              onClick={() => setConfirmAction(null)}
            >
              取消
            </button>
            <button
              className="button danger"
              onClick={() => void transition(confirmAction)}
            >
              确认
              {confirmAction === "delete"
                ? "永久删除"
                : confirmAction === "trash"
                  ? "移入回收站"
                  : "撤回"}
            </button>
          </div>
        </ConfirmationDialog>
      )}
    </>
  );
}
