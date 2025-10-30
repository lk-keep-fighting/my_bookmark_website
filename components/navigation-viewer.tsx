'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { BookmarkDocument, BookmarkNode } from '@/lib/bookmarks';
import { bookmarkDocumentToHtml, calculateBookmarkStatistics } from '@/lib/bookmarks';
import type {
  AiOrganizeJobSnapshot,
  AiOrganizeRequestPayload,
  AiPlanGroup,
  AiPlanResult,
  AiStrategyId,
} from '@/lib/bookmarks/ai';
import { getStrategyDisplayName } from '@/lib/bookmarks/ai';

interface NavigationViewerProps {
  document: BookmarkDocument | null;
  emptyHint?: string;
  header?: React.ReactNode;
  editable?: boolean;
  siteTitle?: string | null;
  contactEmail?: string | null;
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

const AI_JOB_STATUS_LABELS: Record<AiOrganizeJobSnapshot['status'], string> = {
  pending: '等待执行',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已停止',
};

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
  siteTitle,
  contactEmail,
  onDocumentChange,
}: NavigationViewerProps) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'bookmark-card-animations';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes borderGradientRotate {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, []);

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
  const [hoveredBookmarkId, setHoveredBookmarkId] = useState<string | null>(null);
  const [pressingBookmarkId, setPressingBookmarkId] = useState<string | null>(null);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isApplyingAi, setIsApplyingAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [activeAiJob, setActiveAiJob] = useState<AiOrganizeJobSnapshot | null>(null);
  const [aiJobMatches, setAiJobMatches] = useState<BookmarkMatch[] | null>(null);
  const [isCheckingAiJob, setIsCheckingAiJob] = useState(false);
  const appliedAiJobIdRef = useRef<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const previousRootIdRef = useRef<string | null>(null);
  const folderRenameInputRef = useRef<HTMLInputElement | null>(null);

  const jobInProgress = Boolean(
    activeAiJob && (activeAiJob.status === 'pending' || activeAiJob.status === 'running'),
  );
  const isAiBusy = isApplyingAi || isCheckingAiJob || jobInProgress;

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

  useEffect(() => {
    if (!activeAiJob) {
      return;
    }

    if (activeAiJob.status === 'succeeded' && activeAiJob.result) {
      if (!editable || !bookmarkDocument || !onDocumentChange) {
        return;
      }
      if (appliedAiJobIdRef.current === activeAiJob.id) {
        return;
      }
      if (!aiJobMatches || aiJobMatches.length === 0) {
        setAiError('未找到原始书签上下文，无法应用本次整理结果。');
        appliedAiJobIdRef.current = activeAiJob.id;
        setActiveAiJob(null);
        setAiJobMatches(null);
        return;
      }

      const nextFolder = buildFolderFromAiPlan(activeAiJob.result.plan, activeAiJob.strategy, aiJobMatches);
      if (!nextFolder) {
        setAiError('未能生成有效的整理结果，请稍后再试');
        appliedAiJobIdRef.current = activeAiJob.id;
        setActiveAiJob(null);
        setAiJobMatches(null);
        return;
      }

      const nextRootChildren = [...(bookmarkDocument.root.children ?? []), nextFolder];
      const nextRoot: BookmarkNode = {
        ...bookmarkDocument.root,
        children: nextRootChildren,
      };
      const nextDocument: BookmarkDocument = {
        ...bookmarkDocument,
        root: nextRoot,
        statistics: calculateBookmarkStatistics(nextRoot),
      };

      onDocumentChange?.(nextDocument);
      const successMessage =
        activeAiJob.result.plan.summary?.trim() ?? `已生成「${nextFolder.name}」分类，原有书签保持不变。`;
      setAiMessage(successMessage);
      setSelectedFolderId(nextFolder.id);
      if (searchActive) {
        setQuery('');
      }
      appliedAiJobIdRef.current = activeAiJob.id;
      setActiveAiJob(null);
      setAiJobMatches(null);
      setIsAiPanelOpen(false);
      return;
    }

    if (appliedAiJobIdRef.current === activeAiJob.id) {
      return;
    }

    if (activeAiJob.status === 'failed') {
      if (activeAiJob.error) {
        setAiError(activeAiJob.error);
      } else {
        setAiError('AI 整理任务执行失败，请稍后再试');
      }
      appliedAiJobIdRef.current = activeAiJob.id;
      setActiveAiJob(null);
      setAiJobMatches(null);
      return;
    }

    if (activeAiJob.status === 'cancelled') {
      setAiMessage('AI 整理任务已停止');
      appliedAiJobIdRef.current = activeAiJob.id;
      setActiveAiJob(null);
      setAiJobMatches(null);
    }
  }, [activeAiJob, aiJobMatches, bookmarkDocument, editable, onDocumentChange, searchActive]);

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

  useEffect(() => {
    setHoveredBookmarkId(null);
    setPressingBookmarkId(null);
  }, [bookmarkDocument, activeFolderId, searchActive]);

  const activeFolderEntry = useMemo(() => {
    if (!activeFolderId) return null;
    return folderEntries.find((entry) => entry.id === activeFolderId) ?? null;
  }, [activeFolderId, folderEntries]);

  useEffect(() => {
    if (!activeFolderEntry) {
      setIsRenamingFolder(false);
      setFolderRenameValue('');
      return;
    }
    setFolderRenameValue(activeFolderEntry.name ?? '');
    setIsRenamingFolder(false);
  }, [activeFolderEntry]);

  useEffect(() => {
    if (isRenamingFolder && folderRenameInputRef.current) {
      folderRenameInputRef.current.focus();
      folderRenameInputRef.current.select();
    }
  }, [isRenamingFolder]);

  const originalFolderName = activeFolderEntry?.name ?? '';

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

  const handleStartFolderRename = useCallback(() => {
    if (!editable || !activeFolderEntry) {
      return;
    }
    setFolderRenameValue(activeFolderEntry.name ?? '');
    setIsRenamingFolder(true);
  }, [editable, activeFolderEntry]);

  const handleCancelFolderRename = useCallback(() => {
    setFolderRenameValue(originalFolderName);
    setIsRenamingFolder(false);
  }, [originalFolderName]);

  const handleCommitFolderRename = useCallback(() => {
    if (!editable || !bookmarkDocument || !activeFolderId || !activeFolderEntry) {
      setFolderRenameValue(originalFolderName);
      setIsRenamingFolder(false);
      return;
    }
    const trimmed = folderRenameValue.trim();
    const currentName = activeFolderEntry.name ?? '';
    if (!trimmed) {
      setFolderRenameValue(currentName);
      setIsRenamingFolder(false);
      return;
    }
    if (trimmed === currentName) {
      setFolderRenameValue(currentName);
      setIsRenamingFolder(false);
      return;
    }
    const nextDocument = renameFolderInDocument(bookmarkDocument, activeFolderId, trimmed);
    if (onDocumentChange && nextDocument !== bookmarkDocument) {
      onDocumentChange(nextDocument);
    }
    setFolderRenameValue(trimmed);
    setIsRenamingFolder(false);
  }, [editable, bookmarkDocument, activeFolderId, activeFolderEntry, folderRenameValue, onDocumentChange, originalFolderName]);

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
    async (strategyId: AiStrategyId) => {
      if (!editable || !bookmarkDocument) {
        return;
      }
      if (jobInProgress) {
        setAiError('已有 AI 整理任务正在执行，请先刷新或停止当前任务。');
        return;
      }
      if (bookmarkMatches.length === 0) {
        setAiError('当前书签为空，无法执行自动整理');
        return;
      }
      setIsApplyingAi(true);
      setAiError(null);
      setAiMessage(null);

      const matchesForPayload = bookmarkMatches.slice();
      const payload: AiOrganizeRequestPayload = {
        strategy: strategyId,
        locale: 'zh-CN',
        bookmarks: matchesForPayload.map((match) => {
          const trailNames = match.trail.map((item) => item.name).filter(Boolean);
          const parentFolderName = trailNames.length > 0 ? trailNames[trailNames.length - 1] : undefined;
          return {
            id: match.node.id,
            name: cleanBookmarkTitle(match.node.name),
            url: match.node.url ?? undefined,
            trail: trailNames.join(' > ') || undefined,
            domain: match.node.url ? extractHostname(match.node.url) : undefined,
            parentFolderName,
          };
        }),
      };

      try {
        const response = await fetch('/api/bookmarks/ai-organize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const result = (await response.json().catch(() => null)) as unknown;

        if (!response.ok) {
          const errorMessage =
            result && typeof result === 'object' && 'error' in result && typeof (result as { error?: unknown }).error === 'string'
              ? ((result as { error?: string }).error ?? '自动整理任务发起失败，请稍后再试')
              : '自动整理任务发起失败，请稍后再试';
          throw new Error(errorMessage);
        }

        const job = result && typeof result === 'object' && 'job' in result ? (result as { job?: unknown }).job : null;
        if (!isAiOrganizeJobSnapshot(job)) {
          throw new Error('AI 任务响应格式不正确，请稍后再试');
        }

        setActiveAiJob(job);
        setAiJobMatches(matchesForPayload);
        appliedAiJobIdRef.current = null;

        const successMessage =
          (result && typeof result === 'object' && 'message' in result && typeof (result as { message?: unknown }).message === 'string'
            ? (result as { message?: string }).message
            : null) ?? 'AI 整理任务已在后台创建，请稍后刷新任务状态。';

        setAiMessage(successMessage);
      } catch (error) {
        console.error('AI 自动整理任务创建失败', error);
        setAiError(error instanceof Error ? error.message : '自动整理任务创建失败，请稍后再试');
      } finally {
        setIsApplyingAi(false);
      }
    },
    [editable, bookmarkDocument, bookmarkMatches, jobInProgress],
  );

  const handleRefreshAiJob = useCallback(async () => {
    if (!activeAiJob) {
      setAiError('当前没有正在执行的 AI 任务');
      return;
    }
    setIsCheckingAiJob(true);
    setAiError(null);
    try {
      const response = await fetch(`/api/bookmarks/ai-organize/${activeAiJob.id}`);
      const result = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        const errorMessage =
          result && typeof result === 'object' && 'error' in result && typeof (result as { error?: unknown }).error === 'string'
            ? ((result as { error?: string }).error ?? '刷新任务状态失败，请稍后重试')
            : '刷新任务状态失败，请稍后重试';
        throw new Error(errorMessage);
      }

      const job = result && typeof result === 'object' && 'job' in result ? (result as { job?: unknown }).job : null;
      if (!isAiOrganizeJobSnapshot(job)) {
        throw new Error('AI 任务状态响应异常，请稍后再试');
      }

      setActiveAiJob(job);
      if (result && typeof result === 'object' && 'message' in result && typeof (result as { message?: unknown }).message === 'string') {
        const nextMessage = (result as { message?: string }).message;
        if (nextMessage) {
          setAiMessage(nextMessage);
        }
      }
      if (job.status === 'failed' && job.error) {
        setAiError(job.error);
      }
    } catch (error) {
      console.error('刷新 AI 任务状态失败', error);
      setAiError(error instanceof Error ? error.message : '刷新任务状态失败，请稍后重试');
    } finally {
      setIsCheckingAiJob(false);
    }
  }, [activeAiJob]);

  const handleCancelAiJob = useCallback(async () => {
    if (!activeAiJob) {
      setAiError('当前没有正在执行的 AI 任务');
      return;
    }
    if (activeAiJob.status === 'succeeded' || activeAiJob.status === 'failed' || activeAiJob.status === 'cancelled') {
      setAiMessage('该 AI 任务已完成，无需停止');
      return;
    }
    setIsCheckingAiJob(true);
    setAiError(null);
    try {
      const response = await fetch(`/api/bookmarks/ai-organize/${activeAiJob.id}`, {
        method: 'DELETE',
      });
      const result = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        const errorMessage =
          result && typeof result === 'object' && 'error' in result && typeof (result as { error?: unknown }).error === 'string'
            ? ((result as { error?: string }).error ?? '停止任务失败，请稍后再试')
            : '停止任务失败，请稍后再试';
        throw new Error(errorMessage);
      }

      const job = result && typeof result === 'object' && 'job' in result ? (result as { job?: unknown }).job : null;
      if (!isAiOrganizeJobSnapshot(job)) {
        throw new Error('AI 停止任务响应异常，请稍后再试');
      }

      setActiveAiJob(job);
      if (result && typeof result === 'object' && 'message' in result && typeof (result as { message?: unknown }).message === 'string') {
        const nextMessage = (result as { message?: string }).message;
        if (nextMessage) {
          setAiMessage(nextMessage);
        }
      }
    } catch (error) {
      console.error('停止 AI 任务失败', error);
      setAiError(error instanceof Error ? error.message : '停止任务失败，请稍后再试');
    } finally {
      setIsCheckingAiJob(false);
    }
  }, [activeAiJob]);

  if (!bookmarkDocument) {
    return (
      <div style={emptyContainerStyle}>
        <p style={emptyHintStyle}>{emptyHint ?? '暂未导入书签，上传 HTML 文件后即可预览导航站。'}</p>
      </div>
    );
  }

  const resolvedSiteTitle = (() => {
    const fromProp = siteTitle?.trim();
    if (fromProp) return fromProp;
    const fromMetadata = bookmarkDocument.metadata?.siteTitle?.trim();
    if (fromMetadata) return fromMetadata;
    const fromRoot = bookmarkDocument.root.name?.trim();
    if (fromRoot) return fromRoot;
    return '我的导航站';
  })();

  const resolvedContactEmail = (() => {
    const fromProp = contactEmail?.trim();
    if (fromProp) return fromProp;
    const fromMetadata = bookmarkDocument.metadata?.contactEmail?.trim();
    if (fromMetadata) return fromMetadata;
    return '';
  })();

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
      <div style={brandingContainerStyle}>
        <div style={brandingTitleGroupStyle}>
          <h1 style={brandingTitleStyle}>{resolvedSiteTitle}</h1>
          {resolvedContactEmail && (
            <a href={`mailto:${resolvedContactEmail}`} style={brandingEmailStyle}>
              {resolvedContactEmail}
            </a>
          )}
        </div>
        <div style={brandingMetaStyle}>
          <span style={brandingMetaItemStyle}>{bookmarkDocument.statistics.total_bookmarks} 个网页</span>
          <span style={brandingMetaDotStyle} />
          <span style={brandingMetaItemStyle}>{bookmarkDocument.statistics.total_folders} 个目录</span>
        </div>
      </div>
      <div style={layoutStyle}>
        <aside style={sidebarStyle}>
          {searchActive && (
            <div style={sidebarSearchInfoStyle}>搜索结果覆盖 {visibleFolderEntries.length} 个目录</div>
          )}
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
                {isAiBusy && (
                  <span style={aiWorkingStyle}>
                    {isCheckingAiJob ? '同步任务状态…' : jobInProgress ? '后台整理进行中…' : '正在提交任务…'}
                  </span>
                )}
              </div>
              <div style={aiStrategyListStyle}>
                {AI_STRATEGIES.map((strategy) => (
                  <button
                    key={strategy.id}
                    type="button"
                    onClick={() => handleApplyAiStrategy(strategy.id)}
                    disabled={isAiBusy}
                    style={{
                      ...aiStrategyButtonStyle,
                      opacity: isAiBusy ? 0.55 : 1,
                      cursor: isAiBusy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <div style={aiStrategyTitleStyle}>{strategy.title}</div>
                    <div style={aiStrategyDescriptionStyle}>{strategy.description}</div>
                  </button>
                ))}
              </div>
              {activeAiJob && (
                <div style={aiJobStatusCardStyle}>
                  <div style={aiJobStatusHeaderStyle}>
                    <div style={aiJobStatusTitleGroupStyle}>
                      <span style={aiJobStatusTitleStyle}>{`当前任务 · ${getStrategyDisplayName(activeAiJob.strategy)}`}</span>
                      <span style={aiJobStatusMetaStyle}>
                        共 {activeAiJob.totalBookmarks} 条书签
                        {activeAiJob.cancelRequested && activeAiJob.status !== 'cancelled' ? ' · 已提交停止请求' : ''}
                      </span>
                    </div>
                    <span
                      style={{
                        ...aiJobStatusBadgeStyle,
                        ...aiJobStatusBadgeColors[activeAiJob.status],
                      }}
                    >
                      {AI_JOB_STATUS_LABELS[activeAiJob.status]}
                    </span>
                  </div>
                  {activeAiJob.status === 'succeeded' && activeAiJob.result?.plan.summary && (
                    <p style={aiJobSummaryStyle}>{activeAiJob.result.plan.summary}</p>
                  )}
                  {activeAiJob.status === 'failed' && activeAiJob.error && (
                    <p style={aiJobErrorTextStyle}>{activeAiJob.error}</p>
                  )}
                  <div style={aiJobActionsStyle}>
                    <button
                      type="button"
                      onClick={handleRefreshAiJob}
                      disabled={!activeAiJob || isCheckingAiJob}
                      style={{
                        ...aiJobActionButtonStyle,
                        opacity: isCheckingAiJob ? 0.55 : 1,
                        cursor: isCheckingAiJob ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isCheckingAiJob ? '刷新中…' : '刷新任务状态'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelAiJob}
                      disabled={!jobInProgress || isCheckingAiJob}
                      style={{
                        ...aiJobActionButtonStyle,
                        ...aiJobDangerButtonStyle,
                        opacity: !jobInProgress || isCheckingAiJob ? 0.55 : 1,
                        cursor: !jobInProgress || isCheckingAiJob ? 'not-allowed' : 'pointer',
                      }}
                    >
                      停止任务
                    </button>
                  </div>
                </div>
              )}
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
            <div style={contentTitleColumnStyle}>
              <div style={contentTitleRowStyle}>
                {isRenamingFolder ? (
                  <div style={folderRenameRowStyle}>
                    <input
                      ref={folderRenameInputRef}
                      value={folderRenameValue}
                      onChange={(event) => setFolderRenameValue(event.target.value)}
                      onBlur={handleCommitFolderRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleCommitFolderRename();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          handleCancelFolderRename();
                        }
                      }}
                      placeholder="输入目录名称"
                      style={folderRenameInputStyle}
                    />
                    <div style={folderRenameActionsStyle}>
                      <button
                        type="button"
                        style={editSaveButtonStyle}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleCommitFolderRename}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        style={editCancelButtonStyle}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleCancelFolderRename}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 style={contentTitleStyle}>{activeFolderName}</h3>
                    {editable && activeFolderEntry && (
                      <button type="button" onClick={handleStartFolderRename} style={renameFolderButtonStyle}>
                        重命名目录
                      </button>
                    )}
                  </>
                )}
              </div>
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
                  const isDraggingCurrent = draggingId === node.id;
                  const isHovered = !isDraggingCurrent && hoveredBookmarkId === node.id;
                  const isPressing = !isDraggingCurrent && pressingBookmarkId === node.id;
                  const isDragOver = dragOverId === node.id;
                  const cardBorder = isDragOver
                    ? '2px dashed rgba(59, 130, 246, 0.8)'
                    : isPressing
                      ? '2px solid rgba(14, 165, 233, 0.7)'
                      : isHovered
                        ? '2px solid transparent'
                        : '1px solid rgba(148, 163, 184, 0.28)';
                  const cardBackground = isPressing
                    ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.92), rgba(14, 165, 233, 0.88))'
                    : isHovered
                      ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(14, 165, 233, 0.18))'
                      : bookmarkItemStyle.background;
                  const cardShadow = isPressing
                    ? '0 20px 44px rgba(12, 74, 110, 0.35)'
                    : isHovered
                      ? '0 24px 48px rgba(30, 64, 175, 0.2)'
                      : bookmarkItemStyle.boxShadow;
                  const cardTransform = isPressing
                    ? 'translateY(2px) scale(0.98)'
                    : isHovered
                      ? 'translateY(-4px) scale(1.04)'
                      : 'translateY(0)';
                  const cardZIndex = isHovered || isPressing ? 10 : 1;
                  const nameColor = isPressing ? '#f8fafc' : '#0f172a';
                  const hostColor = isPressing ? 'rgba(226, 232, 240, 0.9)' : '#475569';
                  const editColor = isPressing ? '#e0f2fe' : '#2563eb';

                  return (
                    <div
                      key={node.id}
                      style={{
                        position: 'relative',
                        height: '100%',
                      }}
                    >
                      {isHovered && !isDraggingCurrent && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '-2px',
                            left: '-2px',
                            right: '-2px',
                            bottom: '-2px',
                            borderRadius: '20px',
                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(168, 85, 247, 0.9), rgba(236, 72, 153, 0.9), rgba(251, 146, 60, 0.9), rgba(59, 130, 246, 0.9))',
                            backgroundSize: '300% 300%',
                            animation: 'borderGradientRotate 3s ease infinite',
                            zIndex: -1,
                            pointerEvents: 'none',
                          }}
                        />
                      )}
                      <div
                        draggable={canReorder && !isEditing}
                        onDragStart={(event) => {
                          if (!canReorder || isEditing) return;
                          setPressingBookmarkId(null);
                          setDraggingId(node.id);
                          setHoveredBookmarkId(node.id);
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
                          setHoveredBookmarkId(null);
                          setPressingBookmarkId(null);
                        }}
                        onMouseEnter={() => {
                          if (isEditing) return;
                          setHoveredBookmarkId(node.id);
                        }}
                        onMouseLeave={() => {
                          setHoveredBookmarkId((current) => (current === node.id ? null : current));
                          setPressingBookmarkId((current) => (current === node.id ? null : current));
                        }}
                        onFocus={() => {
                          if (isEditing) return;
                          setHoveredBookmarkId(node.id);
                        }}
                        onBlur={() => {
                          setHoveredBookmarkId((current) => (current === node.id ? null : current));
                          setPressingBookmarkId((current) => (current === node.id ? null : current));
                        }}
                        onMouseDown={() => {
                          if (isEditing) return;
                          setPressingBookmarkId(node.id);
                        }}
                        onMouseUp={() => {
                          setPressingBookmarkId((current) => (current === node.id ? null : current));
                        }}
                        onTouchStart={() => {
                          if (isEditing) return;
                          setPressingBookmarkId(node.id);
                        }}
                        onTouchEnd={() => {
                          setPressingBookmarkId((current) => (current === node.id ? null : current));
                        }}
                        style={{
                          ...bookmarkItemStyle,
                          opacity: isDraggingCurrent ? 0.6 : 1,
                          border: cardBorder,
                          cursor: canReorder ? 'grab' : node.url ? 'pointer' : 'default',
                          background: cardBackground,
                          boxShadow: cardShadow,
                          transform: cardTransform,
                          zIndex: cardZIndex,
                        }}
                        onClick={(e) => {
                          if (!canReorder && !isEditing && node.url) {
                            const target = e.target as HTMLElement;
                            if (target.tagName !== 'BUTTON' && !target.closest('button')) {
                              window.open(node.url, '_blank', 'noopener,noreferrer');
                            }
                          }
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
                          <span style={{ ...bookmarkNameStyle, color: nameColor }}>{node.name?.trim() || '未命名网页'}</span>
                          {editable && (
                            <button
                              type="button"
                              style={{ ...editButtonStyle, color: editColor }}
                              onClick={() => handleStartEditing(node.id, node.name ?? '')}
                            >
                              编辑名称
                            </button>
                          )}
                        </div>
                      )}
                      {host && (
                        <div style={bookmarkMetaRowStyle}>
                          <span style={{ ...bookmarkHostStyle, color: hostColor }}>{host}</span>
                        </div>
                      )}
                      </div>
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

