# 本地书签导航站

一个用于解析本地浏览器书签并生成可搜索、可编辑导航站点的工具集。

功能概览：

1. **获取书签数据**：支持一条命令从 Chromium 内核浏览器抓取书签文件，或将浏览器书签手动导出到项目目录。
2. **解析与转换**：将浏览器书签（`Bookmarks` JSON 或 Netscape HTML 导出文件）转换为结构规整的 `bookmarks.json`。
3. **生成网页导航**：基于 JSON 数据生成带搜索、高亮、顺序调整能力的本地网页导航站。
4. **快速更新**：在网页中调整目录/书签顺序后，可复制或下载新的 JSON 文件，一键覆盖旧数据完成导航站更新。

## 快速开始

确保本地已安装 **Python 3.8+**。

```bash
cd /path/to/my_bookmark_website
python3 scripts/bookmarks_cli.py --help
```

```
usage: bookmarks_cli.py [-h] {gather,convert,build-site} ...

Parse browser bookmarks and generate a searchable navigation site.

positional arguments:
  {gather,convert,build-site}
    gather              Locate and copy a Chromium-based browser's bookmark database
    convert             Convert an exported bookmark file into the canonical JSON format
    build-site          Generate / refresh the static navigation site using the provided bookmark file
```

## 1. 获取浏览器书签

### 方案 A：一键复制浏览器书签数据库

目前支持 Chromium 内核浏览器（Chrome / Chromium / Edge / Brave / Vivaldi）。

```bash
# 以 Chrome 默认用户为例
python3 scripts/bookmarks_cli.py gather chrome

# 指定非默认 Profile，例如 "Profile 2"
python3 scripts/bookmarks_cli.py gather chrome --profile "Profile 2"
```

命令会自动将浏览器 `Bookmarks` 文件复制到 `data/raw/` 目录中。

### 方案 B：手动导出书签

在浏览器中导出书签为 HTML 文件，并放置到项目的 `data/` 目录，例如 `data/bookmarks.html`。

## 2. 解析并生成标准 JSON

```bash
python3 scripts/bookmarks_cli.py convert data/bookmarks.html --output data/bookmarks.json
```

- 输入文件既可以是浏览器原生的 `Bookmarks` JSON，也可以是 HTML 导出文件。
- 也支持将先前生成的 `bookmarks.json` 作为输入，便于在原有数据基础上继续调整。
- 输出的 `bookmarks.json` 为本项目统一的数据结构，`web/` 目录下已附带示例。

若希望同时刷新静态站点，可直接指定 `--site-dir`（默认使用仓库的 `web/` 模板）：

```bash
python3 scripts/bookmarks_cli.py convert data/bookmarks.html --site-dir dist
```

执行后会在 `dist/` 目录写入：

- `index.html`、`app.js`、`styles.css` 等静态资源
- 最新的 `bookmarks.json`

## 3. 预览与部署导航站

1. 使用任意静态资源服务器打开 `dist/` 或 `web/` 目录，例如：
   ```bash
   python3 -m http.server --directory dist 5173
   ```
2. 浏览器访问 `http://localhost:5173` 即可预览导航站。

导航站特性：

- 顶部搜索框支持按名称／链接模糊匹配
- 支持折叠目录、统计目录与书签数量
- 在无搜索时可使用每项右侧的“↑/↓”按钮调整顺序
- 右上角提供“恢复初始排序”、“复制 JSON”、“下载 JSON”操作

完成调整后，可直接复制或下载新的 `bookmarks.json`，覆盖原目录下同名文件即可完成部署更新。

## 目录结构

```
.
├── scripts/
│   └── bookmarks_cli.py      # 主命令行工具
├── web/
│   ├── index.html            # 导航站模板（附示例数据）
│   ├── styles.css
│   ├── app.js
│   └── bookmarks.json        # 示例书签数据
├── data/                     # 建议存放书签源文件与输出 JSON
└── README.md
```

## 常见问题

- **执行 `gather` 时提示文件不存在？**
  - 请确认浏览器已完全退出，并核对 `--profile` 名称是否正确（如 `Default`、`Profile 1`）。
  - 若仍无法定位，可改用手动导出书签的方式。

- **如何支持其他浏览器？**
  - 若浏览器支持导出为 HTML，直接放入 `convert` 命令即可。
  - 若为其他数据格式，可自行在 `scripts/bookmarks_cli.py` 中补充解析逻辑。

- **如何在网页中看到最新数据？**
  - 重新执行 `convert --site-dir` 命令，或手动替换运行目录下的 `bookmarks.json`。

- **导航页可以部署在哪里？**
  - 所有资源均为纯静态文件，可直接部署到任意静态托管平台（GitHub Pages、Vercel、Netlify 等）。

祝使用愉快 🎉
