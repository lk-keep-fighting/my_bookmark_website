import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 24px" }}>
      <section
        style={{
          width: "min(960px, 100%)",
          background: "#ffffffb3",
          borderRadius: "28px",
          padding: "48px 56px",
          boxShadow: "0 30px 60px rgba(31, 41, 55, 0.08)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          <header style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <span style={{ fontWeight: 600, color: "#3b82f6" }}>Bookmark SaaS</span>
            <h1 style={{ margin: 0, fontSize: "40px", lineHeight: 1.2 }}>将浏览器书签秒变可分享的导航站</h1>
            <p style={{ margin: 0, color: "#4b5563", fontSize: "18px", lineHeight: 1.6 }}>
              上传浏览器导出的 HTML 书签文件，自动生成可搜索、可分享的专属导航站，并安全存储在 Supabase。支持一键生成分享链接，邀请好友或团队随时访问。
            </p>
          </header>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <Link
              href="/register"
              style={{
                padding: "14px 28px",
                borderRadius: "999px",
                background: "linear-gradient(135deg, #60a5fa, #22d3ee)",
                color: "white",
                fontWeight: 600,
                boxShadow: "0 10px 30px rgba(96, 165, 250, 0.35)",
              }}
            >
              免费注册
            </Link>
            <Link
              href="/login"
              style={{
                padding: "14px 28px",
                borderRadius: "999px",
                background: "white",
                color: "#2563eb",
                fontWeight: 600,
                border: "1px solid rgba(37, 99, 235, 0.2)",
              }}
            >
              已有账号？登录
            </Link>
          </div>

          <section style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {[
              {
                title: "几秒完成导入",
                description: "支持 Chrome、Edge、Brave 等浏览器导出格式，拖拽 HTML 即刻解析。",
              },
              {
                title: "Supabase 安全存储",
                description: "数据自动保存至 Supabase JSON 列，可扩展至团队协作使用。",
              },
              {
                title: "一键分享链接",
                description: "为导航站生成独立分享链接，公开访问无需登录。",
              },
              {
                title: "实时可视化导航",
                description: "内置目录树与搜索体验，随时预览最新导航站。",
              },
            ].map((feature) => (
              <article
                key={feature.title}
                style={{
                  padding: "18px 22px",
                  borderRadius: "18px",
                  background: "linear-gradient(135deg, rgba(96, 165, 250, 0.12), rgba(125, 211, 252, 0.08))",
                  border: "1px solid rgba(96, 165, 250, 0.2)",
                }}
              >
                <h3 style={{ margin: "0 0 8px 0", fontSize: "18px" }}>{feature.title}</h3>
                <p style={{ margin: 0, color: "#4b5563", fontSize: "15px", lineHeight: 1.5 }}>{feature.description}</p>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
