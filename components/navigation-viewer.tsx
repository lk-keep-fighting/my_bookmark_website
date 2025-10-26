'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { BookmarkDocument, BookmarkNode } from '@/lib/bookmarks';
import { bookmarkDocumentToHtml, calculateBookmarkStatistics } from '@/lib/bookmarks';

interface NavigationViewerProps {
  document: BookmarkDocument | null;
  emptyHint?: string;
  header?: React.ReactNode;
  editable?: boolean;
  onDocumentChange?: (nextDocument: BookmarkDocument) => void;
}

type FolderTrailItem = {
  id: string;
  name: string;
};

type FolderEntry = {
  id: string;
  name: string;
  depth: number;
  directBookmarkCount: number;
  trail: FolderTrailItem[];
};

type FolderTreeNode = {
  entry: FolderEntry;
  children: FolderTreeNode[];
};

interface NavigationIndex {
  folderEntries: FolderEntry[];
  bookmarkMatches: BookmarkMatch[];
  folderTrailMap: Map<string, FolderTrailItem[]>;
  folderTree: FolderTreeNode | null;
}

type BookmarkMatch = {
  node: BookmarkNode & { type: 'bookmark' };
  parentFolderId: string;
  trail: FolderTrailItem[];
  lowerCaseName: string;
  lowerCaseUrl: string;
};

type BookmarkCardData = {
  node: BookmarkNode & { type: 'bookmark' };
  parentFolderId: string;
};

type AiStrategyId = 'domain-groups' | 'semantic-clusters' | 'alphabetical';

const AI_STRATEGIES: Array<{ id: AiStrategyId; title: string; description: string }> = [
  {
    id: 'domain-groups',
    title: '域名智能分组',
    description: '按网站域名自动归类，并补全更易读的名称',
  },
  {
    id: 'semantic-clusters',
    title: '语义主题整理',
    description: '依据常见用途划分到社交、效率、开发等类别',
  },
  {
    id: 'alphabetical',
    title: '字母顺序索引',
    description: '以名称首字母生成快速导航目录',
  },
];

const EMPTY_INDEX: NavigationIndex = {
  folderEntries: [],
  bookmarkMatches: [],
  folderTrailMap: new Map(),
  folderTree: null,
};

interface SearchResult {
  matches: BookmarkMatch[];
  matchesByFolder: Map<string, BookmarkMatch[]>;
}

