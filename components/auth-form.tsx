'use client';

import { FormEvent, useState } from 'react';
import type React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

interface AuthFormProps {
  mode: 'login' | 'register';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submitLabel = mode === 'login' ? '登录' : '注册';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email || !password) {
      setError('请输入邮箱和密码');
      return;
    }

    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          throw signInError;
        }
        router.push('/dashboard');
        router.refresh();
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          throw signUpError;
        }
        setMessage('注册成功，请前往邮箱完成验证（如果已开启）或直接登录。');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败，请稍后再试';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'login' ? '欢迎回来' : '创建账号';
  const description =
    mode === 'login'
      ? '登录后导入书签并管理你的导航站。'
      : '注册账号即可在线保存书签导航并生成分享链接。';

  return (
    <main style={mainStyle}>
      <section style={cardStyle}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '28px' }}>{title}</h1>
          <p style={{ margin: 0, color: '#6b7280' }}>{description}</p>
        </header>
        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={labelStyle}>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={inputStyle}
              placeholder="name@example.com"
              required
            />
          </label>
          <label style={labelStyle}>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={inputStyle}
              placeholder="至少 6 位字符"
              required
            />
          </label>
          <button type="submit" style={submitButtonStyle} disabled={loading}>
            {loading ? `${submitLabel}中…` : submitLabel}
          </button>
          {error && <p style={errorStyle}>{error}</p>}
          {message && <p style={successStyle}>{message}</p>}
        </form>
        <footer style={{ textAlign: 'center', fontSize: '14px', color: '#6b7280' }}>
          {mode === 'login' ? (
            <span>
              还没有账号？<Link href="/register">立即注册</Link>
            </span>
          ) : (
            <span>
              已有账号？<Link href="/login">前往登录</Link>
            </span>
          )}
        </footer>
      </section>
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
  padding: '32px 16px',
};

const cardStyle: React.CSSProperties = {
  width: 'min(420px, 100%)',
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  background: 'rgba(255, 255, 255, 0.92)',
  borderRadius: '28px',
  padding: '32px 36px',
  boxShadow: '0 35px 60px rgba(15, 23, 42, 0.15)',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.5)',
  background: 'rgba(248, 250, 252, 0.9)',
};

const submitButtonStyle: React.CSSProperties = {
  marginTop: '8px',
  padding: '12px 24px',
  borderRadius: '999px',
  border: 'none',
  background: 'linear-gradient(135deg, #6366f1, #22d3ee)',
  color: 'white',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: '#dc2626',
  fontSize: '14px',
  textAlign: 'center',
};

const successStyle: React.CSSProperties = {
  margin: 0,
  color: '#16a34a',
  fontSize: '14px',
  textAlign: 'center',
};
