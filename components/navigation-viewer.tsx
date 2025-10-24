'use client';

import { useMemo, useState } from 'react';
import type React from 'react';
import type { BookmarkDocument, BookmarkNode } from '@/lib/bookmarks';

interface NavigationViewerProps {
  document: BookmarkDocument | null;
  emptyHint?: string;
}

export function NavigationViewer({ document, emptyHint }: NavigationViewerProps) {
  const [query, setQuery] = useState('');

  const filteredDoc = useMemo(() => {
    if (!document) return null;
    if (!query.trim()) return document;
    const filteredRoot = filterNode(document.root, query.trim().toLowerCase());
    if (!filteredRoot) return null;
    return {
      ...document,
      root: filteredRoot,
    } satisfies BookmarkDocument;
  }, [document, query]);

  if (!document) {
    return (
      <div style={containerStyle}>
        <p style={hintStyle}>{emptyHint ?? '暂未导入书签，上传 HTML 文件后即可预览导航站。'}</p>
      </div>
    );
  }

  const activeDoc = filteredDoc;

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称或链接"
          style={searchInputStyle}
        />
        <div style={{ fontSize: '14px', color: '#6b7280' }}>
          共 {document.statistics.total_folders} 个目录 / {document.statistics.total_bookmarks} 个书签
        </div>
      </div>

      {!activeDoc ? (
        <p style={hintStyle}>未找到匹配结果，尝试调整关键词。</p>
      ) : (
        <div style={treeContainerStyle}>
          <Tree node={activeDoc.root} forceExpand={Boolean(query.trim())} />
        </div>
      )}
    </div>
  );
}

function filterNode(node: BookmarkNode, keyword: string): BookmarkNode | null {
  if (node.type === 'bookmark') {
    const matches =
      node.name.toLowerCase().includes(keyword) || (node.url ?? '').toLowerCase().includes(keyword);
    return matches ? node : null;
  }

  const children = node.children?.map((child) => filterNode(child, keyword)).filter(Boolean) as BookmarkNode[];
  const matchesSelf = node.name.toLowerCase().includes(keyword);

  if (!matchesSelf && children.length === 0) {
    return null;
  }

  return {
    ...node,
    children,
  };
}

function Tree({ node, forceExpand }: { node: BookmarkNode; forceExpand: boolean }) {
  if (node.type === 'bookmark') {
    return (
      <a
        href={node.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderRadius: '12px',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          background: 'white',
          color: '#1f2937',
          transition: 'border 0.2s ease, transform 0.2s ease',
        }}
        onMouseEnter={(event) => {
          (event.currentTarget.style.transform = 'translateY(-1px) scale(1.01)');
          event.currentTarget.style.border = '1px solid rgba(59, 130, 246, 0.4)';
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.transform = 'none';
          event.currentTarget.style.border = '1px solid rgba(148, 163, 184, 0.3)';
        }}
      >
        <span style={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        <span style={{ fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
          {node.url}
        </span>
      </a>
    );
  }

  const childCount = countChildren(node);

  const detailProps = forceExpand
    ? { open: true }
    : {
        defaultOpen: (node.children?.length ?? 0) > 0,
      };

  return (
    <details {...detailProps} style={detailsStyle}>
      <summary style={summaryStyle}>
        <span style={{ fontWeight: 600 }}>{node.name}</span>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>目录 {childCount.folders} / 书签 {childCount.bookmarks}</span>
      </summary>
      <div style={{ display: 'grid', gap: '12px', paddingLeft: '12px' }}>
        {node.children?.map((child) => (
          <Tree key={child.id} node={child} forceExpand={forceExpand} />
        ))}
      </div>
    </details>
  );
}

function countChildren(node: BookmarkNode): { folders: number; bookmarks: number } {
  if (node.type === 'bookmark') {
    return { folders: 0, bookmarks: 1 };
  }
  return (node.children ?? []).reduce(
    (acc, child) => {
      const result = countChildren(child);
      return {
        folders: acc.folders + result.folders + (child.type === 'folder' ? 1 : 0),
        bookmarks: acc.bookmarks + result.bookmarks,
      };
    },
    { folders: 0, bookmarks: 0 },
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  width: '100%',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const searchInputStyle: React.CSSProperties = {
  flex: '1 1 260px',
  padding: '12px 16px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'white',
  fontSize: '15px',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  padding: '32px',
  textAlign: 'center',
  color: '#6b7280',
  background: 'rgba(255, 255, 255, 0.7)',
  borderRadius: '18px',
};

const treeContainerStyle: React.CSSProperties = {
  display: 'grid',
  gap: '14px',
};

const detailsStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.9)',
  borderRadius: '16px',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  padding: '10px 14px 14px',
};

const summaryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  listStyle: 'none',
  cursor: 'pointer',
  userSelect: 'none',
};
