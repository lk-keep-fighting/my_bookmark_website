import type { Database } from "./supabase/types";

export type ShareSiteRow = Pick<
  Database["public"]["Tables"]["share_sites"]["Row"],
  "id" | "name" | "share_slug" | "folder_id" | "created_at" | "updated_at"
>;

export type ShareSiteSummary = {
  id: string;
  name: string;
  shareSlug: string;
  folderId: string;
  createdAt: string;
  updatedAt: string;
};

export function mapShareSiteRow(row: ShareSiteRow): ShareSiteSummary {
  return {
    id: row.id,
    name: row.name,
    shareSlug: row.share_slug,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapShareSiteRows(rows: ShareSiteRow[] | null | undefined): ShareSiteSummary[] {
  if (!rows || rows.length === 0) {
    return [];
  }
  return rows.map((row) => mapShareSiteRow(row));
}
