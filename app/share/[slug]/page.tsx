import type React from "react";
import { notFound } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { NavigationViewer } from "@/components/navigation-viewer";
import type { BookmarkDocument } from "@/lib/bookmarks";
import { formatDate } from "@/lib/utils";

export const revalidate = 0;
export const dynamic = "force-dynamic";

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

  const document = data.data as BookmarkDocument;
  const metadata = document.metadata ?? {};
  const siteTitle =
    metadata.siteTitle?.trim() ?? data.title?.trim() ?? document.root.name?.trim() ?? "书签导航";
  let contactEmail = metadata.contactEmail?.trim() ?? "";

  if (!contactEmail && data.user_id) {
    try {
      const { data: owner } = await admin.auth.admin.getUserById(data.user_id);
      contactEmail = owner?.user?.email?.trim() ?? "";
    } catch {
      // ignore missing owner email
    }
  }

  const viewerHeader = (
    <span style={shareUpdatedStyle}>最近更新：{formatDate(data.updated_at)}</span>
  );

  return (
    <main style={shareMainStyle}>
      <section style={viewerSectionStyle}>
        <NavigationViewer
          document={document}
          emptyHint="暂无可展示的书签"
          siteTitle={siteTitle}
          contactEmail={contactEmail || undefined}
          header={viewerHeader}
        />
      </section>
    </main>
  );
}

const shareMainStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
};

const shareUpdatedStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#64748b",
};

const viewerSectionStyle: React.CSSProperties = {
  flex: "1 1 auto",
  display: "flex",
  padding: "60px clamp(24px, 8vw, 72px) 72px",
  width: "100%",
  maxWidth: "1400px",
  margin: "0 auto",
};
