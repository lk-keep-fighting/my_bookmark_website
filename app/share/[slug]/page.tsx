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
    <main style={mainStyle}>
      <section style={panelStyle}>
        <header style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "14px", color: "#3b82f6", fontWeight: 600 }}>共享导航站</span>
          <h1 style={{ margin: 0 }}>{data.title ?? "书签导航"}</h1>
          <p style={{ margin: 0, color: "#6b7280" }}>最近更新：{formatDate(data.updated_at)}</p>
        </header>
        <NavigationViewer document={data.data} emptyHint="暂无可展示的书签" />
      </section>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "48px 16px 80px",
};

const panelStyle: React.CSSProperties = {
  width: "min(1024px, 100%)",
  background: "rgba(255, 255, 255, 0.94)",
  borderRadius: "32px",
  padding: "36px 44px",
  boxShadow: "0 40px 90px rgba(15, 23, 42, 0.14)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};
