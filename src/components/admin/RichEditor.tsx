"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Mathematics } from "@tiptap/extension-mathematics";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code2,
  ImagePlus,
  Link2,
  Table2,
  Undo2,
  Redo2,
  Sigma,
  Minus,
  Unlink,
} from "lucide-react";
import type { RichNode, MediaItem } from "@/lib/cms/types";
import styles from "./Admin.module.css";
export async function uploadFile(file: File): Promise<MediaItem> {
  if (file.size > 12 * 1024 * 1024)
    throw new Error("图片不能超过 12 MB。");
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/media", { method: "POST", body: form });
  const result = await response.json().catch(() => null);
  if (!result)
    throw new Error(
      response.status === 413
        ? "图片不能超过 12 MB。"
        : "上传服务暂时不可用，请稍后重试。",
    );
  if (!response.ok || !result.ok)
    throw new Error(result.error || "图片上传失败");
  return result.data;
}
export function RichEditor({
  value,
  onChange,
  revisionKey = "initial",
}: {
  value: RichNode;
  onChange: (value: RichNode) => void;
  revisionKey?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  const [panel, setPanel] = useState<"link" | "math" | null>(null),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    [mathKind, setMathKind] = useState<"blockMath" | "inlineMath">("blockMath");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false,
        link: {
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer" },
        },
      }),
      Image.configure({ allowBase64: false }),
      TableKit.configure({ table: { resizable: false } }),
      Mathematics.configure({
        katexOptions: { throwOnError: false, trust: false },
      }),
      Placeholder.configure({
        placeholder: "从一个问题、一段观察，或一个尚未完成的想法开始…",
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose " + styles.editable,
        role: "textbox",
        "aria-label": "正文编辑器",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) =>
      callback.current(
        JSON.parse(JSON.stringify(editor.getJSON())) as RichNode,
      ),
  });
  const revisionRef = useRef(revisionKey);
  useEffect(() => {
    if (editor && revisionRef.current !== revisionKey) {
      editor.commands.setContent(value, { emitUpdate: false });
      revisionRef.current = revisionKey;
    }
  }, [editor, revisionKey, value]);
  if (!editor)
    return <div className={styles.editorLoading}>正在准备编辑器…</div>;
  const buttons = [
    {
      label: "粗体",
      Icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      Icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "无序列表",
      Icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      Icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      Icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "代码块",
      Icon: Code2,
      active: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "插入表格",
      Icon: Table2,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      label: "分隔线",
      Icon: Minus,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];
  async function fileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const media = await uploadFile(file);
      editor
        ?.chain()
        .focus()
        .setImage({ src: media.url, alt: file.name })
        .run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }
  function insert() {
    if (!input.trim()) return;
    if (panel === "link") {
      if (!/^(https?:\/\/|mailto:|\/(?!\/))/.test(input)) {
        setError("请输入完整的 https:// 链接或站内路径。");
        return;
      }
      editor?.chain().focus().setLink({ href: input.trim() }).run();
    } else
      editor
        ?.chain()
        .focus()
        .insertContent({ type: mathKind, attrs: { latex: input.trim() } })
        .run();
    setPanel(null);
    setInput("");
    setError("");
  }
  return (
    <div className={styles.richEditor}>
      <div className={styles.editorToolbar} aria-label="正文格式工具栏">
        <select
          aria-label="段落样式"
          value={
            editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : "p"
          }
          onChange={(e) =>
            e.target.value === "p"
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: e.target.value === "h2" ? 2 : 3 })
                  .run()
          }
        >
          <option value="p">正文</option>
          <option value="h2">大标题</option>
          <option value="h3">小标题</option>
        </select>
        <span className={styles.toolDivider} />
        {buttons.map((b) => (
          <button
            type="button"
            key={b.label}
            title={b.label}
            aria-label={b.label}
            aria-pressed={b.active || false}
            onClick={b.run}
          >
            <b.Icon size={16} />
          </button>
        ))}
        <span className={styles.toolDivider} />
        <button
          type="button"
          aria-label="插入链接"
          title="插入链接"
          onClick={() => {
            setPanel(panel === "link" ? null : "link");
            setInput(editor.getAttributes("link").href || "");
          }}
        >
          <Link2 size={16} />
        </button>
        {editor.isActive("link") && (
          <button
            type="button"
            aria-label="移除链接"
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Unlink size={16} />
          </button>
        )}
        <button
          type="button"
          aria-label="插入公式"
          title="插入公式"
          onClick={() => {
            setPanel(panel === "math" ? null : "math");
            setInput("");
          }}
        >
          <Sigma size={17} />
        </button>
        <button
          type="button"
          aria-label="上传正文图片"
          title="上传图片"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={17} />
        </button>
        <span className={styles.toolDivider} />
        <button
          type="button"
          aria-label="撤销"
          title="撤销"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          aria-label="重做"
          title="重做"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          hidden
          onChange={fileChange}
        />
      </div>
      {panel && (
        <div className={styles.editorInsert}>
          <label htmlFor={"insert-" + panel}>
            {panel === "link" ? "链接地址" : "LaTeX 公式"}
          </label>
          {panel === "math" && (
            <select
              aria-label="公式位置"
              value={mathKind}
              onChange={(e) =>
                setMathKind(e.target.value as "blockMath" | "inlineMath")
              }
            >
              <option value="blockMath">独立公式</option>
              <option value="inlineMath">行内公式</option>
            </select>
          )}
          <input
            id={"insert-" + panel}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={panel === "link" ? "https://…" : "E = mc^2"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insert();
              }
            }}
          />
          <button type="button" className="button secondary" onClick={insert}>
            插入
          </button>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => setPanel(null)}
          >
            取消
          </button>
        </div>
      )}
      {editor.isActive("image") && (
        <div className={styles.editorInsert}>
          <label htmlFor="image-caption">图片说明</label>
          <input
            id="image-caption"
            placeholder="为选中的图片添加说明"
            defaultValue={String(editor.getAttributes("image").title || "")}
            onBlur={(e) =>
              editor
                .chain()
                .focus()
                .updateAttributes("image", {
                  title: e.target.value,
                  alt: e.target.value,
                })
                .run()
            }
          />
        </div>
      )}
      {editor.isActive("table") && (
        <div className={styles.tableTools}>
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            添加行
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            添加列
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            删除行
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            删除列
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            移除表格
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {uploading && <p className="muted">图片上传中…</p>}
      <EditorContent editor={editor} />
    </div>
  );
}
