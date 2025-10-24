# SaaS 书签导航平台

新版导航站支持在线注册登录、上传浏览器书签、生成专属导航站并通过分享链接公开访问。所有数据都会以 JSON 形式保存到 Supabase，确保安全可靠。

## 功能总览

- 🔐 **用户认证**：基于 Supabase Auth，支持邮箱注册和密码登录。
- 📥 **书签导入**：在仪表盘上传浏览器导出的 HTML 书签（Netscape 格式），自动解析为规范 JSON。
- 💾 **云端存储**：解析后的书签树以 JSON 存储在 Supabase `bookmark_collections` 表中。
- 🌐 **导航分享**：为每位用户生成唯一的 `/share/<slug>` 链接，外部访客可直接访问最新导航站。
- 🔍 **导航体验**：提供目录树与搜索功能，实时预览及分享页使用同一套 UI 组件。

## 技术栈

- [Next.js 14](https://nextjs.org/)（App Router + TypeScript）
- [React 18](https://react.dev/)
- [Supabase](https://supabase.com/) JavaScript SDK（Auth & Database）
- [htmlparser2](https://github.com/fb55/htmlparser2)（解析 Netscape Bookmark HTML）

## 快速开始

1. 安装依赖
   ```bash
   npm install
   ```

2. 配置环境变量：在项目根目录创建 `.env.local`，内容示例：
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```

   - `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 会在浏览器端使用。
   - `SUPABASE_SERVICE_ROLE_KEY` 仅在服务端 API 中使用，用于写入/读取受 RLS 保护的数据。

3. 初始化数据库表（SQL 示例）
   ```sql
   create table if not exists public.bookmark_collections (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users (id) on delete cascade,
     data jsonb not null,
     share_slug text unique not null,
     title text,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );

   create unique index if not exists bookmark_collections_user_id_idx
     on public.bookmark_collections (user_id);

   -- RLS 策略
   alter table public.bookmark_collections enable row level security;

   create policy "Users can manage their own bookmarks" on public.bookmark_collections
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

4. 本地运行
   ```bash
   npm run dev
   ```
   打开浏览器访问 `http://localhost:3000`。

## 使用流程

1. 注册并登录账号。
2. 在仪表盘上传浏览器导出的书签 HTML 文件（Chrome/Edge/Brave 等均为 Netscape 格式）。
3. 系统会解析书签树、保存至 Supabase，并生成分享链接。
4. 复制分享链接（`/share/<slug>`）即可让他人直接浏览你的导航站。
5. 如需刷新分享令牌，可在仪表盘点击“重新生成”。

## 目录结构

```
.
├── app/                      # Next.js App Router 页面 & API
│   ├── (auth)/               # 登录 / 注册页面
│   ├── api/                  # 书签导入 & 分享 API 路由
│   ├── dashboard/            # 受保护的用户仪表盘
│   ├── share/[slug]/         # 公开分享页
│   └── page.tsx              # 登陆页入口
├── components/               # 前端 UI 组件
├── lib/                      # 书签解析、Supabase 客户端、工具函数
├── scripts/                  # 旧版 CLI 工具（仍可单独使用）
├── web/                      # 旧版静态模板（保留供参考）
├── package.json
└── README.md
```

> 注：仓库中保留了早期的 Python CLI 和静态模板，若需要纯离线使用仍可执行 `python3 scripts/bookmarks_cli.py` 相关命令。

## 常见问题

- **上传书签时报错 “书签解析失败”？**
  - 请确认文件为浏览器导出的 HTML 格式，且未被其它编辑器转换编码。
- **分享页访问 404？**
  - 确认已完成首次书签导入；若仍无效，可在仪表盘使用“重新生成”刷新分享链接。
- **想要扩展数据结构？**
  - `lib/bookmarks/types.ts` 中定义了书签的类型，可在此基础上添加字段并同步更新 Supabase 表结构及 RLS 策略。

祝使用愉快 🎉