function renameFolderInDocument(document: BookmarkDocument, folderId: string, nextName: string): BookmarkDocument {
  const updatedRoot = renameFolderInNode(document.root, folderId, nextName);
  if (updatedRoot === document.root) {
    return document;
  }
  return {
    ...document,
    root: updatedRoot,
  };
}

function renameFolderInNode(node: BookmarkNode, folderId: string, nextName: string): BookmarkNode {
  if (node.type !== 'folder') {
    return node;
  }
  const existingChildren = node.children ?? [];
  let childrenChanged = false;
  const nextChildren = existingChildren.map((child) => {
    if (child.type !== 'folder') {
      return child;
    }
    const updatedChild = renameFolderInNode(child, folderId, nextName);
    if (updatedChild !== child) {
      childrenChanged = true;
      return updatedChild;
    }
    return child;
  });
  const isTarget = node.id === folderId;
  const nameChanged = isTarget && node.name !== nextName;
  if (!nameChanged && !childrenChanged) {
    return node;
  }
  return {
    ...node,
    name: nameChanged ? nextName : node.name,
    children: childrenChanged ? nextChildren : node.children,
  };
}

function isAiOrganizeJobSnapshot(value: unknown): value is AiOrganizeJobSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as {
    id?: unknown;
    status?: unknown;
    strategy?: unknown;
    strategyLabel?: unknown;
    locale?: unknown;
    totalBookmarks?: unknown;
  };

  if (typeof snapshot.id !== 'string' || !snapshot.id) {
    return false;
  }

  const status = snapshot.status;
  if (status !== 'pending' && status !== 'running' && status !== 'succeeded' && status !== 'failed' && status !== 'cancelled') {
    return false;
  }

  const strategy = snapshot.strategy;
  if (strategy !== 'domain-groups' && strategy !== 'semantic-clusters' && strategy !== 'alphabetical') {
    return false;
  }

  if (typeof snapshot.strategyLabel !== 'string') {
    return false;
  }

  if (typeof snapshot.locale !== 'string') {
    return false;
  }

  if (typeof snapshot.totalBookmarks !== 'number') {
    return false;
  }

  return true;
}

