import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "导航站 SaaS",
  description: "导入浏览器书签，构建并分享你的个人导航站",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
