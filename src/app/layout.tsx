/* eslint-disable @next/next/no-css-tags -- Unicode-ranged, self-hosted CJK font subsets use a public stylesheet. */
import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: {
    default: "Darwin动漫社 · 用科学与人文创造幻想中的未来",
    template: "%s · Darwin动漫社",
  },
  description:
    "一处连接想象与求知的交汇点。动画、自然科学、人文与人工智能，在这里相遇。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
