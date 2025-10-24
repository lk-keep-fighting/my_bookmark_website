'use client';

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import type { BookmarkDocument } from '@/lib/bookmarks';
import { formatDate } from '@/lib/utils';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { BookmarkImportForm, type ImportResult } from './import-form';
import { NavigationViewer } from './navigation-viewer';

interface DashboardShellProps {
  email: string;
  initialDocument: BookmarkDocument | null;
  initialShareSlug: string | null;
  initialUpdatedAt: string | null;
}

export function DashboardShell({
  email,
  initialDocument,
  initialShareSlug,
  initialUpdatedAt,
}: DashboardShellProps) {
  const [document, setDocument] = useState<BookmarkDocument | null>(initialDocument);
  const [shareSlug, setShareSlug] = useState<string | null>(initialShareSlug);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [origin, setOrigin] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const shareUrl = useMemo(() => {
    if (!shareSlug || !origin) return null;
    return `${origin}/share/${shareSlug}`;
  }, [origin, shareSlug]);

  const handleImported = (result: ImportResult) => {
    setDocument(result.document);
    setShareSlug(result.shareSlug);
    setUpdatedAt(result.updatedAt);
    setShareMessage('导航站已同步，可复制最新分享链接');
    setShareError(null);
  };

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const handleRegenerateShare = async () => {
    setIsRegenerating(true);
    setShareMessage(null);
    setShareError(null);
    try {
      const response = await fetch('/api/bookmarks/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'regenerate' }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.error ?? `生成分享链接失败（${response.status}）`;
        throw new Error(message);
      }
      const payload = (await response.json()) as { shareSlug: string; updatedAt: string };
      setShareSlug(payload.shareSlug);
      setUpdatedAt(payload.updatedAt);
      setShareMessage('成功生成新的分享链接');
    } catch (error) {
      setShareError(error instanceof Error ? error.message : '生成分享链接失败，请稍后再试');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <main style={mainStyle}>
      <section style={panelStyle}>
        <header style={headerStyle}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px' }}>我的导航站</h1>
            <p style={{ margin: '8px 0 0', color: '#6b7280' }}>已登录：{email}</p>
          </div>
          <button type="button" onClick={handleLogout} style={logoutButtonStyle}>
            退出登录
          </button>
        </header>

        <BookmarkImportForm onImported={handleImported} />

        <section style={shareCardStyle}>
          <h2 style={{ margin: '0 0 12px', fontSize: '20px' }}>分享链接</h2>
          {shareSlug ? (
            shareUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={shareUrlBoxStyle}>{shareUrl}</div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button type="button" onClick={handleRegenerateShare} disabled={isRegenerating} style={secondaryButtonStyle}>
                    {isRegenerating ? '生成中…' : '重新生成'}
                  </button>
                  {updatedAt && <span style={{ fontSize: '13px', color: '#6b7280' }}>最近更新：{formatDate(updatedAt)}</span>}
                  {shareMessage && <span style={successStyle}>{shareMessage}</span>}
                  {shareError && <span style={errorStyle}>{shareError}</span>}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: '#6b7280' }}>正在生成分享链接…</p>
            )
          ) : (
            <p style={{ margin: 0, color: '#6b7280' }}>导入书签后即可生成分享链接。</p>
          )}
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>实时预览</h2>
          <NavigationViewer document={document} />
        </section>
      </section>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 16px 80px',
};

const panelStyle: React.CSSProperties = {
  width: 'min(1080px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  background: 'rgba(255, 255, 255, 0.92)',
  borderRadius: '32px',
  padding: '36px 48px',
  boxShadow: '0 40px 80px rgba(15, 23, 42, 0.12)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  flexWrap: 'wrap',
};

const logoutButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '999px',
  border: '1px solid rgba(239, 68, 68, 0.4)',
  background: 'rgba(254, 226, 226, 0.6)',
  color: '#b91c1c',
  fontWeight: 600,
  cursor: 'pointer',
};

const shareCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '24px',
  borderRadius: '20px',
  background: 'linear-gradient(135deg, rgba(96, 165, 250, 0.18), rgba(125, 211, 252, 0.14))',
  border: '1px solid rgba(59, 130, 246, 0.25)',
};

const shareUrlBoxStyle: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: '14px',
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid rgba(148, 163, 184, 0.4)',
  fontFamily: 'monospace',
  fontSize: '14px',
  wordBreak: 'break-all',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '999px',
  border: '1px solid rgba(37, 99, 235, 0.4)',
  background: 'white',
  color: '#2563eb',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '14px',
};

const successStyle: React.CSSProperties = {
  color: '#16a34a',
  fontSize: '14px',
};
