'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import {
  collectFolderOptions,
  formatFolderTrail,
  type BookmarkDocument,
  type FolderOption,
} from '@/lib/bookmarks';
import { formatDate } from '@/lib/utils';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { type ShareSiteSummary } from '@/lib/share-sites';
import { BookmarkImportForm, type ImportResult } from './import-form';
import { NavigationViewer } from './navigation-viewer';

interface DashboardShellProps {
  email: string;
  initialDocument: BookmarkDocument | null;
  initialShareSites: ShareSiteSummary[];
  initialUpdatedAt: string | null;
  initialSiteTitle: string | null;
}

export function DashboardShell({
  email,
  initialDocument,
  initialShareSites,
  initialUpdatedAt,
  initialSiteTitle,
}: DashboardShellProps) {
  const [document, setDocument] = useState<BookmarkDocument | null>(initialDocument);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [shareSites, setShareSites] = useState<ShareSiteSummary[]>(initialShareSites);
  const [shareSitesMessage, setShareSitesMessage] = useState<string | null>(null);
  const [shareSitesError, setShareSitesError] = useState<string | null>(null);
  const [isRefreshingShareSites, setIsRefreshingShareSites] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareModalName, setShareModalName] = useState('');
  const [shareModalFolderIds, setShareModalFolderIds] = useState<string[]>([]);
  const [shareModalError, setShareModalError] = useState<string | null>(null);
  const [isSavingShareSite, setIsSavingShareSite] = useState(false);
  const [editingShareSiteId, setEditingShareSiteId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const normalizedUserEmail = email.trim();
  const initialSiteTitleValue = (() => {
    const fromProp = initialSiteTitle?.trim();
    if (fromProp) return fromProp;
    const fromMetadata = initialDocument?.metadata?.siteTitle?.trim();
    if (fromMetadata) return fromMetadata;
    const fromRoot = initialDocument?.root?.name?.trim();
    if (fromRoot) return fromRoot;
    return '我的导航站';
  })();
  const initialContactEmailValue = (() => {
    const fromMetadata = initialDocument?.metadata?.contactEmail?.trim();
    if (fromMetadata) return fromMetadata;
    if (normalizedUserEmail) return normalizedUserEmail;
    return '';
  })();

  const [siteTitle, setSiteTitle] = useState<string>(initialSiteTitleValue);
  const [contactEmail, setContactEmail] = useState<string>(initialContactEmailValue);
  const [persistedSiteTitle, setPersistedSiteTitle] = useState<string>(initialSiteTitleValue);
  const [persistedContactEmail, setPersistedContactEmail] = useState<string>(initialContactEmailValue);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const folderOptions = useMemo<FolderOption[]>(() => collectFolderOptions(document), [document]);
  const folderPathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of folderOptions) {
      map.set(option.id, formatFolderTrail(option.trail));
    }
    return map;
  }, [folderOptions]);

  useEffect(() => {
    if (!shareSitesMessage || typeof window === 'undefined') {
      return;
    }
    const timer = window.setTimeout(() => setShareSitesMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [shareSitesMessage]);

  useEffect(() => {
    if (!shareSitesError || typeof window === 'undefined') {
      return;
    }
    const timer = window.setTimeout(() => setShareSitesError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [shareSitesError]);

  const trimmedSiteTitle = siteTitle.trim();
  const trimmedPersistedSiteTitle = persistedSiteTitle.trim();
  const trimmedContactEmail = contactEmail.trim();
  const trimmedPersistedContactEmail = persistedContactEmail.trim();
  const settingsDirty =
    trimmedSiteTitle !== trimmedPersistedSiteTitle || trimmedContactEmail !== trimmedPersistedContactEmail;
  const settingsDisabled = !settingsDirty || isSavingSettings;

  const refreshShareSites = useCallback(async () => {
    setIsRefreshingShareSites(true);
    setShareSitesError(null);
    try {
      const response = await fetch('/api/share-sites');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === 'string' ? payload.error : `加载分享站失败（${response.status}）`;
        throw new Error(message);
      }
      const payload = (await response.json()) as { items?: ShareSiteSummary[] };
      const items = Array.isArray(payload.items) ? payload.items : [];
      setShareSites(items);
    } catch (error) {
      setShareSitesError(error instanceof Error ? error.message : '加载分享站失败，请稍后再试');
    } finally {
      setIsRefreshingShareSites(false);
    }
  }, []);

  const handleImported = (result: ImportResult) => {
    setDocument(result.document);
    setUpdatedAt(result.updatedAt);
    setIsDirty(false);
    setSaveMessage('书签数据已更新，可以开始整理顺序');
    setSaveError(null);
    setShareSitesMessage('导航站已同步，请按需创建或更新分享站');
    setShareSitesError(null);
    void refreshShareSites();

    const importedSiteTitle = result.document.metadata?.siteTitle?.trim() ?? result.document.root?.name?.trim() ?? '';
    const importedContactEmail = result.document.metadata?.contactEmail?.trim() ?? '';
    const nextSiteTitle = importedSiteTitle || trimmedSiteTitle || initialSiteTitleValue;
    const nextContactEmail = importedContactEmail || trimmedPersistedContactEmail;

    setSiteTitle(nextSiteTitle);
    setPersistedSiteTitle(nextSiteTitle);
    setContactEmail(nextContactEmail);
    setPersistedContactEmail(nextContactEmail);
    setSettingsMessage(null);
    setSettingsError(null);
  };

  const handleDocumentChange = (nextDocument: BookmarkDocument) => {
    setDocument(nextDocument);
    setIsDirty(true);
    setSaveMessage(null);
    setSaveError(null);
  };

  const handleSaveDocument = async () => {
    if (!document || isSavingDocument) return;
    setIsSavingDocument(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const response = await fetch('/api/bookmarks/document', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document }),
      });
      let payload: Record<string, unknown> = {};
      try {
        payload = await response.json();
      } catch (error) {
        payload = {};
      }
      if (!response.ok) {
        const message = typeof payload.error === 'string' ? payload.error : `保存导航站失败（${response.status}）`;
        throw new Error(message);
      }
      if (typeof payload.updatedAt === 'string') {
        setUpdatedAt(payload.updatedAt);
      }
      setIsDirty(false);
      setSaveMessage('排序已保存，分享页面已同步更新');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后再试');
    } finally {
      setIsSavingDocument(false);
    }
  };

  const handleSaveSettings = async () => {
    if (settingsDisabled) {
      return;
    }
    setIsSavingSettings(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      const response = await fetch('/api/bookmarks/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ siteTitle, contactEmail }),
      });
      let payload: Record<string, unknown> = {};
      try {
        payload = await response.json();
      } catch (error) {
        payload = {};
      }
      if (!response.ok) {
        const message = typeof payload.error === 'string' ? payload.error : `保存站点信息失败（${response.status}）`;
        throw new Error(message);
      }
      const nextTitle = typeof payload.siteTitle === 'string' ? payload.siteTitle : '';
      const nextEmail = typeof payload.contactEmail === 'string' ? payload.contactEmail : '';
      if (typeof payload.updatedAt === 'string') {
        setUpdatedAt(payload.updatedAt);
      }
      setPersistedSiteTitle(nextTitle);
      setPersistedContactEmail(nextEmail);
      setSiteTitle(nextTitle);
      setContactEmail(nextEmail);
      setSettingsMessage('站点信息已保存');
      setDocument((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          metadata: {
            ...previous.metadata,
            siteTitle: nextTitle || null,
            contactEmail: nextEmail || null,
          },
        };
      });
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '保存站点信息失败，请稍后再试');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleOpenCreateShareSite = () => {
    if (!document) {
      setShareSitesError('请先导入书签后再创建分享站');
      return;
    }
    if (folderOptions.length === 0) {
      setShareSitesError('当前书签暂无可分享目录');
      return;
    }
    const defaultFolderId = folderOptions[0]?.id ?? null;
    setEditingShareSiteId(null);
    setShareModalName('');
    setShareModalFolderIds(defaultFolderId ? [defaultFolderId] : []);
    setShareModalError(null);
    setIsShareModalOpen(true);
  };

  const handleOpenEditShareSite = (site: ShareSiteSummary) => {
    setEditingShareSiteId(site.id);
    setShareModalName(site.name);
    const availableIds = site.folderIds.filter((id) => folderPathMap.has(id));
    const fallbackId = folderOptions[0]?.id ?? null;
    setShareModalFolderIds(availableIds.length > 0 ? availableIds : fallbackId ? [fallbackId] : []);
    setShareModalError(null);
    setIsShareModalOpen(true);
  };

  const handleCloseShareModal = () => {
    if (isSavingShareSite) {
      return;
    }
    setIsShareModalOpen(false);
    setShareModalName('');
    setShareModalFolderIds([]);
    setShareModalError(null);
    setEditingShareSiteId(null);
  };

  const handleSubmitShareSite = async () => {
    if (!document) {
      setShareModalError('请先导入书签后再创建分享站');
      return;
    }
    const trimmedName = shareModalName.trim();
    if (!trimmedName) {
      setShareModalError('请输入分享站名称');
      return;
    }
    if (shareModalFolderIds.length === 0) {
      setShareModalError('请选择至少一个目录');
      return;
    }
    setIsSavingShareSite(true);
    setShareModalError(null);
    try {
      const response = await fetch(
        editingShareSiteId ? `/api/share-sites/${editingShareSiteId}` : '/api/share-sites',
        {
          method: editingShareSiteId ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: trimmedName, folderIds: shareModalFolderIds }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof payload.error === 'string'
            ? payload.error
            : `${editingShareSiteId ? '更新' : '创建'}分享站失败（${response.status}）`;
        throw new Error(message);
      }
      setShareSitesMessage(editingShareSiteId ? '分享站已更新' : '分享站创建成功');
      setShareSitesError(null);
      setIsShareModalOpen(false);
      setShareModalName('');
      setShareModalFolderIds([]);
      setEditingShareSiteId(null);
      await refreshShareSites();
    } catch (error) {
      setShareModalError(error instanceof Error ? error.message : '保存失败，请稍后再试');
    } finally {
      setIsSavingShareSite(false);
    }
  };

  const handleDeleteShareSite = async (site: ShareSiteSummary) => {
    const confirmed =
      typeof window === 'undefined' ? true : window.confirm(`确定删除分享站“${site.name}”吗？`);
    if (!confirmed) {
      return;
    }
    try {
      const response = await fetch(`/api/share-sites/${site.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload.error === 'string' ? payload.error : `删除分享站失败（${response.status}）`;
        throw new Error(message);
      }
      setShareSitesMessage('分享站已删除');
      setShareSitesError(null);
      await refreshShareSites();
    } catch (error) {
      setShareSitesError(error instanceof Error ? error.message : '删除失败，请稍后再试');
    }
  };

  const handleCopyShareLink = async (site: ShareSiteSummary) => {
    const shareUrl = origin ? `${origin}/share/${site.shareSlug}` : '';
    if (!shareUrl) {
      setShareSitesError('链接暂不可用，请稍后重试');
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(shareUrl);
        setShareSitesMessage('分享链接已复制');
        setShareSitesError(null);
        return;
      }
      if (typeof window !== 'undefined') {
        const result = window.prompt('请复制分享链接', shareUrl);
        if (result !== null) {
          setShareSitesMessage('已生成分享链接');
          setShareSitesError(null);
        }
        return;
      }
      setShareSitesError('请在浏览器中复制分享链接');
    } catch (error) {
      setShareSitesError(error instanceof Error ? error.message : '复制失败，请手动复制链接');
    }
  };

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const saveDisabled = !document || !isDirty || isSavingDocument;
  const viewerHeader = updatedAt
    ? (
        <div style={viewerHeaderInfoStyle}>最近保存：{formatDate(updatedAt)}</div>
      )
    : undefined;

  const getShareUrl = useCallback(
    (slug: string) => (origin ? `${origin}/share/${slug}` : `/share/${slug}`),
    [origin],
  );

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

        <section style={siteSettingsCardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '20px' }}>站点信息</h2>
            <p style={settingsDescriptionStyle}>自定义导航站标题和联系邮箱，它们会展示在导航站左上角。</p>
          </div>
          <div style={settingsFieldsStyle}>
            <div style={settingsFieldStackStyle}>
              <label htmlFor="site-title-input" style={settingsLabelStyle}>
                导航标题
              </label>
              <input
                id="site-title-input"
                value={siteTitle}
                onChange={(event) => {
                  setSiteTitle(event.target.value);
                  setSettingsMessage(null);
                  setSettingsError(null);
                }}
                placeholder="请输入导航站标题"
                style={settingsInputStyle}
              />
            </div>
            <div style={settingsFieldStackStyle}>
              <label htmlFor="contact-email-input" style={settingsLabelStyle}>
                联系邮箱（可选）
              </label>
              <input
                id="contact-email-input"
                type="email"
                value={contactEmail}
                onChange={(event) => {
                  setContactEmail(event.target.value);
                  setSettingsMessage(null);
                  setSettingsError(null);
                }}
                placeholder="对外展示的联系邮箱"
                style={settingsInputStyle}
              />
              <p style={settingsHintStyle}>留一个邮箱地址，方便团队成员或访客与你取得联系。</p>
            </div>
          </div>
          <div style={settingsActionRowStyle}>
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={settingsDisabled}
              style={{
                ...settingsSaveButtonStyle,
                opacity: settingsDisabled ? 0.6 : 1,
                cursor: settingsDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {isSavingSettings ? '保存中…' : '保存站点信息'}
            </button>
            {settingsMessage && <span style={successStyle}>{settingsMessage}</span>}
            {settingsError && <span style={errorStyle}>{settingsError}</span>}
          </div>
        </section>

        <section style={shareCardStyle}>
          <div style={shareCardHeaderRowStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h2 style={{ margin: 0, fontSize: '20px' }}>分享站管理</h2>
              <p style={shareCardDescriptionStyle}>为不同目录生成独立的分享站链接，按团队或主题灵活分享。</p>
            </div>
            <button
              type="button"
              onClick={handleOpenCreateShareSite}
              disabled={!document || folderOptions.length === 0}
              style={{
                ...shareCreateButtonStyle,
                opacity: !document || folderOptions.length === 0 ? 0.6 : 1,
                cursor: !document || folderOptions.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              创建分享站
            </button>
          </div>
          {(isRefreshingShareSites || shareSitesMessage || shareSitesError) && (
            <div style={shareStatusRowStyle}>
              {isRefreshingShareSites && <span style={shareLoadingStyle}>列表同步中…</span>}
              {shareSitesMessage && <span style={successStyle}>{shareSitesMessage}</span>}
              {shareSitesError && <span style={errorStyle}>{shareSitesError}</span>}
            </div>
          )}
          {shareSites.length > 0 ? (
            <div style={shareListStyle}>
              {shareSites.map((site) => {
                const shareUrl = getShareUrl(site.shareSlug);
                const folderBadges = site.folderIds.length > 0
                  ? site.folderIds.map((folderId) => {
                      const path = folderPathMap.get(folderId);
                      if (path) {
                        return (
                          <span key={folderId} style={shareSiteTrailChipStyle}>
                            {path}
                          </span>
                        );
                      }
                      return (
                        <span key={folderId} style={shareSiteTrailMissingChipStyle}>
                          目录已删除或不再存在
                        </span>
                      );
                    })
                  : [
                      <span key="empty" style={shareSiteTrailMissingChipStyle}>
                        未选择目录
                      </span>,
                    ];

                return (
                  <div key={site.id} style={shareListItemStyle}>
                    <div style={shareListItemHeaderStyle}>
                      <div style={shareListItemTitleStyle}>
                        <div style={shareSiteNameStyle}>{site.name}</div>
                        <div style={shareSiteTrailStyle}>{folderBadges}</div>
                      </div>
                      <div style={shareListItemActionsStyle}>
                        <button type="button" onClick={() => handleCopyShareLink(site)} style={shareActionButtonStyle}>
                          复制链接
                        </button>
                        <button type="button" onClick={() => handleOpenEditShareSite(site)} style={shareActionButtonStyle}>
                          编辑
                        </button>
                        <button type="button" onClick={() => handleDeleteShareSite(site)} style={shareDeleteButtonStyle}>
                          删除
                        </button>
                      </div>
                    </div>
                    <div style={shareListLinkRowStyle}>
                      <span style={shareListLinkLabelStyle}>链接：</span>
                      <span style={shareListLinkValueStyle}>{shareUrl}</span>
                    </div>
                    <div style={shareListMetaRowStyle}>
                      <span style={shareListMetaTextStyle}>最近更新：{formatDate(site.updatedAt)}</span>
                      <span style={shareListMetaDividerStyle} />
                      <span style={shareListMetaTextStyle}>创建时间：{formatDate(site.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={shareEmptyStateStyle}>
              <p style={shareEmptyTitleStyle}>暂未创建分享站</p>
              <p style={shareEmptyDescriptionStyle}>
                导入书签后，可为任意目录创建分享站链接，邀请团队成员一键访问。
              </p>
            </div>
          )}
        </section>

        <section style={previewSectionStyle}>
          <div style={previewHeaderStyle}>
            <h2 style={{ margin: 0, fontSize: '20px' }}>导航预览</h2>
            <div style={previewActionsStyle}>
              {saveMessage && <span style={successStyle}>{saveMessage}</span>}
              {saveError && <span style={errorStyle}>{saveError}</span>}
              <button
                type="button"
                onClick={handleSaveDocument}
                disabled={saveDisabled}
                style={{
                  ...primaryButtonStyle,
                  opacity: saveDisabled ? 0.55 : 1,
                  cursor: saveDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {isSavingDocument ? '保存中…' : '保存排序'}
              </button>
            </div>
          </div>

          <div style={viewerShellStyle}>
            <NavigationViewer
              document={document}
              emptyHint="暂未导入书签，上传 HTML 文件后即可预览导航站。"
              editable={Boolean(document)}
              onDocumentChange={handleDocumentChange}
              header={viewerHeader}
              siteTitle={trimmedSiteTitle || undefined}
              contactEmail={trimmedContactEmail || undefined}
            />
          </div>
        </section>
      </section>
      {isShareModalOpen && (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <div style={modalContentStyle}>
            <div style={modalHeaderStyle}>
              <h3 style={modalTitleStyle}>{editingShareSiteId ? '编辑分享站' : '创建分享站'}</h3>
              <button
                type="button"
                onClick={handleCloseShareModal}
                style={{
                  ...modalCloseButtonStyle,
                  opacity: isSavingShareSite ? 0.5 : 1,
                  cursor: isSavingShareSite ? 'not-allowed' : 'pointer',
                }}
                disabled={isSavingShareSite}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div style={modalBodyStyle}>
              <div style={modalFieldStyle}>
                <label htmlFor="share-site-name" style={modalLabelStyle}>
                  分享站名称
                </label>
                <input
                  id="share-site-name"
                  value={shareModalName}
                  onChange={(event) => {
                    setShareModalName(event.target.value);
                    setShareModalError(null);
                  }}
                  placeholder="如：设计团队资源 / 工具收藏"
                  style={modalInputStyle}
                  disabled={isSavingShareSite}
                />
              </div>
              <div style={modalFieldStyle}>
                <span style={modalLabelStyle}>选择要分享的目录（可多选）</span>
                {folderOptions.length > 0 ? (
                  <div style={modalFolderListStyle}>
                    {folderOptions.map((option, index) => {
                      const optionPath = formatFolderTrail(option.trail);
                      const isSelected = shareModalFolderIds.includes(option.id);
                      const isLast = index === folderOptions.length - 1;
                      return (
                        <label
                          key={option.id}
                          style={{
                            ...modalFolderOptionStyle,
                            paddingLeft: `${option.depth * 16 + 12}px`,
                            border: isSelected
                              ? '1px solid rgba(59, 130, 246, 0.45)'
                              : '1px solid rgba(148, 163, 184, 0.25)',
                            background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'white',
                            borderBottom: isLast ? 'none' : '1px solid rgba(226, 232, 240, 0.6)',
                          }}
                        >
                          <input
                            type="checkbox"
                            value={option.id}
                            checked={isSelected}
                            onChange={() => {
                              let nextSelection: string[] = [];
                              setShareModalFolderIds((previous) => {
                                let next: string[];
                                if (previous.includes(option.id)) {
                                  next = previous.filter((id) => id !== option.id);
                                } else {
                                  next = [...previous, option.id];
                                }
                                const orderedIds = folderOptions.map((item) => item.id);
                                nextSelection = orderedIds.filter((id) => next.includes(id));
                                return nextSelection;
                              });
                              setShareModalError(nextSelection.length === 0 ? '请选择至少一个目录' : null);
                            }}
                            disabled={isSavingShareSite}
                            style={modalFolderCheckboxStyle}
                          />
                          <div style={modalFolderInfoStyle}>
                            <span style={modalFolderNameStyle}>{optionPath}</span>
                            <span style={modalFolderCountStyle}>{option.directBookmarkCount} 个网页</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p style={modalEmptyHintStyle}>暂无可用目录，请先导入书签文件。</p>
                )}
              </div>
              {shareModalError && <span style={errorStyle}>{shareModalError}</span>}
            </div>
            <div style={modalFooterStyle}>
              <button
                type="button"
                onClick={handleCloseShareModal}
                style={modalSecondaryButtonStyle}
                disabled={isSavingShareSite}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmitShareSite}
                style={{
                  ...modalPrimaryButtonStyle,
                  opacity: isSavingShareSite || shareModalFolderIds.length === 0 ? 0.7 : 1,
                  cursor:
                    isSavingShareSite || shareModalFolderIds.length === 0 ? 'not-allowed' : 'pointer',
                }}
                disabled={isSavingShareSite || shareModalFolderIds.length === 0}
              >
                {isSavingShareSite ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 16px 80px',
};

const panelStyle: React.CSSProperties = {
  width: 'min(1180px, 100%)',
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

const siteSettingsCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  padding: '24px',
  borderRadius: '20px',
  background: 'rgba(255, 255, 255, 0.86)',
  border: '1px solid rgba(148, 163, 184, 0.35)',
};

const settingsDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#64748b',
};

const settingsFieldsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '16px',
};

const settingsFieldStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const settingsLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '14px',
  color: '#0f172a',
};

const settingsInputStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  fontSize: '14px',
  background: 'rgba(255, 255, 255, 0.95)',
};

const settingsHintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: '#94a3b8',
};

const settingsActionRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const settingsSaveButtonStyle: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(135deg, #2563eb, #22d3ee)',
  color: '#ffffff',
  fontWeight: 600,
  transition: 'transform 0.2s ease, opacity 0.2s ease',
};

const shareCardHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  flexWrap: 'wrap',
};

const shareCardDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#4b5563',
  maxWidth: '520px',
};

const shareCreateButtonStyle: React.CSSProperties = {
  padding: '10px 22px',
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(135deg, #2563eb, #22d3ee)',
  color: '#ffffff',
  fontWeight: 600,
  transition: 'transform 0.2s ease, opacity 0.2s ease',
};

const shareStatusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  fontSize: '13px',
};

const shareLoadingStyle: React.CSSProperties = {
  color: '#2563eb',
  fontWeight: 600,
};

const shareListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const shareListItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '18px',
  borderRadius: '16px',
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
};

const shareListItemHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
  flexWrap: 'wrap',
};

const shareListItemTitleStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  flex: '1 1 auto',
  minWidth: 0,
};

const shareSiteNameStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#0f172a',
};

const shareSiteTrailStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  fontSize: '13px',
  color: '#64748b',
};

const shareSiteTrailChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: '999px',
  background: 'rgba(59, 130, 246, 0.08)',
  border: '1px solid rgba(59, 130, 246, 0.25)',
  color: '#1d4ed8',
  fontSize: '12px',
  lineHeight: '18px',
};

const shareSiteTrailMissingChipStyle: React.CSSProperties = {
  ...shareSiteTrailChipStyle,
  background: 'rgba(248, 113, 113, 0.12)',
  border: '1px solid rgba(248, 113, 113, 0.35)',
  color: '#b91c1c',
};

const shareListItemActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
};

const shareActionButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '999px',
  border: '1px solid rgba(37, 99, 235, 0.4)',
  background: 'white',
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const shareDeleteButtonStyle: React.CSSProperties = {
  ...shareActionButtonStyle,
  border: '1px solid rgba(239, 68, 68, 0.4)',
  color: '#dc2626',
};

const shareListLinkRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
  fontSize: '13px',
  color: '#1f2937',
};

const shareListLinkLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#475569',
};

const shareListLinkValueStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  wordBreak: 'break-all',
};

const shareListMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
  fontSize: '12px',
  color: '#64748b',
};

const shareListMetaTextStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

const shareListMetaDividerStyle: React.CSSProperties = {
  width: '4px',
  height: '4px',
  borderRadius: '50%',
  background: 'rgba(203, 213, 225, 0.9)',
};

const shareEmptyStateStyle: React.CSSProperties = {
  padding: '24px',
  borderRadius: '16px',
  border: '1px dashed rgba(148, 163, 184, 0.4)',
  background: 'rgba(248, 250, 252, 0.7)',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const shareEmptyTitleStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  color: '#0f172a',
};

const shareEmptyDescriptionStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#64748b',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '24px',
  zIndex: 1000,
};

const modalContentStyle: React.CSSProperties = {
  width: 'min(640px, 100%)',
  maxHeight: '90vh',
  background: '#ffffff',
  borderRadius: '20px',
  boxShadow: '0 40px 80px rgba(15, 23, 42, 0.25)',
  display: 'flex',
  flexDirection: 'column',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  padding: '24px 28px 12px',
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '20px',
  fontWeight: 600,
  color: '#0f172a',
};

const modalCloseButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: '24px',
  lineHeight: 1,
  cursor: 'pointer',
  color: '#94a3b8',
};

const modalBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  padding: '0 28px 24px',
  overflowY: 'auto',
};

const modalFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const modalLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '14px',
  color: '#0f172a',
};

const modalInputStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  fontSize: '14px',
};

const modalFolderListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderRadius: '12px',
  border: '1px solid rgba(203, 213, 225, 0.6)',
  background: 'rgba(248, 250, 252, 0.6)',
  maxHeight: '280px',
  overflowY: 'auto',
};

const modalFolderOptionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 16px',
  borderBottom: '1px solid rgba(226, 232, 240, 0.6)',
  cursor: 'pointer',
};

const modalFolderCheckboxStyle: React.CSSProperties = {
  margin: 0,
};

const modalFolderInfoStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const modalFolderNameStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#1f2937',
  fontWeight: 500,
};

const modalFolderCountStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
};

const modalEmptyHintStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px 14px',
  borderRadius: '12px',
  background: 'rgba(254, 249, 195, 0.6)',
  border: '1px solid rgba(250, 204, 21, 0.4)',
  color: '#ca8a04',
  fontSize: '13px',
};

const modalFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  padding: '0 28px 24px',
};

const modalSecondaryButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'white',
  color: '#475569',
  fontWeight: 600,
  cursor: 'pointer',
};

const modalPrimaryButtonStyle: React.CSSProperties = {
  padding: '10px 22px',
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
  color: '#ffffff',
  fontWeight: 600,
  cursor: 'pointer',
};

const previewSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  minHeight: '640px',
};

const previewHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  flexWrap: 'wrap',
};

const previewActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
  color: '#ffffff',
  fontWeight: 600,
  transition: 'transform 0.2s ease, opacity 0.2s ease',
};

const viewerShellStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minHeight: '560px',
  display: 'flex',
};

const viewerHeaderInfoStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: '13px',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '14px',
};

const successStyle: React.CSSProperties = {
  color: '#16a34a',
  fontSize: '14px',
};
