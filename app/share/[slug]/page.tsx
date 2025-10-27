import type React from "react";
import { notFound } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { NavigationViewer } from "@/components/navigation-viewer";
import {
  calculateBookmarkStatistics,
  cloneBookmarkNode,
  findFolderWithTrail,
  type BookmarkDocument,
  type BookmarkNode,
} from "@/lib/bookmarks";
import { formatDate } from "@/lib/utils";

export const revalidate = 0;
export const dynamic = "force-dynamic";

interface SharePageProps {
  params: { slug: string };
}

export default async function SharePage({ params }: SharePageProps) {
  const admin = getSupabaseAdminClient();
  const { data: shareSite, error: shareSiteError } = await admin
    .from("share_sites")
    .select("id, name, share_slug, folder_id, collection_id")
    .eq("share_slug", params.slug)
    .maybeSingle();

  if (shareSiteError || !shareSite) {
    notFound();
  }

  const { data: collection, error: collectionError } = await admin
    .from("bookmark_collections")
    .select("data, updated_at, title, user_id")
    .eq("id", shareSite.collection_id)
    .maybeSingle();

  if (collectionError || !collection || !collection.data) {
    notFound();
  }

  const originalDocument = collection.data as BookmarkDocument;
  const folderLookup = findFolderWithTrail(originalDocument.root, shareSite.folder_id);

  if (!folderLookup) {
    notFound();
  }

  const clonedRoot = cloneBookmarkNode(folderLookup.node) as BookmarkNode & { type: "folder" };
  const siteTitleCandidate =
    shareSite.name?.trim() ||
    originalDocument.metadata?.siteTitle?.trim() ||
    collection.title?.trim() ||
    folderLookup.node.name?.trim() ||
    originalDocument.root.name?.trim() ||
    "书签导航";

  const sharedDocument: BookmarkDocument = {
    ...originalDocument,
    root: clonedRoot,
    metadata: {
      ...originalDocument.metadata,
      siteTitle: siteTitleCandidate,
    },
    statistics: calculateBookmarkStatistics(clonedRoot),
  };

  let contactEmail = sharedDocument.metadata?.contactEmail?.trim() ?? "";

  if (!contactEmail && collection.user_id) {
    try {
      const { data: owner } = await admin.auth.admin.getUserById(collection.user_id);
      contactEmail = owner?.user?.email?.trim() ?? "";
    } catch {
      // ignore missing owner email
    }
  }

  const viewerHeader = (
    <span style={shareUpdatedStyle}>最近更新：{formatDate(collection.updated_at)}</span>
  );

  return (
    <main style={shareMainStyle}>
      <section style={viewerSectionStyle}>
        <NavigationViewer
          document={sharedDocument}
          emptyHint="暂无可展示的书签"
          siteTitle={siteTitleCandidate}
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