function buildFolderFromAiPlan(
  plan: AiPlanResult,
  strategyId: AiStrategyId,
  matches: BookmarkMatch[],
): BookmarkNode | null {
  if (!plan || !Array.isArray(plan.groups) || plan.groups.length === 0) {
    return null;
  }

  const bookmarkMap = new Map(matches.map((match) => [match.node.id, match.node]));
  const usedIds = new Set<string>();
  const groupNodes: BookmarkNode[] = [];
  const fallbackGroupNames = new Set(['其他收藏', '未分组', 'Others', '其它收藏', 'Misc']);
  let fallbackIndex: number | null = null;

  for (const groupRaw of plan.groups) {
    if (!groupRaw || typeof groupRaw !== 'object') continue;
    const group = groupRaw as AiPlanGroup;
    const groupName = typeof group.name === 'string' ? group.name.trim() : '';
    if (!groupName) continue;

    const bookmarksInput = Array.isArray(group.bookmarks) ? group.bookmarks : [];
    const bookmarkNodes: BookmarkNode[] = [];

    for (const bookmarkRaw of bookmarksInput) {
      if (!bookmarkRaw || typeof bookmarkRaw !== 'object') continue;
      const bookmarkId = typeof bookmarkRaw.id === 'string' ? bookmarkRaw.id.trim() : '';
      if (!bookmarkId) continue;

      const original = bookmarkMap.get(bookmarkId);
      if (!original || usedIds.has(original.id)) continue;

      usedIds.add(original.id);
      const suggestedName = typeof bookmarkRaw.newName === 'string' ? bookmarkRaw.newName.trim() : '';
      const finalName = suggestedName || cleanBookmarkTitle(original.name);

      bookmarkNodes.push(cloneBookmark(original, finalName));
    }

    if (bookmarkNodes.length === 0) {
      continue;
    }

    const sortedChildren = bookmarkNodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    groupNodes.push({
      type: 'folder',
      id: generateNodeId(),
      name: groupName,
      children: sortedChildren,
    });

    if (fallbackIndex === null && fallbackGroupNames.has(groupName)) {
      fallbackIndex = groupNodes.length - 1;
    }
  }

  if (groupNodes.length === 0) {
    return null;
  }

  const eligibleMatches = matches.filter((match) => bookmarkMap.has(match.node.id));
  if (usedIds.size < eligibleMatches.length) {
    const leftoverNodes: BookmarkNode[] = [];
    for (const match of eligibleMatches) {
      if (usedIds.has(match.node.id)) continue;
      usedIds.add(match.node.id);
      leftoverNodes.push(cloneBookmark(match.node, cleanBookmarkTitle(match.node.name)));
    }
    if (leftoverNodes.length > 0) {
      const sortedLeftovers = leftoverNodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      if (fallbackIndex !== null) {
        const existing = groupNodes[fallbackIndex];
        groupNodes[fallbackIndex] = {
          ...existing,
          children: [...(existing.children ?? []), ...sortedLeftovers].sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-CN'),
          ),
        };
      } else {
        groupNodes.push({
          type: 'folder',
          id: generateNodeId(),
          name: '其他收藏',
          children: sortedLeftovers,
        });
      }
    }
  }

  const folderTitle =
    typeof plan.folderTitle === 'string' && plan.folderTitle.trim()
      ? plan.folderTitle.trim()
      : `AI 整理 · ${getStrategyDisplayName(strategyId)}（${formatFolderTimestamp(new Date())}）`;

  return {
    type: 'folder',
    id: generateNodeId(),
    name: folderTitle,
    children: groupNodes,
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
  flexDirection: 'column',
  gap: '20px',
  minHeight: '520px',
};

const brandingContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  flexWrap: 'wrap',
  padding: '4px 4px 0',
};

const brandingTitleGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const brandingTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '24px',
  fontWeight: 700,
  color: '#0f172a',
  letterSpacing: '-0.2px',
};

const brandingEmailStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#2563eb',
  textDecoration: 'none',
  fontWeight: 500,
};

const brandingMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  fontSize: '13px',
  color: '#64748b',
  fontWeight: 500,
};

const brandingMetaItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const brandingMetaDotStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'rgba(148, 163, 184, 0.6)',
};

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  gap: '20px',
  width: '100%',
  minHeight: '520px',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
};

const sidebarStyle: React.CSSProperties = {
  width: '260px',
  minWidth: '220px',
  flex: '0 0 260px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  background: 'rgba(248, 250, 252, 0.82)',
  borderRadius: '20px',
  padding: '18px 16px',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.06)',
  position: 'relative',
  zIndex: 1,
  maxHeight: 'calc(100vh - 200px)',
  overflow: 'hidden',
};

const sidebarSearchInfoStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#2563eb',
  fontWeight: 600,
  padding: '8px 10px',
  borderRadius: '12px',
  background: 'rgba(37, 99, 235, 0.08)',
  margin: '0 0 4px',
};

const sidebarListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  overflowY: 'auto',
  paddingRight: '4px',
  maxHeight: '100%',
  flex: '1 1 auto',
  marginTop: '4px',
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
  background: 'rgba(255, 255, 255, 0.92)',
  borderRadius: '24px',
  padding: '26px 30px',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
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

const aiJobStatusCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  marginTop: '4px',
  padding: '16px',
  borderRadius: '16px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'linear-gradient(135deg, rgba(240, 249, 255, 0.92), rgba(236, 254, 255, 0.9))',
};

const aiJobStatusHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  flexWrap: 'wrap',
};

const aiJobStatusTitleGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const aiJobStatusTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#0f172a',
};

const aiJobStatusMetaStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#475569',
};

const aiJobStatusBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px 12px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 600,
  letterSpacing: '0.3px',
};

const aiJobStatusBadgeColors: Record<AiOrganizeJobSnapshot['status'], React.CSSProperties> = {
  pending: {
    background: 'rgba(191, 219, 254, 0.35)',
    color: '#1d4ed8',
    border: '1px solid rgba(59, 130, 246, 0.25)',
  },
  running: {
    background: 'rgba(187, 247, 208, 0.4)',
    color: '#15803d',
    border: '1px solid rgba(34, 197, 94, 0.28)',
  },
  succeeded: {
    background: 'rgba(167, 243, 208, 0.45)',
    color: '#047857',
    border: '1px solid rgba(16, 185, 129, 0.32)',
  },
  failed: {
    background: 'rgba(254, 202, 202, 0.45)',
    color: '#b91c1c',
    border: '1px solid rgba(248, 113, 113, 0.28)',
  },
  cancelled: {
    background: 'rgba(226, 232, 240, 0.5)',
    color: '#475569',
    border: '1px solid rgba(148, 163, 184, 0.3)',
  },
};

const aiJobSummaryStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#1f2937',
  lineHeight: 1.5,
};

const aiJobErrorTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#b91c1c',
  lineHeight: 1.5,
};

const aiJobActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
};

const aiJobActionButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '10px',
  border: '1px solid rgba(59, 130, 246, 0.35)',
  background: '#ffffff',
  color: '#1d4ed8',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.2s ease, color 0.2s ease, border 0.2s ease',
};

const aiJobDangerButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(248, 113, 113, 0.45)',
  color: '#dc2626',
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

const contentTitleColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  flex: '1 1 auto',
  minWidth: 0,
};

const contentTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const contentTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '20px',
  color: '#0f172a',
};

const contentSubtitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: '13px',
  color: '#64748b',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
};

const renameFolderButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(37, 99, 235, 0.35)',
  background: 'white',
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.2s ease, border 0.2s ease, color 0.2s ease',
};

const folderRenameRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  width: '100%',
};

const folderRenameInputStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  fontSize: '16px',
  fontWeight: 600,
  minWidth: '200px',
  background: 'rgba(255, 255, 255, 0.96)',
};

const folderRenameActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
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
  gap: '18px',
  alignItems: 'stretch',
  position: 'relative',
};

const bookmarkItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  borderRadius: '18px',
  padding: '16px 18px',
  background: 'linear-gradient(140deg, rgba(248, 250, 252, 0.95), rgba(255, 255, 255, 0.98))',
  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.08)',
  transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), border 0.2s ease, box-shadow 0.3s ease, background 0.25s ease',
  height: '100%',
  position: 'relative',
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
  transition: 'color 0.2s ease',
};

const editButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'color 0.2s ease',
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
  transition: 'color 0.2s ease',
};

const bookmarkVisitLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  alignSelf: 'flex-start',
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  padding: '6px 10px',
  borderRadius: '999px',
  border: '1px solid rgba(37, 99, 235, 0.25)',
  background: 'rgba(37, 99, 235, 0.08)',
  transition: 'background 0.2s ease, border 0.2s ease, color 0.2s ease',
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
