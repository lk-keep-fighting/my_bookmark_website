'use client';

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { BookmarkDocument, BookmarkNode } from '@/lib/bookmarks';

interface NavigationViewerProps {
  document: BookmarkDocument | null;
  emptyHint?: string;
  header?: React.ReactNode;
  editable?: boolean;
  onDocumentChange?: (nextDocument: BookmarkDocument) => void;
}

type FolderEntry = {
  id: string;
  name: string;
  depth: number;
  pathLabel: string;
  directBookmarkCount: number;
};

export function NavigationViewer({
  document,
  emptyHint,
  header,
  editable = false,
  onDocumentChange,
}: NavigationViewerProps) {
  const folderEntries = useMemo<FolderEntry[]>(() => {
    if (!document) return [];
    return collectFolders(document.root);
  }, [document]);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!document) {
      setSelectedFolderId(null);
      setQuery('');
      return;
    }
    if (folderEntries.length === 0) {
      setSelectedFolderId(null);
      return;
    }
    if (!selectedFolderId || !folderEntries.some((entry) => entry.id === selectedFolderId)) {
      setSelectedFolderId(folderEntries[0].id);
    }
  }, [document, folderEntries, selectedFolderId]);

  useEffect(() => {
    setQuery('');
    setDraggingId(null);
    setDragOverId(null);
  }, [selectedFolderId]);

  if (!document) {
    return (
      <div style={emptyContainerStyle}>
        <p style={emptyHintStyle}>{emptyHint ?? '暂未导入书签，上传 HTML 文件后即可预览导航站。'}</p>
      </div>
    );
  }

  const activeFolderId = selectedFolderId ?? folderEntries[0]?.id ?? document.root.id;
  const activeFolderNode = findFolderById(document.root, activeFolderId) ?? document.root;
  const activeFolderMeta = folderEntries.find((entry) => entry.id === activeFolderId) ?? {
    id: document.root.id,
    name: document.root.name,
    depth: 0,
    pathLabel: document.root.name,
    directBookmarkCount: activeFolderNode.children?.filter((child) => child.type === 'bookmark').length ?? 0,
  };

  const bookmarkChildren = useMemo(() => {
    return (activeFolderNode.children ?? []).filter((child) => child.type === 'bookmark');
  }, [activeFolderNode]);

  const filteredBookmarks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return bookmarkChildren;
    return bookmarkChildren.filter((bookmark) => {
      const name = bookmark.name.toLowerCase();
      const url = (bookmark.url ?? '').toLowerCase();
      return name.includes(trimmed) || url.includes(trimmed);
    });
  }, [bookmarkChildren, query]);

  const canReorder = editable && query.trim().length === 0 && bookmarkChildren.length > 1;

  const handleDrop = (targetBookmarkId: string | null) => (event: React.DragEvent<HTMLDivElement>) => {
    if (!canReorder) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData('text/plain');
    if (!sourceId) return;

    const allIds = bookmarkChildren.map((bookmark) => bookmark.id);
    const sourceIndex = allIds.indexOf(sourceId);
    if (sourceIndex === -1) return;

    let targetIndex = targetBookmarkId ? allIds.indexOf(targetBookmarkId) : bookmarkChildren.length;
    if (targetIndex === -1) {
      targetIndex = bookmarkChildren.length;
    }

    if (sourceIndex === targetIndex || sourceIndex + 1 === targetIndex) {
      // Dropping in the same position
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const nextDocument = reorderDocument(document, activeFolderId, sourceId, targetIndex);
    if (onDocumentChange && nextDocument !== document) {
      onDocumentChange(nextDocument);
    }

    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <div style={outerWrapperStyle}>
      <div style={layoutStyle}>
        <aside style={sidebarStyle}>
          <div style={sidebarHeaderStyle}>
            <span style={sidebarBadgeStyle}>书签目录</span>
            <h2 style={sidebarTitleStyle}>{document.root.name}</h2>
            <p style={sidebarSubtitleStyle}>
              共 {document.statistics.total_folders} 个目录 · {document.statistics.total_bookmarks} 个网页
            </p>
          </div>
          <div style={sidebarListStyle}>
            {folderEntries.map((entry) => {
              const isActive = entry.id === activeFolderId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedFolderId(entry.id)}
                  style={{
                    ...folderButtonStyle,
                    paddingLeft: `${16 + entry.depth * 18}px`,
                    border: isActive ? '1px solid rgba(59, 130, 246, 0.55)' : '1px solid transparent',
                    background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                    color: isActive ? '#1d4ed8' : '#1f2937',
                  }}
                >
                  <div style={folderButtonContentStyle}>
                    <div style={folderInfoStyle}>
                      <span style={folderNameStyle}>{entry.name}</span>
                      {entry.depth > 0 && entry.pathLabel && <span style={folderPathStyle}>{entry.pathLabel}</span>}
                    </div>
                    <span style={folderCountStyle}>{entry.directBookmarkCount}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section style={contentStyle}>
          {header && <div style={headerContainerStyle}>{header}</div>}
          <div style={contentHeaderStyle}>
            <div>
              <h3 style={contentTitleStyle}>{activeFolderMeta.name}</h3>
              <p style={contentSubtitleStyle}>
                {activeFolderMeta.pathLabel && (
                  <span style={contentPathStyle}>路径：{activeFolderMeta.pathLabel} · </span>
                )}
                目录包含 {bookmarkChildren.length} 个网页
                {bookmarkChildren.length === 0 && '，可在左侧选择其他目录查看'}
              </p>
            </div>
            <div style={searchContainerStyle}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索网页名称或链接"
                style={searchInputStyle}
              />
            </div>
          </div>

          {editable && query.trim().length > 0 && (
            <div style={searchWarningStyle}>当前处于搜索模式，拖拽排序前请清空搜索条件。</div>
          )}

          {editable && query.trim().length === 0 && bookmarkChildren.length > 1 && (
            <div style={dragHintStyle}>拖拽右侧网页可以调整顺序，调整后记得保存。</div>
          )}

          <div style={bookmarkListWrapperStyle}>
            {filteredBookmarks.length === 0 ? (
              <div style={emptyStateStyle}>
                {bookmarkChildren.length === 0
                  ? '该目录暂无网页，可选择其他目录或重新导入书签。'
                  : '未找到匹配的网页，尝试调整搜索关键词。'}
              </div>
            ) : (
              filteredBookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  draggable={canReorder}
                  onDragStart={(event) => {
                    if (!canReorder) return;
                    setDraggingId(bookmark.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', bookmark.id);
                  }}
                  onDragOver={(event) => {
                    if (!canReorder) return;
                    event.preventDefault();
                    setDragOverId(bookmark.id);
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={handleDrop(bookmark.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  style={{
                    ...bookmarkItemStyle,
                    opacity: draggingId === bookmark.id ? 0.6 : 1,
                    border:
                      dragOverId === bookmark.id
                        ? '1px dashed rgba(59, 130, 246, 0.8)'
                        : '1px solid rgba(148, 163, 184, 0.35)',
                    cursor: canReorder ? 'grab' : 'pointer',
                  }}
                >
                  <div style={bookmarkTopLineStyle}>
                    <span style={bookmarkNameStyle}>{bookmark.name}</span>
                    {bookmark.url && (
                      <span style={bookmarkHostStyle}>{extractHostname(bookmark.url)}</span>
                    )}
                  </div>
                  {bookmark.url && (
                    <a
                      href={bookmark.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={bookmarkUrlStyle}
                    >
                      {bookmark.url}
                    </a>
                  )}
                </div>
              ))
            )}
            {canReorder && draggingId && (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragOverId('__end__');
                }}
                onDrop={handleDrop(null)}
                onDragLeave={() => {
                  if (dragOverId === '__end__') {
                    setDragOverId(null);
                  }
                }}
                style={{
                  ...dropZoneStyle,
                  border:
                    dragOverId === '__end__'
                      ? '1px dashed rgba(59, 130, 246, 0.8)'
                      : '1px dashed rgba(148, 163, 184, 0.6)',
                }}
              >
                拖拽到此可将网页放置在列表末尾
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function collectFolders(root: BookmarkNode): FolderEntry[] {
  if (root.type !== 'folder') return [];
  const result: FolderEntry[] = [];

  const traverse = (node: BookmarkNode, depth: number, ancestry: string[]) => {
    if (node.type !== 'folder') return;
    const bookmarkCount = (node.children ?? []).filter((child) => child.type === 'bookmark').length;
    const ancestorPath = ancestry.slice(0, -1).join(' / ');
    result.push({
      id: node.id,
      name: node.name,
      depth,
      pathLabel: ancestorPath,
      directBookmarkCount: bookmarkCount,
    });
    (node.children ?? []).forEach((child) => {
      if (child.type === 'folder') {
        traverse(child, depth + 1, [...ancestry, child.name]);
      }
    });
  };

  traverse(root, 0, [root.name]);
  return result;
}

function findFolderById(node: BookmarkNode, id: string | null): BookmarkNode | null {
  if (!id) return null;
  if (node.type === 'folder' && node.id === id) {
    return node;
  }
  for (const child of node.children ?? []) {
    if (child.type === 'folder') {
      const found = findFolderById(child, id);
      if (found) return found;
    }
  }
  return null;
}

function reorderDocument(
  document: BookmarkDocument,
  folderId: string,
  sourceBookmarkId: string,
  targetIndex: number,
): BookmarkDocument {
  const updatedRoot = reorderWithinNode(document.root, folderId, sourceBookmarkId, targetIndex);
  if (updatedRoot === document.root) {
    return document;
  }
  return {
    ...document,
    root: updatedRoot,
  };
}

function reorderWithinNode(
  node: BookmarkNode,
  folderId: string,
  sourceBookmarkId: string,
  targetIndex: number,
): BookmarkNode {
  if (node.type !== 'folder') {
    return node;
  }
  if (node.id === folderId) {
    return reorderWithinFolder(node, sourceBookmarkId, targetIndex);
  }
  let changed = false;
  const nextChildren = (node.children ?? []).map((child) => {
    if (child.type !== 'folder') {
      return child;
    }
    const updatedChild = reorderWithinNode(child, folderId, sourceBookmarkId, targetIndex);
    if (updatedChild !== child) {
      changed = true;
      return updatedChild;
    }
    return child;
  });
  if (!changed) {
    return node;
  }
  return {
    ...node,
    children: nextChildren,
  };
}

function reorderWithinFolder(
  folder: BookmarkNode,
  sourceBookmarkId: string,
  targetIndex: number,
): BookmarkNode {
  const children = folder.children ?? [];
  const bookmarkChildren = children.filter((child) => child.type === 'bookmark');
  const sourceIndex = bookmarkChildren.findIndex((child) => child.id === sourceBookmarkId);
  if (sourceIndex === -1) {
    return folder;
  }
  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, bookmarkChildren.length));
  const nextBookmarks = [...bookmarkChildren];
  const [moving] = nextBookmarks.splice(sourceIndex, 1);
  let insertionIndex = clampedTargetIndex;
  if (sourceIndex < clampedTargetIndex) {
    insertionIndex -= 1;
  }
  nextBookmarks.splice(insertionIndex, 0, moving);

  let isIdentical = true;
  for (let index = 0; index < bookmarkChildren.length; index += 1) {
    if (bookmarkChildren[index]?.id !== nextBookmarks[index]?.id) {
      isIdentical = false;
      break;
    }
  }
  if (isIdentical) {
    return folder;
  }

  const bookmarkMap = new Map(nextBookmarks.map((bookmark) => [bookmark.id, bookmark] as const));
  const reorderedChildren = children.map((child) => {
    if (child.type === 'bookmark') {
      return bookmarkMap.get(child.id) ?? child;
    }
    return child;
  });

  return {
    ...folder,
    children: reorderedChildren,
  };
}

function extractHostname(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch (error) {
    return url;
  }
}

const outerWrapperStyle: React.CSSProperties = {
  flex: '1 1 auto',
  width: '100%',
  display: 'flex',
  minHeight: '520px',
};

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  gap: '24px',
  width: '100%',
  height: '100%',
  minHeight: '520px',
  flexWrap: 'wrap',
};

const sidebarStyle: React.CSSProperties = {
  width: '280px',
  minWidth: '240px',
  flex: '0 0 280px',
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  background: 'rgba(255, 255, 255, 0.95)',
  borderRadius: '24px',
  padding: '24px 20px',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.07)',
};

const sidebarHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const sidebarBadgeStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '4px 10px',
  borderRadius: '999px',
  background: 'rgba(59, 130, 246, 0.12)',
  color: '#1d4ed8',
  fontSize: '12px',
  fontWeight: 600,
};

const sidebarTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '20px',
  color: '#0f172a',
};

const sidebarSubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#64748b',
};

const sidebarListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  overflowY: 'auto',
  paddingRight: '6px',
  maxHeight: '100%',
  flex: '1 1 auto',
};

const folderButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  borderRadius: '16px',
  border: '1px solid transparent',
  background: 'transparent',
  padding: '12px 16px',
  cursor: 'pointer',
  transition: 'background 0.2s ease, border 0.2s ease',
};

const folderButtonContentStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  width: '100%',
};

const folderInfoStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  alignItems: 'flex-start',
};

const folderNameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '15px',
  color: 'inherit',
};

const folderPathStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
};

const folderCountStyle: React.CSSProperties = {
  minWidth: '32px',
  padding: '2px 0',
  borderRadius: '12px',
  textAlign: 'center',
  background: 'rgba(148, 163, 184, 0.14)',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
};

const contentStyle: React.CSSProperties = {
  flex: '1 1 480px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  minWidth: 0,
  background: 'rgba(255, 255, 255, 0.97)',
  borderRadius: '28px',
  padding: '28px 32px',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.07)',
};

const headerContainerStyle: React.CSSProperties = {
  marginBottom: '8px',
};

const contentHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: '16px',
  alignItems: 'center',
};

const contentTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '24px',
  color: '#0f172a',
};

const contentSubtitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: '14px',
  color: '#64748b',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
};

const contentPathStyle: React.CSSProperties = {
  color: '#94a3b8',
};

const searchContainerStyle: React.CSSProperties = {
  flex: '1 1 240px',
  display: 'flex',
  justifyContent: 'flex-end',
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '260px',
  padding: '11px 16px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'white',
  fontSize: '14px',
};

const searchWarningStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '14px',
  background: 'rgba(250, 204, 21, 0.18)',
  border: '1px solid rgba(234, 179, 8, 0.35)',
  color: '#ca8a04',
  fontSize: '13px',
};

const dragHintStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '14px',
  background: 'rgba(59, 130, 246, 0.12)',
  border: '1px solid rgba(59, 130, 246, 0.25)',
  color: '#1d4ed8',
  fontSize: '13px',
};

const bookmarkListWrapperStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: '320px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  overflowY: 'auto',
  paddingRight: '6px',
};

const bookmarkItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  borderRadius: '18px',
  padding: '16px 18px',
  background: 'linear-gradient(140deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.98))',
  transition: 'transform 0.2s ease, border 0.2s ease, box-shadow 0.2s ease',
};

const bookmarkTopLineStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
};

const bookmarkNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#0f172a',
  fontSize: '16px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const bookmarkHostStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#64748b',
};

const bookmarkUrlStyle: React.CSSProperties = {
  color: '#2563eb',
  fontSize: '13px',
  wordBreak: 'break-all',
};

const dropZoneStyle: React.CSSProperties = {
  marginTop: '6px',
  padding: '14px 16px',
  borderRadius: '16px',
  textAlign: 'center',
  fontSize: '13px',
  color: '#475569',
  background: 'rgba(241, 245, 249, 0.6)',
};

const emptyStateStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '24px',
  textAlign: 'center',
  borderRadius: '18px',
  border: '1px dashed rgba(148, 163, 184, 0.4)',
  color: '#64748b',
  background: 'rgba(248, 250, 252, 0.7)',
};

const emptyContainerStyle: React.CSSProperties = {
  width: '100%',
  padding: '40px 0',
};

const emptyHintStyle: React.CSSProperties = {
  margin: 0,
  textAlign: 'center',
  color: '#6b7280',
};
