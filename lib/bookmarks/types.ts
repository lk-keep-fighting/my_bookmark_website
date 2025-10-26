export type BookmarkNode = {
  type: "folder" | "bookmark";
  name: string;
  id: string;
  url?: string;
  children?: BookmarkNode[];
  add_date?: string;
  last_modified?: string;
  icon?: string;
  description?: string;
  tags?: string[];
};

export type BookmarkStatistics = {
  total_folders: number;
  total_bookmarks: number;
};

export type BookmarkDocumentMetadata = {
  siteTitle?: string | null;
  contactEmail?: string | null;
};

export type BookmarkDocument = {
  version: number;
  generated_at: string;
  source: string;
  generator: string;
  statistics: BookmarkStatistics;
  root: BookmarkNode;
  metadata?: BookmarkDocumentMetadata;
};
