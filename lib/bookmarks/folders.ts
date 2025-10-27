import type { BookmarkDocument, BookmarkNode } from "./types";

export type FolderTrailItem = {
  id: string;
  name: string;
};

export type FolderOption = {
  id: string;
  name: string;
  depth: number;
  trail: FolderTrailItem[];
  directBookmarkCount: number;
};

export type FolderLookupResult = {
  node: BookmarkNode & { type: "folder" };
  trail: FolderTrailItem[];
};

export function collectFolderOptions(document: BookmarkDocument | null): FolderOption[] {
  if (!document || document.root.type !== "folder") {
    return [];
  }

  const options: FolderOption[] = [];

  const traverse = (node: BookmarkNode, trail: FolderTrailItem[]) => {
    if (node.type !== "folder") {
      return;
    }

    const normalizedName = normalizeFolderName(node.name);
    const currentItem: FolderTrailItem = {
      id: node.id,
      name: normalizedName,
    };
    const nextTrail = [...trail, currentItem];
    const children = node.children ?? [];
    const directBookmarkCount = children.reduce((count, child) => (child.type === "bookmark" ? count + 1 : count), 0);

    options.push({
      id: node.id,
      name: normalizedName,
      depth: nextTrail.length - 1,
      trail: nextTrail,
      directBookmarkCount,
    });

    for (const child of children) {
      if (child.type === "folder") {
        traverse(child, nextTrail);
      }
    }
  };

  traverse(document.root, []);

  return options;
}

export function findFolderWithTrail(root: BookmarkNode, targetId: string | null | undefined): FolderLookupResult | null {
  if (!targetId || root.type !== "folder") {
    return null;
  }

  const search = (node: BookmarkNode, trail: FolderTrailItem[]): FolderLookupResult | null => {
    if (node.type !== "folder") {
      return null;
    }

    const normalizedName = normalizeFolderName(node.name);
    const nextTrail = [...trail, { id: node.id, name: normalizedName }];

    if (node.id === targetId) {
      return {
        node,
        trail: nextTrail,
      };
    }

    for (const child of node.children ?? []) {
      if (child.type !== "folder") {
        continue;
      }
      const found = search(child, nextTrail);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return search(root, []);
}

export function findFolderNode(root: BookmarkNode, targetId: string | null | undefined): (BookmarkNode & { type: "folder" }) | null {
  const result = findFolderWithTrail(root, targetId);
  return result ? result.node : null;
}

export function cloneBookmarkNode(node: BookmarkNode): BookmarkNode {
  if (node.type !== "folder") {
    return { ...node };
  }

  const children = node.children ?? [];
  return {
    ...node,
    children: children.map((child) => cloneBookmarkNode(child)),
  };
}

export function formatFolderTrail(trail: FolderTrailItem[]): string {
  return trail.map((item) => item.name).join(" / ");
}

function normalizeFolderName(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "未命名目录";
}