export function NavigationViewer({
  document: bookmarkDocument,
  emptyHint,
  header,
  editable = false,
  onDocumentChange,
}: NavigationViewerProps) {
  const navigationIndex = useMemo<NavigationIndex>(() => {
    if (!bookmarkDocument) {
      return EMPTY_INDEX;
    }
    return createNavigationIndex(bookmarkDocument.root);
  }, [bookmarkDocument]);

  const { folderEntries, bookmarkMatches, folderTrailMap, folderTree } = navigationIndex;

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isApplyingAi, setIsApplyingAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const previousRootIdRef = useRef<string | null>(null);

  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const searchActive = normalizedQuery.length > 0;

  const searchResult = useMemo<SearchResult | null>(() => {
    if (!searchActive) {
      return null;
    }
    const matches: BookmarkMatch[] = [];
    const matchesByFolder = new Map<string, BookmarkMatch[]>();

    for (const match of bookmarkMatches) {
      if (match.lowerCaseName.includes(normalizedQuery) || match.lowerCaseUrl.includes(normalizedQuery)) {
        matches.push(match);
        for (const folder of match.trail) {
          let bucket = matchesByFolder.get(folder.id);
          if (!bucket) {
            bucket = [];
            matchesByFolder.set(folder.id, bucket);
          }
          bucket.push(match);
        }
      }
    }

    return { matches, matchesByFolder };
  }, [bookmarkMatches, normalizedQuery, searchActive]);

  const visibleFolderEntries = useMemo(() => {
    if (!searchActive) {
      return folderEntries;
    }
    return folderEntries.filter((entry) => (searchResult?.matchesByFolder.get(entry.id)?.length ?? 0) > 0);
  }, [folderEntries, searchActive, searchResult]);

  const matchedFolderIdSet = useMemo(() => {
    if (!searchActive) {
      return null;
    }
    return new Set(visibleFolderEntries.map((entry) => entry.id));
  }, [searchActive, visibleFolderEntries]);

  const searchVisibleFolderIdSet = useMemo(() => {
    if (!searchActive) {
      return null;
    }
    const ids = new Set<string>();
    for (const entry of visibleFolderEntries) {
      for (const item of entry.trail) {
        ids.add(item.id);
      }
    }
    return ids;
  }, [searchActive, visibleFolderEntries]);

  const rootFolderId = folderEntries.length > 0 ? folderEntries[0].id : null;

  useEffect(() => {
    if (!bookmarkDocument) {
      setSelectedFolderId(null);
      return;
    }
    const availableEntries = searchActive ? visibleFolderEntries : folderEntries;
    if (availableEntries.length === 0) {
      setSelectedFolderId(null);
      return;
    }
    if (!selectedFolderId || !availableEntries.some((entry) => entry.id === selectedFolderId)) {
      setSelectedFolderId(availableEntries[0].id);
    }
  }, [bookmarkDocument, folderEntries, visibleFolderEntries, searchActive, selectedFolderId]);

  useEffect(() => {
    if (!rootFolderId) {
      setCollapsedFolderIds(new Set());
      previousRootIdRef.current = null;
      return;
    }
    if (previousRootIdRef.current !== rootFolderId) {
      const defaultCollapsed = new Set<string>();
      for (const entry of folderEntries) {
        if (entry.depth >= 2) {
          defaultCollapsed.add(entry.id);
        }
      }
      defaultCollapsed.delete(rootFolderId);
      setCollapsedFolderIds(defaultCollapsed);
      previousRootIdRef.current = rootFolderId;
    }
  }, [rootFolderId, folderEntries]);

  useEffect(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, [selectedFolderId, searchActive]);

  useEffect(() => {
    if (!selectedFolderId) {
      return;
    }
    const trail = folderTrailMap.get(selectedFolderId);
    if (!trail || trail.length === 0) {
      return;
    }
    setCollapsedFolderIds((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const item of trail) {
        if (next.delete(item.id)) {
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [selectedFolderId, folderTrailMap]);

  useEffect(() => {
    if (!aiMessage || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => setAiMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [aiMessage]);

  useEffect(() => {
    if (!aiError || typeof window === 'undefined') return;
    const timer = window.setTimeout(() => setAiError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [aiError]);

  const activeFolderId = useMemo(() => {
    if (!bookmarkDocument) {
      return null;
    }
    if (searchActive) {
      if (visibleFolderEntries.length === 0) {
        return null;
      }
      return selectedFolderId ?? visibleFolderEntries[0]?.id ?? null;
    }
    if (folderEntries.length === 0) {
      return null;
    }
    return selectedFolderId ?? folderEntries[0]?.id ?? null;
  }, [bookmarkDocument, searchActive, visibleFolderEntries, selectedFolderId, folderEntries]);

  const activeFolderEntry = useMemo(() => {
    if (!activeFolderId) return null;
    return folderEntries.find((entry) => entry.id === activeFolderId) ?? null;
  }, [activeFolderId, folderEntries]);

  const activeFolderNode = useMemo(() => {
    if (!bookmarkDocument || !activeFolderId) {
      return null;
    }
    return findFolderById(bookmarkDocument.root, activeFolderId);
  }, [bookmarkDocument, activeFolderId]);

  const bookmarkChildren = useMemo(() => {
    if (!activeFolderNode) return [] as (BookmarkNode & { type: 'bookmark' })[];
    return (activeFolderNode.children ?? []).filter(
      (child): child is BookmarkNode & { type: 'bookmark' } => child.type === 'bookmark',
    );
  }, [activeFolderNode]);

  const bookmarkCards = useMemo<BookmarkCardData[]>(() => {
    if (!bookmarkDocument || !activeFolderId) {
      return [];
    }
    if (searchActive) {
      const matches = searchResult?.matchesByFolder.get(activeFolderId);
      if (!matches || matches.length === 0) {
        return [];
      }
      return matches.map((match) => ({
        node: match.node,
        parentFolderId: match.parentFolderId,
      }));
    }
    return bookmarkChildren.map((bookmark) => ({
      node: bookmark,
      parentFolderId: activeFolderId,
    }));
  }, [bookmarkDocument, activeFolderId, searchActive, searchResult, bookmarkChildren]);

  const activeFolderBookmarkCount = searchActive
    ? activeFolderId
      ? searchResult?.matchesByFolder.get(activeFolderId)?.length ?? 0
      : 0
    : bookmarkChildren.length;

  const totalSearchMatches = searchActive ? searchResult?.matches.length ?? 0 : 0;

  const canReorder = editable && !searchActive && bookmarkChildren.length > 1;

  const handleToggleFolder = useCallback((folderId: string) => {
    setCollapsedFolderIds((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleDrop = useCallback(
    (targetBookmarkId: string | null) => (event: React.DragEvent<HTMLDivElement>) => {
      if (!canReorder || !bookmarkDocument || !activeFolderId) return;
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

      if (sourceIndex === targetIndex) {
        setDraggingId(null);
        setDragOverId(null);
        return;
      }

      const nextDocument = reorderDocument(bookmarkDocument, activeFolderId, sourceId, targetIndex);
      if (onDocumentChange && nextDocument !== bookmarkDocument) {
        onDocumentChange(nextDocument);
      }

      setDraggingId(null);
      setDragOverId(null);
    },
    [canReorder, bookmarkDocument, activeFolderId, bookmarkChildren, onDocumentChange],
  );

  const handleStartEditing = useCallback((bookmarkId: string, currentName: string) => {
    setEditingBookmarkId(bookmarkId);
    setEditingValue(currentName);
  }, []);

  const handleCancelEditing = useCallback(() => {
    setEditingBookmarkId(null);
    setEditingValue('');
  }, []);

  const handleCommitEditing = useCallback(
    (bookmarkId: string, nextValue: string) => {
      if (!editable || !bookmarkDocument || !onDocumentChange) {
        setEditingBookmarkId(null);
        setEditingValue('');
        return;
      }
      const trimmed = nextValue.trim();
      const originalName = bookmarkMatches.find((match) => match.node.id === bookmarkId)?.node.name ?? '';
      if (!trimmed) {
        setEditingBookmarkId(null);
        setEditingValue('');
        return;
      }
      if (trimmed === originalName) {
        setEditingBookmarkId(null);
        setEditingValue('');
        return;
      }
      const nextDocument = renameBookmarkInDocument(bookmarkDocument, bookmarkId, trimmed);
      if (nextDocument !== bookmarkDocument) {
        onDocumentChange(nextDocument);
      }
      setEditingBookmarkId(null);
      setEditingValue('');
    },
    [editable, bookmarkDocument, onDocumentChange, bookmarkMatches],
  );

  const handleExportBookmarks = useCallback(() => {
    if (typeof window === 'undefined' || !bookmarkDocument) return;
    try {
      const html = bookmarkDocumentToHtml(bookmarkDocument);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      const baseName = (bookmarkDocument.root.name || 'bookmarks').trim() || 'bookmarks';
      const timestamp = new Date();
      const formattedDate = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(
        timestamp.getDate(),
      ).padStart(2, '0')}`;
      anchor.href = url;
      anchor.download = `${baseName}-${formattedDate}.html`;
      anchor.rel = 'noopener';
      window.document.body.appendChild(anchor);
      anchor.click();
      window.document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出书签失败', error);
    }
  }, [bookmarkDocument]);

  const handleApplyAiStrategy = useCallback(
    (strategyId: AiStrategyId) => {
      if (!editable || !bookmarkDocument || !onDocumentChange) return;
      if (bookmarkMatches.length === 0) {
        setAiError('当前书签为空，无法执行自动整理');
        return;
      }
      setIsApplyingAi(true);
      setAiError(null);
      setAiMessage(null);
      try {
        const newFolder = createAiOrganizedFolder(strategyId, bookmarkMatches);
        if (!newFolder) {
          throw new Error('未能生成新的书签分类，请稍后再试');
        }
        const nextRootChildren = [...(bookmarkDocument.root.children ?? []), newFolder];
        const nextRoot: BookmarkNode = {
          ...bookmarkDocument.root,
          children: nextRootChildren,
        };
        const nextDocument: BookmarkDocument = {
          ...bookmarkDocument,
          root: nextRoot,
          statistics: calculateBookmarkStatistics(nextRoot),
        };
        onDocumentChange(nextDocument);
        setAiMessage(`已生成「${newFolder.name}」分类，原有书签保持不变。`);
        setSelectedFolderId(newFolder.id);
        if (searchActive) {
          setQuery('');
        }
        setIsAiPanelOpen(false);
      } catch (error) {
        setAiError(error instanceof Error ? error.message : '自动整理失败，请稍后再试');
      } finally {
        setIsApplyingAi(false);
      }
    },
    [editable, bookmarkDocument, onDocumentChange, bookmarkMatches, searchActive],
  );

  if (!bookmarkDocument) {
    return (
      <div style={emptyContainerStyle}>
        <p style={emptyHintStyle}>{emptyHint ?? '暂未导入书签，上传 HTML 文件后即可预览导航站。'}</p>
      </div>
    );
  }

  const activeFolderName =
    activeFolderEntry?.name ?? (searchActive ? '搜索结果' : bookmarkDocument.root.name);

  const emptyMessage = searchActive
    ? trimmedQuery
      ? `未找到与“${trimmedQuery}”匹配的网页`
      : '未找到匹配的网页'
    : bookmarkChildren.length === 0
      ? '该目录暂无网页，可选择其他目录或重新导入书签。'
      : '暂无可展示的网页。';

  const renderFolderNode = (node: FolderTreeNode): React.ReactNode => {
    const { entry, children } = node;
    if (searchActive && searchVisibleFolderIdSet && !searchVisibleFolderIdSet.has(entry.id)) {
      return null;
    }
    const hasChildren = children.length > 0;
    const isCollapsed = searchActive ? false : collapsedFolderIds.has(entry.id);
    const isActive = entry.id === activeFolderId;
    const displayCount = searchActive
      ? searchResult?.matchesByFolder.get(entry.id)?.length ?? 0
      : entry.directBookmarkCount;
    const isSearchMatch = matchedFolderIdSet ? matchedFolderIdSet.has(entry.id) : false;

    return (
      <div key={entry.id} style={folderTreeNodeStyle}>
        <div style={{ ...folderRowWrapperStyle, paddingLeft: `${entry.depth * 16}px` }}>
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={(event) => {
                event.stopPropagation();
                if (searchActive) {
                  return;
                }
                handleToggleFolder(entry.id);
              }}
              style={{
                ...folderToggleStyle,
                opacity: searchActive ? 0.4 : 1,
                cursor: searchActive ? 'default' : 'pointer',
                background: isCollapsed ? 'rgba(241, 245, 249, 0.9)' : 'rgba(255, 255, 255, 0.95)',
                borderColor: isCollapsed ? 'rgba(148, 163, 184, 0.4)' : 'rgba(59, 130, 246, 0.35)',
              }}
              aria-label={isCollapsed ? '展开目录' : '收起目录'}
              disabled={searchActive}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span style={folderTogglePlaceholderStyle} />
          )}
          <button
            type="button"
            aria-current={isActive ? 'true' : undefined}
            onClick={() => setSelectedFolderId(entry.id)}
            style={{
              ...folderButtonStyle,
              border: isActive ? '1px solid rgba(59, 130, 246, 0.55)' : '1px solid transparent',
              background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
              color: isActive ? '#1d4ed8' : '#1f2937',
              boxShadow: !isActive && isSearchMatch ? 'inset 0 0 0 1px rgba(59, 130, 246, 0.25)' : undefined,
            }}
          >
            <div style={folderButtonContentStyle}>
              <span style={folderNameStyle}>{entry.name}</span>
              <span style={folderCountStyle}>{displayCount}</span>
            </div>
          </button>
        </div>
        {hasChildren && !isCollapsed && (
          <div style={folderChildrenStyle}>{children.map((child) => renderFolderNode(child))}</div>
        )}
      </div>
    );
  };

  return (
    <div style={outerWrapperStyle}>
      <div style={layoutStyle}>
        <aside style={sidebarStyle}>
          <div style={sidebarHeaderStyle}>
            <span style={sidebarBadgeStyle}>书签目录</span>
            <h2 style={sidebarTitleStyle}>{bookmarkDocument.root.name}</h2>
            <p style={sidebarSubtitleStyle}>
              共 {bookmarkDocument.statistics.total_folders} 个目录 · {bookmarkDocument.statistics.total_bookmarks} 个网页
            </p>
            {searchActive && (
              <span style={sidebarSearchInfoStyle}>搜索结果覆盖 {visibleFolderEntries.length} 个目录</span>
            )}
          </div>
          <div style={sidebarListStyle}>
            {searchActive && visibleFolderEntries.length === 0 ? (
              <div style={sidebarEmptyStyle}>未找到包含当前搜索结果的目录</div>
            ) : folderTree ? (
              renderFolderNode(folderTree)
            ) : (
              <div style={sidebarEmptyStyle}>暂无目录</div>
            )}
          </div>
        </aside>

        <section style={contentStyle}>
          {header && <div style={headerContainerStyle}>{header}</div>}

          <div style={actionBarStyle}>
            <div style={searchAreaStyle}>
              <div style={searchRowStyle}>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索网页名称或链接"
                  style={searchInputFullStyle}
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} style={searchClearButtonStyle}>
                    清除
                  </button>
                )}
              </div>
              {searchActive && <span style={searchStatsStyle}>找到 {totalSearchMatches} 个网页</span>}
            </div>
            <div style={actionButtonsStyle}>
              {editable && (
                <button
                  type="button"
                  onClick={() => setIsAiPanelOpen((previous) => !previous)}
                  style={{
                    ...secondaryActionButtonStyle,
                    background: isAiPanelOpen ? 'rgba(59, 130, 246, 0.16)' : 'white',
                    color: '#2563eb',
                    borderColor: 'rgba(37, 99, 235, 0.35)',
                  }}
                >
                  {isAiPanelOpen ? '关闭 AI 整理' : 'AI 自动整理'}
                </button>
              )}
              <button type="button" onClick={handleExportBookmarks} style={secondaryActionButtonStyle}>
                导出书签
              </button>
            </div>
          </div>

          {isAiPanelOpen && editable && (
            <div style={aiPanelStyle}>
              <div style={aiPanelHeaderStyle}>
                <div>
                  <h4 style={aiPanelTitleStyle}>选择自动整理策略</h4>
                  <p style={aiPanelSubtitleStyle}>生成的新目录将保留原始书签，支持随时撤销或删除。</p>
                </div>
                {isApplyingAi && <span style={aiWorkingStyle}>智能整理中…</span>}
              </div>
              <div style={aiStrategyListStyle}>
                {AI_STRATEGIES.map((strategy) => (
                  <button
                    key={strategy.id}
                    type="button"
                    onClick={() => handleApplyAiStrategy(strategy.id)}
                    disabled={isApplyingAi}
                    style={{
                      ...aiStrategyButtonStyle,
                      opacity: isApplyingAi ? 0.55 : 1,
                      cursor: isApplyingAi ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <div style={aiStrategyTitleStyle}>{strategy.title}</div>
                    <div style={aiStrategyDescriptionStyle}>{strategy.description}</div>
                  </button>
                ))}
              </div>
              {(aiMessage || aiError) && (
                <div style={aiStatusInlineStyle}>
                  {aiMessage && <span style={aiSuccessStyle}>{aiMessage}</span>}
                  {aiError && <span style={aiErrorStyle}>{aiError}</span>}
                </div>
              )}
            </div>
          )}

          {!isAiPanelOpen && (aiMessage || aiError) && (
            <div style={aiStatusBannerStyle}>
              {aiMessage && <span style={aiSuccessStyle}>{aiMessage}</span>}
              {aiError && <span style={aiErrorStyle}>{aiError}</span>}
            </div>
          )}

          <div style={contentHeaderStyle}>
            <div>
              <h3 style={contentTitleStyle}>{activeFolderName}</h3>
              <p style={contentSubtitleStyle}>
                {searchActive
                  ? `匹配到 ${activeFolderBookmarkCount} 个网页`
                  : `包含 ${activeFolderBookmarkCount} 个网页${
                      activeFolderBookmarkCount === 0 ? '，可在左侧选择其他目录查看' : ''
                    }`}
              </p>
            </div>
          </div>

          {editable && searchActive && (
            <div style={searchWarningStyle}>当前处于搜索模式，拖拽排序前请清空搜索条件。</div>
          )}

          {editable && !searchActive && bookmarkChildren.length > 1 && (
            <div style={dragHintStyle}>拖拽右侧网页可以调整顺序，调整后记得保存。</div>
          )}

          <div style={bookmarkListWrapperStyle}>
            {bookmarkCards.length === 0 ? (
              <div style={emptyStateStyle}>{emptyMessage}</div>
            ) : (
              <div style={bookmarkGridStyle}>
                {bookmarkCards.map((card) => {
                  const { node } = card;
                  const isEditing = editingBookmarkId === node.id;
                  const host = node.url ? extractHostname(node.url) : '';
                  return (
                    <div
                      key={node.id}
                      draggable={canReorder && !isEditing}
                      onDragStart={(event) => {
                        if (!canReorder || isEditing) return;
                        setDraggingId(node.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', node.id);
                      }}
                      onDragOver={(event) => {
                        if (!canReorder) return;
                        event.preventDefault();
                        setDragOverId(node.id);
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDragLeave={() => setDragOverId((current) => (current === node.id ? null : current))}
                      onDrop={handleDrop(node.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverId(null);
                      }}
                      style={{
                        ...bookmarkItemStyle,
                        opacity: draggingId === node.id ? 0.6 : 1,
                        border:
                          dragOverId === node.id
                            ? '1px dashed rgba(59, 130, 246, 0.8)'
                            : '1px solid rgba(148, 163, 184, 0.35)',
                        cursor: canReorder ? 'grab' : 'default',
                      }}
                    >
                      {isEditing ? (
                        <div style={editingContainerStyle}>
                          <input
                            value={editingValue}
                            onChange={(event) => setEditingValue(event.target.value)}
                            onBlur={() => handleCommitEditing(node.id, editingValue)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                handleCommitEditing(node.id, editingValue);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                handleCancelEditing();
                              }
                            }}
                            autoFocus
                            style={editingInputStyle}
                          />
                          <div style={editActionsStyle}>
                            <button
                              type="button"
                              style={editSaveButtonStyle}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => handleCommitEditing(node.id, editingValue)}
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              style={editCancelButtonStyle}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={handleCancelEditing}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={bookmarkTitleRowStyle}>
                          <span style={bookmarkNameStyle}>{node.name?.trim() || '未命名网页'}</span>
                          {editable && (
                            <button
                              type="button"
                              style={editButtonStyle}
                              onClick={() => handleStartEditing(node.id, node.name ?? '')}
                            >
                              编辑名称
                            </button>
                          )}
                        </div>
                      )}
                      {host && (
                        <div style={bookmarkMetaRowStyle}>
                          <span style={bookmarkHostStyle}>{host}</span>
                        </div>
                      )}
                      {node.url && (
                        <a href={node.url} target="_blank" rel="noopener noreferrer" style={bookmarkUrlStyle}>
                          {node.url}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
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

function createNavigationIndex(root: BookmarkNode): NavigationIndex {
  if (root.type !== 'folder') {
    return {
      folderEntries: [],
      bookmarkMatches: [],
      folderTrailMap: new Map(),
      folderTree: null,
    };
  }

  const folderEntries: FolderEntry[] = [];
  const bookmarkMatches: BookmarkMatch[] = [];
  const folderTrailMap = new Map<string, FolderTrailItem[]>();

  const buildTree = (node: BookmarkNode, ancestry: BookmarkNode[]): FolderTreeNode | null => {
    if (node.type !== 'folder') return null;

    const currentTrailNodes = [...ancestry, node];
    const currentTrail: FolderTrailItem[] = currentTrailNodes.map((folderNode) => ({
      id: folderNode.id,
      name: folderNode.name,
    }));
    const children = node.children ?? [];
    const directBookmarks = children.filter(
      (child): child is BookmarkNode & { type: 'bookmark' } => child.type === 'bookmark',
    );

    const entry: FolderEntry = {
      id: node.id,
      name: node.name,
      depth: currentTrailNodes.length - 1,
      directBookmarkCount: directBookmarks.length,
      trail: currentTrail,
    };

    folderEntries.push(entry);
    folderTrailMap.set(node.id, currentTrail);

    const childFolders: FolderTreeNode[] = [];

    for (const child of children) {
      if (child.type === 'bookmark') {
        bookmarkMatches.push({
          node: child as BookmarkNode & { type: 'bookmark' },
          parentFolderId: node.id,
          trail: currentTrail,
          lowerCaseName: (child.name ?? '').toLowerCase(),
          lowerCaseUrl: (child.url ?? '').toLowerCase(),
        });
      } else {
        const childTree = buildTree(child, currentTrailNodes);
        if (childTree) {
          childFolders.push(childTree);
        }
      }
    }

    return {
      entry,
      children: childFolders,
    };
  };

  const folderTree = buildTree(root, []);

  return {
    folderEntries,
    bookmarkMatches,
    folderTrailMap,
    folderTree: folderTree ?? null,
  };
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

function reorderWithinFolder(folder: BookmarkNode, sourceBookmarkId: string, targetIndex: number): BookmarkNode {
  const children = folder.children ?? [];
  const bookmarkChildren = children.filter(
    (child): child is BookmarkNode & { type: 'bookmark' } => child.type === 'bookmark',
  );
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

function renameBookmarkInDocument(document: BookmarkDocument, bookmarkId: string, nextName: string): BookmarkDocument {
  const updatedRoot = renameBookmarkInNode(document.root, bookmarkId, nextName);
  if (updatedRoot === document.root) {
    return document;
  }
  return {
    ...document,
    root: updatedRoot,
  };
}

function renameBookmarkInNode(node: BookmarkNode, bookmarkId: string, nextName: string): BookmarkNode {
  if (node.type !== 'folder') {
    return node;
  }
  let changed = false;
  const nextChildren = (node.children ?? []).map((child) => {
    if (child.type === 'bookmark') {
      if (child.id === bookmarkId) {
        if (child.name === nextName) {
          return child;
        }
        changed = true;
        return {
          ...child,
          name: nextName,
        };
      }
      return child;
    }
    const updatedChild = renameBookmarkInNode(child, bookmarkId, nextName);
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

function createAiOrganizedFolder(strategyId: AiStrategyId, matches: BookmarkMatch[]): BookmarkNode | null {
  if (matches.length === 0) {
    return null;
  }
  switch (strategyId) {
    case 'domain-groups':
      return createDomainGroupingFolder(matches);
    case 'semantic-clusters':
      return createSemanticGroupingFolder(matches);
    case 'alphabetical':
      return createAlphabeticalFolder(matches);
    default:
      return null;
  }
}

function createDomainGroupingFolder(matches: BookmarkMatch[]): BookmarkNode | null {
  const groups = new Map<string, BookmarkNode[]>();

  for (const match of matches) {
    const url = match.node.url ?? '';
    const host = extractHostname(url);
    const groupName = host || '未识别站点';
    const displayName = host
      ? `${formatDomainDisplay(host)} · ${cleanBookmarkTitle(match.node.name)}`
      : cleanBookmarkTitle(match.node.name);
    const clone = cloneBookmark(match.node, displayName);
    const bucket = groups.get(groupName);
    if (bucket) {
      bucket.push(clone);
    } else {
      groups.set(groupName, [clone]);
    }
  }

  const children = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
    .map(([name, bookmarks]) => ({
      type: 'folder' as const,
      id: generateNodeId(),
      name,
      children: bookmarks.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    }));

  if (children.length === 0) {
    return null;
  }

  return {
    type: 'folder',
    id: generateNodeId(),
    name: `AI 整理 · 域名分组（${formatFolderTimestamp(new Date())}）`,
    children,
  };
}

const SEMANTIC_KEYWORDS: Array<{ name: string; keywords: string[] }> = [
  { name: '社交 & 社区', keywords: ['social', 'twitter', 'weibo', 'wechat', 'discord', 'reddit', 'facebook', 'instagram', 'douban'] },
  { name: '效率 & 办公', keywords: ['notion', 'slack', 'trello', 'asana', 'todo', 'calendar', 'office', 'productivity', 'mail'] },
  { name: '开发 & 技术', keywords: ['github', 'gitlab', 'stack', 'dev', 'docs', 'api', 'npm', 'vercel', 'cloud', 'developer'] },
  { name: '资讯 & 阅读', keywords: ['news', 'medium', 'zhihu', 'infoq', '36kr', 'nytimes', 'guardian', 'newsletter', 'blog'] },
  { name: '影音 & 娱乐', keywords: ['video', 'music', 'youtube', 'bilibili', 'spotify', 'movie', 'podcast', 'entertainment'] },
];

function createSemanticGroupingFolder(matches: BookmarkMatch[]): BookmarkNode | null {
  const buckets = new Map<string, BookmarkNode[]>();
  for (const category of SEMANTIC_KEYWORDS) {
    buckets.set(category.name, []);
  }
  buckets.set('其他收藏', []);

  for (const match of matches) {
    const text = `${match.lowerCaseName} ${match.lowerCaseUrl}`;
    const category =
      SEMANTIC_KEYWORDS.find((item) => item.keywords.some((keyword) => text.includes(keyword))) ?? null;
    const categoryName = category?.name ?? '其他收藏';
    const renamed = `${categoryName} ｜ ${cleanBookmarkTitle(match.node.name)}`;
    const clone = cloneBookmark(match.node, renamed);
    buckets.get(categoryName)?.push(clone);
  }

  const children = SEMANTIC_KEYWORDS.map((category) => {
    const items = buckets.get(category.name) ?? [];
    if (items.length === 0) return null;
    return {
      type: 'folder' as const,
      id: generateNodeId(),
      name: category.name,
      children: items.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) as BookmarkNode[],
    };
  }).filter((item): item is BookmarkNode & { type: 'folder'; children: BookmarkNode[] } => Boolean(item));

  const remaining = buckets.get('其他收藏') ?? [];
  if (remaining.length > 0) {
    children.push({
      type: 'folder',
      id: generateNodeId(),
      name: '其他收藏',
      children: remaining.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    });
  }

  if (children.length === 0) {
    return null;
  }

  return {
    type: 'folder',
    id: generateNodeId(),
    name: `AI 整理 · 语义主题（${formatFolderTimestamp(new Date())}）`,
    children,
  };
}

const ALPHABETICAL_ORDER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '0-9', '其他'];

function createAlphabeticalFolder(matches: BookmarkMatch[]): BookmarkNode | null {
  const groups = new Map<string, BookmarkNode[]>();

  for (const match of matches) {
    const title = cleanBookmarkTitle(match.node.name);
    const initial = title.charAt(0).toUpperCase();
    let bucketKey: string;
    if (/[A-Z]/.test(initial)) {
      bucketKey = initial;
    } else if (/[0-9]/.test(initial)) {
      bucketKey = '0-9';
    } else {
      bucketKey = '其他';
    }
    const renamed = `${bucketKey} · ${title}`;
    const clone = cloneBookmark(match.node, renamed);
    const bucket = groups.get(bucketKey);
    if (bucket) {
      bucket.push(clone);
    } else {
      groups.set(bucketKey, [clone]);
    }
  }

  const children = ALPHABETICAL_ORDER.filter((key) => groups.has(key)).map((key) => ({
    type: 'folder' as const,
    id: generateNodeId(),
    name: key,
    children: (groups.get(key) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  }));

  if (children.length === 0) {
    return null;
  }

  return {
    type: 'folder',
    id: generateNodeId(),
    name: `AI 整理 · 字母索引（${formatFolderTimestamp(new Date())}）`,
    children,
  };
}

function cloneBookmark(source: BookmarkNode & { type: 'bookmark' }, nextName: string): BookmarkNode {
  return {
    ...source,
    id: generateNodeId(),
    name: nextName,
  };
}

function cleanBookmarkTitle(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    return '未命名网页';
  }
  return trimmed.replace(/\s+/g, ' ');
}

function formatDomainDisplay(host: string): string {
  if (!host) return '未识别站点';
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function formatFolderTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateNodeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

function extractHostname(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
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

const sidebarSearchInfoStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#2563eb',
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

const sidebarEmptyStyle: React.CSSProperties = {
  padding: '18px',
  borderRadius: '16px',
  border: '1px dashed rgba(148, 163, 184, 0.4)',
  textAlign: 'center',
  color: '#64748b',
  background: 'rgba(248, 250, 252, 0.7)',
};

const folderTreeNodeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  width: '100%',
};

const folderRowWrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
};

const folderToggleStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  borderRadius: '10px',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'rgba(255, 255, 255, 0.9)',
  color: '#475569',
  fontSize: '13px',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.2s ease, border 0.2s ease',
};

const folderTogglePlaceholderStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '10px',
  border: '1px solid transparent',
  visibility: 'hidden',
};

const folderChildrenStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  width: '100%',
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
  width: '100%',
  textAlign: 'left',
};

const folderButtonContentStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  width: '100%',
};


const folderNameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '15px',
  color: 'inherit',
  flex: '1 1 auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
  flex: '1 1 520px',
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

const actionBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
};

const searchAreaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  flex: '1 1 320px',
  minWidth: '260px',
};

const searchRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
};

const searchInputFullStyle: React.CSSProperties = {
  flex: '1 1 auto',
  padding: '11px 16px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'white',
  fontSize: '14px',
};

const searchClearButtonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'white',
  color: '#475569',
  fontSize: '13px',
  cursor: 'pointer',
};

const searchStatsStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#2563eb',
};

const actionButtonsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const secondaryActionButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'white',
  color: '#1f2937',
  fontWeight: 600,
  cursor: 'pointer',
};

const aiPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  padding: '20px',
  borderRadius: '18px',
  border: '1px solid rgba(59, 130, 246, 0.2)',
  background: 'linear-gradient(135deg, rgba(191, 219, 254, 0.35), rgba(165, 243, 252, 0.25))',
};

const aiPanelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  flexWrap: 'wrap',
};

const aiPanelTitleStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: '16px',
  fontWeight: 600,
  color: '#1d4ed8',
};

const aiPanelSubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#475569',
};

const aiWorkingStyle: React.CSSProperties = {
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 600,
};

const aiStrategyListStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '12px',
};

const aiStrategyButtonStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  alignItems: 'flex-start',
  padding: '14px 16px',
  borderRadius: '16px',
  border: '1px solid rgba(59, 130, 246, 0.35)',
  background: 'rgba(255, 255, 255, 0.86)',
  color: '#1e293b',
  textAlign: 'left',
};

const aiStrategyTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '14px',
  color: '#1d4ed8',
};

const aiStrategyDescriptionStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#475569',
};

const aiStatusInlineStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  fontSize: '13px',
};

const aiStatusBannerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap',
  fontSize: '13px',
  padding: '10px 14px',
  borderRadius: '14px',
  background: 'rgba(219, 234, 254, 0.35)',
  border: '1px solid rgba(147, 197, 253, 0.5)',
};

const aiSuccessStyle: React.CSSProperties = {
  color: '#16a34a',
};

const aiErrorStyle: React.CSSProperties = {
  color: '#dc2626',
};

const contentHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  flexWrap: 'wrap',
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
  gap: '18px',
  overflowY: 'auto',
  paddingRight: '6px',
};

const bookmarkGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: '16px',
  alignItems: 'stretch',
};

const bookmarkItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  borderRadius: '18px',
  padding: '16px 18px',
  background: 'linear-gradient(140deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.98))',
  transition: 'transform 0.2s ease, border 0.2s ease, box-shadow 0.2s ease',
  height: '100%',
};

const bookmarkTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
};

const bookmarkNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#0f172a',
  fontSize: '16px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const editButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const bookmarkMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const bookmarkHostStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#475569',
  fontWeight: 500,
};


const bookmarkUrlStyle: React.CSSProperties = {
  color: '#2563eb',
  fontSize: '13px',
  wordBreak: 'break-all',
};

const editingContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const editingInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  fontSize: '14px',
};

const editActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

const editSaveButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '10px',
  border: 'none',
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const editCancelButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '10px',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  background: 'white',
  color: '#475569',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const dropZoneStyle: React.CSSProperties = {
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
