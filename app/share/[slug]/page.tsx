import type React from "react";
import { notFound } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { NavigationViewer } from "@/components/navigation-viewer";
import { formatDate } from "@/lib/utils";

interface SharePageProps {
  params: { slug: string };
}

export default async function SharePage({ params }: SharePageProps) {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from("bookmark_collections")
    .select("data, updated_at, title, user_id")
    .eq("share_slug", params.slug)
    .maybeSingle();

  if (error || !data || !data.data) {
    notFound();
  }

  return (
    <main style={shareMainStyle}>
      <header style={shareHeaderStyle}>
        <div style={shareHeaderContentStyle}>
          <span style={shareBadgeStyle}>共享导航站</span>
          <h1 style={shareTitleStyle}>{data.title ?? "书签导航"}</h1>
          <p style={shareMetaStyle}>最近更新：{formatDate(data.updated_at)}</p>
        </div>
      </header>

      <section style={viewerSectionStyle}>
        <NavigationViewer document={data.data} emptyHint="暂无可展示的书签" />
      </section>
    </main>
  );
}

const shareMainStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
};

const shareHeaderStyle: React.CSSProperties = {
  padding: "48px clamp(24px, 8vw, 72px) 24px",
};

const shareHeaderContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  maxWidth: "960px",
  margin: "0 auto",
};

const shareBadgeStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 14px",
  borderRadius: "999px",
  background: "rgba(59, 130, 246, 0.15)",
  color: "#1d4ed8",
  fontSize: "13px",
  fontWeight: 600,
};

const shareTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "40px",
  fontWeight: 700,
  color: "#0f172a",
  letterSpacing: "-0.5px",
};

const shareMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "15px",
  color: "#475569",
};

const viewerSectionStyle: React.CSSProperties = {
  flex: "1 1 auto",
  display: "flex",
  padding: "0 clamp(24px, 8vw, 72px) 56px",
  width: "100%",
  maxWidth: "1400px",
  margin: "0 auto",
};
