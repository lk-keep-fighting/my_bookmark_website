import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import {
  calculateBookmarkStatistics,
  findFolderWithTrail,
  type BookmarkDocument,
  type BookmarkNode,
} from "@/lib/bookmarks";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSupabaseContext } from "@/lib/supabase/authenticate";
import type { Database } from "@/lib/supabase/types";
import { generateShareSlug } from "@/lib/utils";
import { mapShareSiteRow, type ShareSiteRow, type ShareSiteSummary } from "@/lib/share-sites";

const NODE_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const generateNodeId = customAlphabet(NODE_ID_ALPHABET, 24);
const DEFAULT_TABS_FOLDER_NAME = "当前打开的页面";

interface TabPayload {
  title?: string;
  url?: string;
  favIconUrl?: string;
}

interface UploadTabsPayload {
  name?: string;
  folderIds?: string[];
  tabs?: TabPayload[];
  tabsFolderName?: string;
}

export async function POST(request: Request) {
  let authContext;
  try {
    authContext = await getAuthenticatedSupabaseContext(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法加载认证配置";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!authContext) {
    return NextResponse.json({ error: "请先登录导航站账户后再上传分享站" }, { status: 401 });
  }

  let payload: UploadTabsPayload;
  try {
    payload = (await request.json()) as UploadTabsPayload;
  } catch (error) {
    return NextResponse.json({ error: "请求体解析失败，请确认使用 JSON 格式" }, { status: 400 });
  }

  const trimmedName = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!trimmedName) {
    return NextResponse.json({ error: "请填写分享站名称" }, { status: 400 });
  }

  const normalizedFolderIds = Array.from(
    new Set(
      (Array.isArray(payload.folderIds) ? payload.folderIds : [])
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );

  const sanitizedTabs = (Array.isArray(payload.tabs) ? payload.tabs : [])
    .map((tab) => {
      const url = typeof tab?.url === "string" ? tab.url.trim() : "";
      const title = typeof tab?.title === "string" ? tab.title.trim() : "";
      const favIconUrl = typeof tab?.favIconUrl === "string" ? tab.favIconUrl.trim() : undefined;
      return { title, url, favIconUrl };
    })
    .filter((tab) => tab.url && isShareableUrl(tab.url));

  if (normalizedFolderIds.length === 0 && sanitizedTabs.length === 0) {
    return NextResponse.json({ error: "请选择至少一个目录或标签页" }, { status: 400 });
  }

  const tabsFolderNameRaw = typeof payload.tabsFolderName === "string" ? payload.tabsFolderName.trim() : "";

  const { supabase, user } = authContext;
  const { data: collection, error: collectionError } = await supabase
    .from("bookmark_collections")
    .select("id, data, updated_at, title")
    .maybeSingle<{
      id: string;
      data: BookmarkDocument | null;
      updated_at: string | null;
      title: string | null;
    }>();

  if (collectionError) {
    return NextResponse.json({ error: collectionError.message }, { status: 500 });
  }

  const existingDocument = collection?.data ?? null;
  const existingCollectionId = collection?.id ?? null;
  const previousUpdatedAt = collection?.updated_at ?? null;

  if (!existingDocument && normalizedFolderIds.length > 0) {
    return NextResponse.json({ error: "当前账号暂无可用目录，请至少选择一个标签页上传" }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowUnix = Math.floor(now.getTime() / 1000).toString();

  let nextDocument: BookmarkDocument | null = null;
  let shareFolderIds: string[] = [];
  let createdFolderInfo: { id: string; name: string } | null = null;
  let targetCollectionId = existingCollectionId;

  if (existingDocument) {
    if (existingDocument.root.type !== "folder") {
      return NextResponse.json({ error: "书签数据结构异常，无法创建分享站" }, { status: 500 });
    }

    const folderValidationResults = normalizedFolderIds.map((folderId) => ({
      folderId,
      result: findFolderWithTrail(existingDocument.root, folderId),
    }));

    const missingFolder = folderValidationResults.find((item) => !item.result);
    if (missingFolder) {
      return NextResponse.json({ error: "未找到指定目录，请刷新后重试" }, { status: 404 });
    }

    shareFolderIds = folderValidationResults.map((item) => item.folderId);

    if (sanitizedTabs.length > 0) {
      const documentClone = structuredClone(existingDocument) as BookmarkDocument;
      const rootNode = documentClone.root;
      if (rootNode.type !== "folder") {
        return NextResponse.json({ error: "书签数据结构异常，无法创建分享站" }, { status: 500 });
      }

      const folderName = tabsFolderNameRaw || DEFAULT_TABS_FOLDER_NAME;
      const folderId = generateNodeId();
      const newFolder: BookmarkNode & { type: "folder" } = {
        type: "folder",
        id: folderId,
        name: folderName,
        add_date: nowUnix,
        last_modified: nowUnix,
        children: sanitizedTabs.map((tab) => buildBookmarkNodeFromTab(tab, nowUnix)),
      };

      if (!Array.isArray(rootNode.children)) {
        rootNode.children = [];
      }
      rootNode.children.push(newFolder);
      rootNode.last_modified = nowUnix;

      documentClone.statistics = calculateBookmarkStatistics(documentClone.root);
      nextDocument = documentClone;
      shareFolderIds = Array.from(new Set([...shareFolderIds, folderId]));
      createdFolderInfo = { id: folderId, name: folderName };
    } else {
      nextDocument = existingDocument;
    }
  } else {
    // 没有现有导航数据，仅根据标签页生成新的文档
    if (sanitizedTabs.length === 0) {
      return NextResponse.json({ error: "暂无可用数据生成分享站" }, { status: 400 });
    }

    const rootId = generateNodeId();
    const folderId = generateNodeId();
    const folderName = tabsFolderNameRaw || DEFAULT_TABS_FOLDER_NAME;
    const folderNode: BookmarkNode & { type: "folder" } = {
      type: "folder",
      id: folderId,
      name: folderName,
      add_date: nowUnix,
      last_modified: nowUnix,
      children: sanitizedTabs.map((tab) => buildBookmarkNodeFromTab(tab, nowUnix)),
    };

    const rootNode: BookmarkNode & { type: "folder" } = {
      type: "folder",
      id: rootId,
      name: "我的导航站",
      add_date: nowUnix,
      last_modified: nowUnix,
      children: [folderNode],
    };

    const statistics = calculateBookmarkStatistics(rootNode);
    const metadata = {
      siteTitle: "我的导航站",
      contactEmail: user.email ?? null,
    };

    nextDocument = {
      version: 1,
      generated_at: nowIso,
      source: "extension",
      generator: "browser-extension",
      statistics,
      root: rootNode,
      metadata,
    } satisfies BookmarkDocument;

    shareFolderIds = [folderId];
    createdFolderInfo = { id: folderId, name: folderName };
  }

  if (shareFolderIds.length === 0) {
    return NextResponse.json({ error: "未找到可用的分享目录" }, { status: 400 });
  }

  const shouldPersistDocument = !existingDocument || sanitizedTabs.length > 0;

  if (shouldPersistDocument) {
    if (!nextDocument) {
      return NextResponse.json({ error: "缺少书签数据，无法保存" }, { status: 500 });
    }

    const updates: Database["public"]["Tables"]["bookmark_collections"]["Update"] = {
      data: nextDocument,
      updated_at: nowIso,
    };

    const inferredTitle = nextDocument?.metadata?.siteTitle?.trim() || nextDocument?.root?.name?.trim() || null;
    updates.title = inferredTitle;

    if (targetCollectionId) {
      const { error: updateError } = await admin
        .from("bookmark_collections")
        .update(updates)
        .eq("id", targetCollectionId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else {
      const collectionInsert = {
        user_id: user.id,
        data: nextDocument,
        share_slug: generateShareSlug(),
        created_at: nowIso,
        updated_at: nowIso,
        title: updates.title,
      } satisfies Database["public"]["Tables"]["bookmark_collections"]["Insert"];

      const { data: insertedCollection, error: insertError } = await admin
        .from("bookmark_collections")
        .insert(collectionInsert)
        .select("id")
        .single<{ id: string }>();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      targetCollectionId = insertedCollection.id;
    }
  }

  if (!targetCollectionId) {
    return NextResponse.json({ error: "未能确认书签集合标识" }, { status: 500 });
  }

  const baseInsert: Omit<Database["public"]["Tables"]["share_sites"]["Insert"], "share_slug"> = {
    user_id: user.id,
    collection_id: targetCollectionId,
    name: trimmedName,
    folder_ids: shareFolderIds,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const adminClient = admin;
  let inserted: ShareSiteSummary | null = null;
  let attemptError: string | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareSlug = generateShareSlug();
    const { data: insertData, error: insertError } = await adminClient
      .from("share_sites")
      .insert({ ...baseInsert, share_slug: shareSlug })
      .select("id, name, share_slug, folder_ids, created_at, updated_at")
      .single<ShareSiteRow>();

    if (!insertError && insertData) {
      inserted = mapShareSiteRow(insertData);
      break;
    }

    if (insertError?.code === "23505") {
      attemptError = insertError.message;
      continue;
    }

    attemptError = insertError?.message ?? null;
    break;
  }

  if (!inserted) {
    if (shouldPersistDocument && existingDocument && targetCollectionId) {
      await adminClient
        .from("bookmark_collections")
        .update({
          data: existingDocument,
          updated_at: previousUpdatedAt ?? nowIso,
          title: collection?.title ?? null,
        })
        .eq("id", targetCollectionId);
    }

    return NextResponse.json({ error: attemptError ?? "创建分享站失败" }, { status: 500 });
  }

  const responsePayload: Record<string, unknown> = {
    item: inserted,
  };

  if (createdFolderInfo) {
    responsePayload.createdFolder = createdFolderInfo;
  }

  return NextResponse.json(responsePayload);
}

function isShareableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildBookmarkNodeFromTab(tab: { title: string; url: string; favIconUrl?: string }, timestamp: string): BookmarkNode {
  const bookmark: BookmarkNode = {
    type: "bookmark",
    id: generateNodeId(),
    name: tab.title || tab.url,
    url: tab.url,
    add_date: timestamp,
    last_modified: timestamp,
  };

  if (tab.favIconUrl) {
    bookmark.icon = tab.favIconUrl;
  }

  return bookmark;
}
