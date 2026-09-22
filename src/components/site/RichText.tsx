/* eslint-disable @next/next/no-img-element -- Controlled media must bypass the public image optimizer cache. */
import Link from "next/link";
import katex from "katex";
import type { RichNode } from "@/lib/content/types";
export function nodeText(node: RichNode): string {
  return node.text || node.content?.map(nodeText).join("") || "";
}
export function headingId(text: string, index: number) {
  return `section-${index}-${text.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)}`;
}
export function safeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(value) ? value : "";
}
export function RichText({ doc }: { doc: RichNode }) {
  let headingIndex = 0;
  function render(n: RichNode, key: string | number): React.ReactNode {
    const children = n.content?.map((c, i) => render(c, `${key}-${i}`));
    if (n.type === "text") {
      let text: React.ReactNode = n.text;
      for (const mark of n.marks || []) {
        if (mark.type === "bold") text = <strong>{text}</strong>;
        if (mark.type === "italic") text = <em>{text}</em>;
        if (mark.type === "strike") text = <s>{text}</s>;
        if (mark.type === "code") text = <code>{text}</code>;
        if (mark.type === "link") {
          const href = safeUrl(mark.attrs?.href);
          if (href)
            text = (
              <Link href={href} rel="noopener noreferrer">
                {text}
              </Link>
            );
        }
      }
      return <span key={key}>{text}</span>;
    }
    switch (n.type) {
      case "doc":
        return (
          <div key={key} className="prose">
            {children}
          </div>
        );
      case "paragraph":
        return <p key={key}>{children?.length ? children : <br />}</p>;
      case "heading": {
        const level = Number(n.attrs?.level) || 2;
        const id = headingId(nodeText(n), headingIndex++);
        return level === 3 ? (
          <h3 id={id} key={key}>
            {children}
          </h3>
        ) : level >= 4 ? (
          <h4 id={id} key={key}>
            {children}
          </h4>
        ) : (
          <h2 id={id} key={key}>
            {children}
          </h2>
        );
      }
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList":
        return <ol key={key}>{children}</ol>;
      case "listItem":
        return <li key={key}>{children}</li>;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      case "codeBlock":
        return (
          <pre key={key}>
            <code>{nodeText(n)}</code>
          </pre>
        );
      case "hardBreak":
        return <br key={key} />;
      case "horizontalRule":
        return <hr key={key} />;
      case "image": {
        const src = safeUrl(n.attrs?.src);
        return src ? (
          <figure key={key}>
            <img src={src} alt={String(n.attrs?.alt || "")} loading="lazy" />
            {n.attrs?.title ? (
              <figcaption>{String(n.attrs.title)}</figcaption>
            ) : null}
          </figure>
        ) : null;
      }
      case "table":
        return (
          <div key={key} className="table-scroll">
            <table>
              <tbody>{children}</tbody>
            </table>
          </div>
        );
      case "tableRow":
        return <tr key={key}>{children}</tr>;
      case "tableHeader":
        return <th key={key}>{children}</th>;
      case "tableCell":
        return <td key={key}>{children}</td>;
      case "inlineMath":
      case "blockMath": {
        const html = katex.renderToString(String(n.attrs?.latex || ""), {
          displayMode: n.type === "blockMath",
          throwOnError: false,
          trust: false,
          strict: "warn",
        });
        return n.type === "blockMath" ? (
          <div
            className="math-block"
            key={key}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <span key={key} dangerouslySetInnerHTML={{ __html: html }} />
        );
      }
      default:
        return <span key={key}>{children}</span>;
    }
  }
  return render(doc, "doc");
}
