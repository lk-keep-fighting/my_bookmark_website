'use client';

import { useRef, useState } from 'react';
import type React from 'react';
import type { BookmarkDocument } from '@/lib/bookmarks';

export interface ImportResult {
  document: BookmarkDocument;
  shareSlug: string;
  updatedAt: string;
}

interface BookmarkImportFormProps {
  onImported: (result: ImportResult) => void;
}

export function BookmarkImportForm({ onImported }: BookmarkImportFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('请选择浏览器导出的 HTML 书签文件');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/bookmarks/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.error ?? `导入失败（${response.status}）`;
        throw new Error(message);
      }

      const payload = (await response.json()) as ImportResult;
      onImported(payload);
      setSuccessMessage('导入成功，导航站已更新');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请稍后再试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <div>
        <label style={labelStyle}>导入浏览器书签（HTML）</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="text/html,.html"
          style={fileInputStyle}
          disabled={isSubmitting}
        />
        <p style={helpTextStyle}>支持 Chrome / Edge / Brave 等浏览器导出的 Netscape Bookmark HTML 文件。</p>
      </div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <button type="submit" disabled={isSubmitting} style={submitButtonStyle}>
          {isSubmitting ? '导入中…' : '上传并生成导航'}
        </button>
        {successMessage && <span style={successStyle}>{successMessage}</span>}
        {error && <span style={errorStyle}>{error}</span>}
      </div>
    </form>
  );
}

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  padding: '22px',
  borderRadius: '18px',
  background: 'rgba(255, 255, 255, 0.85)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: 600,
  marginBottom: '8px',
};

const fileInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: '12px',
  border: '1px dashed rgba(59, 130, 246, 0.6)',
  background: 'rgba(37, 99, 235, 0.04)',
};

const helpTextStyle: React.CSSProperties = {
  marginTop: '8px',
  fontSize: '13px',
  color: '#64748b',
};

const submitButtonStyle: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(135deg, #3b82f6, #22d3ee)',
  color: 'white',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '14px',
};

const successStyle: React.CSSProperties = {
  color: '#059669',
  fontSize: '14px',
};
