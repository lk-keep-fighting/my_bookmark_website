import type { BookmarkNode, BookmarkStatistics } from "./types";

function walk(node: BookmarkNode): { folders: number; bookmarks: number } {
  if (node.type === "bookmark") {
    return { folders: 0, bookmarks: 1 };
  }

  const children = node.children ?? [];
  return children.reduce(
    (acc, child) => {
      const childCounts = walk(child);
      const foldersIncrement = child.type === "folder" ? 1 : 0;
      return {
        folders: acc.folders + childCounts.folders + foldersIncrement,
        bookmarks: acc.bookmarks + childCounts.bookmarks,
      };
    },
    { folders: 1, bookmarks: 0 },
  );
}

export function calculateBookmarkStatistics(root: BookmarkNode | null | undefined): BookmarkStatistics {
  if (!root || root.type !== "folder") {
    return {
      total_folders: 0,
      total_bookmarks: 0,
    };
  }

  const counts = walk(root);
  return {
    total_folders: Math.max(counts.folders - 1, 0),
    total_bookmarks: counts.bookmarks,
  };
}
