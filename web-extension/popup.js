const DEFAULT_TABS_FOLDER_NAME = "当前打开的页面";
const DEFAULT_BASE_URL = "https://my-nav.ydtpt.com";
const SUPABASE_COOKIE_REGEX = /^sb-.*-auth-token$/;
const TREE_TOGGLE_SYMBOL = "▸";
const FOLDER_ICON = "📂";
const BOOKMARK_ICON = "🔗";

const state = {
  baseUrl: DEFAULT_BASE_URL,
  tabs: [],
  bookmarkTree: [],
  selectedBookmarkIds: new Set(),
  selectedTabIds: new Set(),
  expandedFolderIds: new Set(),
  isUploading: false,
  isLoadingBookmarks: false,
  isAuthenticated: null,
  bookmarksLoaded: false,
  bookmarksError: null,
  lastAccessToken: null,
  siteTitle: null,
  userEmail: null,
  hasBookmarkPermission: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  initialize().catch((error) => {
    console.error("初始化失败", error);
    setResultMessage(error instanceof Error ? error.message : "初始化失败", "error");
  });
});

async function initialize() {
  cacheElements();
  bindEvents();
  await loadBaseUrl();
  await refreshAll();
}

function cacheElements() {
  elements.baseUrlInput = document.getElementById("base-url-input");
  elements.saveBaseUrlButton = document.getElementById("save-base-url");
  elements.refreshButton = document.getElementById("refresh-button");
  elements.statusText = document.getElementById("status-text");
  elements.foldersContainer = document.getElementById("folders-container");
  elements.tabsContainer = document.getElementById("tabs-container");
  elements.shareNameInput = document.getElementById("share-name-input");
  elements.tabsFolderNameInput = document.getElementById("tabs-folder-name-input");
  elements.uploadButton = document.getElementById("upload-button");
  elements.resultMessage = document.getElementById("result-message");
  elements.foldersSelectAllButton = document.getElementById("folders-select-all");
  elements.foldersClearButton = document.getElementById("folders-clear");
  elements.tabsSelectAllButton = document.getElementById("tabs-select-all");
  elements.tabsClearButton = document.getElementById("tabs-clear");
  elements.bookmarksPermissionButton = document.getElementById("bookmarks-permission-button");
}

function bindEvents() {
  elements.saveBaseUrlButton.addEventListener("click", async () => {
    const sanitized = sanitizeBaseUrl(elements.baseUrlInput.value);
    if (!sanitized) {
      setResultMessage("请填写合法的导航站地址（需包含 http/https）", "error");
      return;
    }

    try {
      await storageSet({ baseUrl: sanitized });
      state.baseUrl = sanitized;
      state.lastAccessToken = null;
      elements.baseUrlInput.value = sanitized;
      setResultMessage("导航站地址已保存", "success");
      await refreshAll();
    } catch (error) {
      console.error("保存地址失败", error);
      setResultMessage("保存地址失败，请稍后再试", "error");
    }
  });

  elements.refreshButton.addEventListener("click", async () => {
    setResultMessage("", "info");
    await refreshAll();
  });

  elements.foldersSelectAllButton.addEventListener("click", () => {
    selectAllBookmarks();
  });

  elements.foldersClearButton.addEventListener("click", () => {
    clearBookmarkSelection();
  });

  elements.tabsSelectAllButton.addEventListener("click", () => {
    const shareableTabs = state.tabs.filter((tab) => isShareableTab(tab));
    state.selectedTabIds = new Set(shareableTabs.map((tab) => getTabId(tab)).filter(Boolean));
    renderTabsList();
    updateSubmitState();
  });

  elements.tabsClearButton.addEventListener("click", () => {
    state.selectedTabIds.clear();
    renderTabsList();
    updateSubmitState();
  });

  if (elements.bookmarksPermissionButton) {
    elements.bookmarksPermissionButton.addEventListener("click", async () => {
      await handleBookmarksPermissionRequest();
    });
  }

  elements.shareNameInput.addEventListener("input", () => {
    updateSubmitState();
  });

  elements.uploadButton.addEventListener("click", async () => {
    await handleUpload();
  });
}

async function loadBaseUrl() {
  const defaultSanitized = sanitizeBaseUrl(DEFAULT_BASE_URL);

  if (!defaultSanitized) {
    state.baseUrl = "";
    if (elements.baseUrlInput) {
      elements.baseUrlInput.value = "";
    }
    setResultMessage("导航站地址不可用", "error");
    return;
  }

  state.baseUrl = defaultSanitized;
  state.lastAccessToken = null;

  if (elements.baseUrlInput) {
    elements.baseUrlInput.value = defaultSanitized;
    elements.baseUrlInput.readOnly = true;
  }

  if (elements.saveBaseUrlButton) {
    elements.saveBaseUrlButton.disabled = true;
    elements.saveBaseUrlButton.style.display = "none";
  }

  try {
    const stored = await storageGet("baseUrl");
    const savedRaw = typeof stored === "string" ? stored : "";
    const savedSanitized = sanitizeBaseUrl(savedRaw);

    if (savedSanitized !== defaultSanitized) {
      await storageSet({ baseUrl: defaultSanitized });
    }
  } catch (error) {
    console.warn("同步导航站地址失败", error);
  }
}

async function refreshAll() {
  await refreshBookmarkTree();
  await refreshTabs();
  await refreshAuthState();
  ensureDefaultInputs();
  updateSubmitState();
}

async function refreshBookmarkTree() {
  state.isLoadingBookmarks = true;
  state.bookmarksError = null;
  state.bookmarksLoaded = false;
  renderBookmarkTree();
  updateStatusBanner();

  let hasPermission = false;
  try {
    hasPermission = await checkBookmarksPermission();
  } catch (error) {
    console.warn("检测书签权限失败", error);
    hasPermission = false;
  }

  state.hasBookmarkPermission = hasPermission;
  updateBookmarkPermissionButton();

  if (!hasPermission) {
    state.bookmarkTree = [];
    state.siteTitle = null;
    state.expandedFolderIds.clear();
    state.selectedBookmarkIds.clear();
    state.bookmarksLoaded = false;
    state.bookmarksError = "尚未授权访问浏览器书签，请点击下方按钮进行授权";
    state.isLoadingBookmarks = false;
    renderBookmarkTree();
    updateStatusBanner();
    updateSubmitState();
    return;
  }

  try {
    const rawTree = await getBookmarkTree();
    const normalized = normalizeBookmarkTree(rawTree);
    state.bookmarkTree = normalized;
    state.bookmarksLoaded = true;

    const allFolderIds = collectAllFolderIds(normalized);
    if (state.expandedFolderIds.size === 0) {
      state.expandedFolderIds = new Set(allFolderIds);
    } else {
      const retained = allFolderIds.filter((id) => state.expandedFolderIds.has(id));
      state.expandedFolderIds = new Set(retained.length > 0 ? retained : allFolderIds);
    }

    const availableBookmarkIds = new Set(collectAllBookmarkIds(normalized));
    const previousSelection = Array.from(state.selectedBookmarkIds);
    state.selectedBookmarkIds = new Set(previousSelection.filter((id) => availableBookmarkIds.has(id)));

    state.siteTitle = deriveSiteTitleFromBookmarks(normalized);

    renderBookmarkTree();
  } catch (error) {
    console.error("加载浏览器书签失败", error);
    state.bookmarkTree = [];
    state.siteTitle = null;
    state.expandedFolderIds.clear();
    state.selectedBookmarkIds.clear();
    state.bookmarksLoaded = false;
    const message = error instanceof Error ? error.message : "读取浏览器书签失败";
    state.bookmarksError = message;
    if (isBookmarksPermissionError(message)) {
      state.hasBookmarkPermission = false;
      updateBookmarkPermissionButton();
      state.bookmarksError = "未能读取浏览器书签，请点击下方按钮授权后重试";
    }
    renderBookmarkTree();
  } finally {
    state.isLoadingBookmarks = false;
    updateStatusBanner();
    updateSubmitState();
  }
}

async function refreshAuthState() {
  state.isAuthenticated = null;
  state.userEmail = null;
  updateStatusBanner();

  let headers = {};
  try {
    headers = await buildAuthHeaders();
  } catch (error) {
    console.warn("检测登录状态失败", error);
    state.isAuthenticated = false;
    state.userEmail = null;
    updateStatusBanner();
    updateSubmitState();
    return;
  }

  try {
    const { response, resolvedBaseUrl } = await fetchWithBaseFallback("/api/extension/context", {
      method: "GET",
      credentials: "include",
      headers,
    });

    if (typeof resolvedBaseUrl === "string" && resolvedBaseUrl && resolvedBaseUrl !== state.baseUrl) {
      await applyResolvedBaseUrl(resolvedBaseUrl);
    }

    const payload = await response.json().catch(() => null);

    if (response.status === 401) {
      state.isAuthenticated = false;
      state.userEmail = null;
      return;
    }

    if (!response.ok) {
      const message =
        payload && typeof payload.error === "string"
          ? payload.error
          : `检测登录状态失败（${response.status}）`;
      throw new Error(message);
    }

    state.isAuthenticated = true;
    state.userEmail = typeof payload?.userEmail === "string" ? payload.userEmail.trim() || null : null;

    if (payload && typeof payload.siteTitle === "string" && payload.siteTitle.trim()) {
      state.siteTitle = payload.siteTitle.trim();
    }
  } catch (error) {
    console.warn("检测登录状态失败", error);
    state.isAuthenticated = false;
    state.userEmail = null;
  } finally {
    updateStatusBanner();
    updateSubmitState();
  }
}

async function handleBookmarksPermissionRequest() {
  if (!elements.bookmarksPermissionButton) {
    return;
  }

  elements.bookmarksPermissionButton.disabled = true;

  try {
    const granted = await requestBookmarksPermission();
    if (granted) {
      state.hasBookmarkPermission = true;
      state.bookmarksError = null;
      updateBookmarkPermissionButton();
      setResultMessage("已获得浏览器书签访问权限", "success");
      await refreshBookmarkTree();
    } else {
      state.hasBookmarkPermission = false;
      state.bookmarkTree = [];
      state.bookmarksLoaded = false;
      state.bookmarksError = "尚未授权访问浏览器书签，请点击下方按钮进行授权";
      state.expandedFolderIds.clear();
      state.selectedBookmarkIds.clear();
      updateBookmarkPermissionButton();
      renderBookmarkTree();
      updateStatusBanner();
      setResultMessage("未获得浏览器书签访问权限", "error");
    }
  } catch (error) {
    console.error("申请书签权限失败", error);
    setResultMessage("申请书签权限失败，请稍后重试", "error");
  } finally {
    elements.bookmarksPermissionButton.disabled = false;
    updateSubmitState();
  }
}

async function checkBookmarksPermission() {
  if (typeof chrome === "undefined") {
    return false;
  }

  if (!chrome.permissions || typeof chrome.permissions.contains !== "function") {
    return true;
  }

  return new Promise((resolve) => {
    chrome.permissions.contains({ permissions: ["bookmarks"] }, (result) => {
      if (chrome.runtime.lastError) {
        console.warn("检测书签权限失败", chrome.runtime.lastError);
        resolve(false);
        return;
      }
      resolve(Boolean(result));
    });
  });
}

async function requestBookmarksPermission() {
  if (typeof chrome === "undefined" || !chrome.permissions || typeof chrome.permissions.request !== "function") {
    return false;
  }

  return new Promise((resolve) => {
    chrome.permissions.request({ permissions: ["bookmarks"] }, (granted) => {
      if (chrome.runtime.lastError) {
        console.warn("申请书签权限时出错", chrome.runtime.lastError);
        resolve(false);
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

function updateBookmarkPermissionButton() {
  if (!elements.bookmarksPermissionButton) {
    return;
  }

  if (state.hasBookmarkPermission === false) {
    elements.bookmarksPermissionButton.style.display = "";
  } else {
    elements.bookmarksPermissionButton.style.display = "none";
  }
}

function isBookmarksPermissionError(message) {
  if (typeof message !== "string") {
    return false;
  }
  const lower = message.toLowerCase();
  if (lower.includes("bookmark") && lower.includes("permission")) {
    return true;
  }
  return message.includes("权限") && message.includes("书签");
}

async function getBookmarkTree() {
  if (typeof chrome === "undefined" || !chrome.bookmarks || typeof chrome.bookmarks.getTree !== "function") {
    throw new Error("当前浏览器不支持读取书签或插件缺少书签权限");
  }

  return new Promise((resolve, reject) => {
    chrome.bookmarks.getTree((nodes) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "读取浏览器书签失败"));
        return;
      }
      resolve(Array.isArray(nodes) ? nodes : []);
    });
  });
}

function normalizeBookmarkTree(rawTree) {
  const roots = Array.isArray(rawTree) ? rawTree : [];
  const normalized = [];

  const mapNode = (node) => {
    if (!node || typeof node !== "object") {
      return null;
    }

    const idRaw = typeof node.id === "string" ? node.id : node.id != null ? String(node.id) : "";
    if (!idRaw) {
      return null;
    }

    const title = typeof node.title === "string" ? node.title : "";

    if (typeof node.url === "string" && node.url) {
      return {
        id: idRaw,
        title,
        type: "bookmark",
        url: node.url,
      };
    }

    const children = Array.isArray(node.children)
      ? node.children.map(mapNode).filter(Boolean)
      : [];

    return {
      id: idRaw,
      title,
      type: "folder",
      children,
    };
  };

  for (const root of roots) {
    if (Array.isArray(root.children)) {
      for (const child of root.children) {
        const mapped = mapNode(child);
        if (mapped) {
          normalized.push(mapped);
        }
      }
    } else {
      const mapped = mapNode(root);
      if (mapped) {
        normalized.push(mapped);
      }
    }
  }

  return normalized;
}

function renderBookmarkTree() {
  const container = elements.foldersContainer;
  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (state.isLoadingBookmarks) {
    appendEmptyHint(container, "正在加载浏览器书签…");
    return;
  }

  if (state.bookmarksError) {
    appendEmptyHint(container, state.bookmarksError);
    return;
  }

  if (!state.bookmarkTree.length) {
    appendEmptyHint(container, "未在浏览器中发现书签");
    return;
  }

  const fragment = document.createDocumentFragment();
  state.bookmarkTree.forEach((node) => {
    fragment.appendChild(createBookmarkNodeElement(node));
  });
  container.appendChild(fragment);
}

function createBookmarkNodeElement(node) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset.type = node.type;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.textContent = TREE_TOGGLE_SYMBOL;

  const hasChildren = node.type === "folder" && Array.isArray(node.children) && node.children.length > 0;
  if (hasChildren) {
    const isExpanded = state.expandedFolderIds.has(node.id);
    toggle.textContent = isExpanded ? "▾" : TREE_TOGGLE_SYMBOL;
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.setAttribute("aria-label", isExpanded ? "折叠目录" : "展开目录");
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.expandedFolderIds.has(node.id)) {
        state.expandedFolderIds.delete(node.id);
      } else {
        state.expandedFolderIds.add(node.id);
      }
      renderBookmarkTree();
    });
  } else {
    toggle.classList.add("hidden");
    toggle.textContent = "";
    toggle.disabled = true;
    toggle.setAttribute("aria-hidden", "true");
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";

  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.textContent = node.type === "folder" ? FOLDER_ICON : BOOKMARK_ICON;

  const content = document.createElement("div");
  content.className = "tree-content";

  const title = document.createElement("span");
  title.className = "tree-title";
  const displayTitle = (node.title || "").trim() || (node.type === "folder" ? "未命名目录" : "未命名书签");
  title.textContent = displayTitle;
  content.appendChild(title);

  if (node.type === "folder") {
    const desc = document.createElement("span");
    desc.className = "tree-desc";
    const bookmarkCount = countDescendantBookmarks(node);
    desc.textContent = bookmarkCount > 0 ? `${bookmarkCount} 个书签` : "空目录";
    content.appendChild(desc);
  } else if (node.url) {
    const desc = document.createElement("span");
    desc.className = "tree-desc";
    desc.textContent = node.url;
    content.appendChild(desc);
  }

  if (node.type === "bookmark") {
    const isSelected = state.selectedBookmarkIds.has(node.id);
    checkbox.checked = isSelected;
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedBookmarkIds.add(node.id);
      } else {
        state.selectedBookmarkIds.delete(node.id);
      }
      renderBookmarkTree();
      updateSubmitState();
    });
  } else {
    const descendantBookmarkIds = collectDescendantBookmarkIds(node);
    if (descendantBookmarkIds.length === 0) {
      checkbox.disabled = true;
    } else {
      const selectedCount = descendantBookmarkIds.reduce(
        (count, id) => (state.selectedBookmarkIds.has(id) ? count + 1 : count),
        0,
      );
      const allSelected = selectedCount === descendantBookmarkIds.length;
      const partiallySelected = selectedCount > 0 && !allSelected;
      checkbox.checked = allSelected;
      checkbox.indeterminate = partiallySelected;
      checkbox.addEventListener("change", (event) => {
        const shouldSelect = event.target.checked;
        descendantBookmarkIds.forEach((id) => {
          if (shouldSelect) {
            state.selectedBookmarkIds.add(id);
          } else {
            state.selectedBookmarkIds.delete(id);
          }
        });
        renderBookmarkTree();
        updateSubmitState();
      });
    }
  }

  row.appendChild(toggle);
  row.appendChild(checkbox);
  row.appendChild(icon);
  row.appendChild(content);
  wrapper.appendChild(row);

  if (node.type === "folder" && hasChildren && state.expandedFolderIds.has(node.id)) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "tree-children";
    node.children.forEach((child) => {
      childrenContainer.appendChild(createBookmarkNodeElement(child));
    });
    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

function selectAllBookmarks() {
  if (!state.bookmarkTree.length) {
    return;
  }
  const allBookmarkIds = collectAllBookmarkIds(state.bookmarkTree);
  state.selectedBookmarkIds = new Set(allBookmarkIds);
  renderBookmarkTree();
  updateSubmitState();
}

function clearBookmarkSelection() {
  state.selectedBookmarkIds.clear();
  renderBookmarkTree();
  updateSubmitState();
}

function collectAllBookmarkIds(nodes) {
  const result = [];
  const traverse = (node) => {
    if (!node) {
      return;
    }
    if (node.type === "bookmark") {
      result.push(node.id);
    } else if (node.type === "folder" && Array.isArray(node.children)) {
      node.children.forEach(traverse);
    }
  };

  nodes.forEach(traverse);
  return result;
}

function collectAllFolderIds(nodes) {
  const result = [];
  const traverse = (node) => {
    if (!node) {
      return;
    }
    if (node.type === "folder") {
      result.push(node.id);
      if (Array.isArray(node.children)) {
        node.children.forEach(traverse);
      }
    }
  };

  nodes.forEach(traverse);
  return result;
}

function collectSelectedBookmarks(nodes, selectedIds) {
  const results = [];
  const traverse = (node) => {
    if (!node) {
      return;
    }
    if (node.type === "bookmark" && node.url && selectedIds.has(node.id)) {
      results.push(node);
    }
    if (node.type === "folder" && Array.isArray(node.children)) {
      node.children.forEach(traverse);
    }
  };

  nodes.forEach(traverse);
  return results;
}

function collectDescendantBookmarkIds(node) {
  if (!node || node.type !== "folder") {
    return [];
  }

  const ids = [];
  const stack = Array.isArray(node.children) ? [...node.children] : [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.type === "bookmark") {
      ids.push(current.id);
    } else if (current.type === "folder" && Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return ids;
}

function countDescendantBookmarks(node) {
  return collectDescendantBookmarkIds(node).length;
}

function deriveSiteTitleFromBookmarks(nodes) {
  let fallback = null;

  const traverse = (node) => {
    if (!node || node.type !== "folder") {
      return null;
    }
    const trimmed = (node.title || "").trim();
    if (trimmed) {
      if (!fallback) {
        fallback = trimmed;
      }
      return trimmed;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const result = traverse(child);
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  for (const node of nodes) {
    const result = traverse(node);
    if (result) {
      return result;
    }
  }

  return fallback;
}

async function refreshTabs() {
  try {
    const tabs = await queryCurrentWindowTabs();
    state.tabs = tabs.filter((tab) => isShareableTab(tab));

    if (state.selectedTabIds.size === 0 && state.tabs.length > 0) {
      state.selectedTabIds = new Set(state.tabs.map((tab) => getTabId(tab)).filter(Boolean));
    } else {
      const previous = new Set(state.selectedTabIds);
      state.selectedTabIds = new Set(state.tabs.map((tab) => getTabId(tab)).filter((id) => previous.has(id)));
    }

    renderTabsList();
    updateSubmitState();
  } catch (error) {
    console.error("读取标签页失败", error);
    state.tabs = [];
    renderTabsList();
    setResultMessage("读取标签页失败，请检查浏览器权限。", "error");
    updateSubmitState();
  }
}

async function handleUpload() {
  if (state.isUploading) {
    return;
  }

  const trimmedName = elements.shareNameInput.value.trim();
  const folderName = elements.tabsFolderNameInput.value.trim() || DEFAULT_TABS_FOLDER_NAME;

  const selectedTabPayload = state.tabs
    .filter((tab) => state.selectedTabIds.has(getTabId(tab)))
    .map((tab) => ({
      title: (tab.title || "").trim(),
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || undefined,
    }))
    .filter((tab) => tab.url && isShareableUrl(tab.url));

  const selectedBookmarkNodes = collectSelectedBookmarks(state.bookmarkTree, state.selectedBookmarkIds);
  const selectedBookmarkPayload = selectedBookmarkNodes
    .map((bookmark) => ({
      title: (bookmark.title || "").trim() || bookmark.url || "",
      url: bookmark.url || "",
    }))
    .filter((bookmark) => bookmark.url && isShareableUrl(bookmark.url));

  const combinedTabs = [];
  const urlToIndex = new Map();

  [...selectedBookmarkPayload, ...selectedTabPayload].forEach((item) => {
    const urlKey = (item.url || "").trim();
    if (!urlKey) {
      return;
    }
    if (!urlToIndex.has(urlKey)) {
      combinedTabs.push({ ...item, url: urlKey });
      urlToIndex.set(urlKey, combinedTabs.length - 1);
      return;
    }
    const index = urlToIndex.get(urlKey);
    const existing = combinedTabs[index];
    if (!existing.favIconUrl && item.favIconUrl) {
      combinedTabs[index] = { ...item, url: urlKey };
    }
  });

  if (!trimmedName) {
    setResultMessage("请填写分享站名称", "error");
    return;
  }

  if (combinedTabs.length === 0) {
    setResultMessage("请至少选择一个书签或标签页", "error");
    return;
  }

  if (!state.baseUrl) {
    setResultMessage("导航站地址不可用，请联系管理员", "error");
    return;
  }

  state.isUploading = true;
  setResultMessage("", "info");
  elements.uploadButton.textContent = "上传中…";
  elements.uploadButton.disabled = true;

  try {
    const headers = await buildAuthHeaders({
      "Content-Type": "application/json",
    });

    const { response, resolvedBaseUrl } = await fetchWithBaseFallback("/api/extension/upload-tabs", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        name: trimmedName,
        folderIds: [],
        tabs: combinedTabs,
        tabsFolderName: folderName,
      }),
    });

    if (typeof resolvedBaseUrl === "string" && resolvedBaseUrl && resolvedBaseUrl !== state.baseUrl) {
      await applyResolvedBaseUrl(resolvedBaseUrl);
    }

    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      setResultMessage("未登录，请先在导航站登录后重试", "error");
      state.isAuthenticated = false;
      await refreshAuthState();
      return;
    }

    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : `上传失败（${response.status}）`;
      throw new Error(message);
    }

    await refreshBookmarkTree();

    const shareSlug = payload?.item?.shareSlug;
    const shareUrl = shareSlug ? `${state.baseUrl.replace(/\/+$/, "")}/share/${shareSlug}` : "";

    showSuccessMessage(shareUrl);
    prepareNextShare();
  } catch (error) {
    console.error("上传失败", error);
    setResultMessage(error instanceof Error ? error.message : "上传失败，请稍后再试", "error");
  } finally {
    state.isUploading = false;
    elements.uploadButton.textContent = "上传生成分享站";
    updateSubmitState();
  }
}

function renderTabsList() {
  const container = elements.tabsContainer;
  container.innerHTML = "";

  if (!state.tabs.length) {
    appendEmptyHint(container, "当前窗口暂无可分享的标签页");
    return;
  }

  state.tabs.forEach((tab) => {
    const tabId = getTabId(tab);
    if (!tabId) return;

    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = tabId;
    checkbox.checked = state.selectedTabIds.has(tabId);
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedTabIds.add(tabId);
      } else {
        state.selectedTabIds.delete(tabId);
      }
      updateSubmitState();
    });

    const content = document.createElement("div");
    content.className = "checkbox-content";

    const title = document.createElement("span");
    title.className = "checkbox-title";
    title.textContent = tab.title?.trim() || tab.url || "未命名页面";

    const desc = document.createElement("span");
    desc.className = "checkbox-desc";
    desc.textContent = tab.url || "";

    content.appendChild(title);
    if (desc.textContent) {
      content.appendChild(desc);
    }

    wrapper.appendChild(checkbox);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
  });
}

function appendEmptyHint(container, text) {
  const hint = document.createElement("div");
  hint.className = "empty";
  hint.textContent = text;
  container.appendChild(hint);
}

function ensureDefaultInputs() {
  if (!elements.shareNameInput.value.trim()) {
    elements.shareNameInput.value = buildDefaultShareName(state.siteTitle);
  }

  if (!elements.tabsFolderNameInput.value.trim()) {
    elements.tabsFolderNameInput.value = DEFAULT_TABS_FOLDER_NAME;
  }
}

function prepareNextShare() {
  elements.shareNameInput.value = buildDefaultShareName(state.siteTitle);
  elements.tabsFolderNameInput.value = DEFAULT_TABS_FOLDER_NAME;
}

function updateStatusBanner() {
  if (state.bookmarksError) {
    setStatus(state.bookmarksError, "error");
    return;
  }

  const parts = [];

  if (state.isLoadingBookmarks) {
    parts.push("正在加载浏览器书签…");
  } else if (state.bookmarksLoaded) {
    parts.push("已加载浏览器书签");
  } else {
    parts.push("尚未加载浏览器书签");
  }

  let type = "info";

  if (state.isAuthenticated === true) {
    if (state.userEmail) {
      parts.push(`已登录：${state.userEmail}`);
    } else {
      parts.push("已登录导航站");
    }
  } else if (state.isAuthenticated === false) {
    parts.push("未检测到导航站登录");
    type = "error";
  } else {
    parts.push("正在检测登录状态…");
  }

  setStatus(parts.join(" · "), type);
}

function setStatus(text, type = "info") {
  elements.statusText.textContent = text;
  elements.statusText.classList.toggle("error", type === "error");
}

function setResultMessage(text, type = "info") {
  elements.resultMessage.className = `message${type ? ` ${type}` : ""}`;
  elements.resultMessage.textContent = text;
}

function showSuccessMessage(shareUrl) {
  elements.resultMessage.className = "message success";
  elements.resultMessage.textContent = "分享成功";

  if (shareUrl) {
    const separator = document.createTextNode("，");
    const link = document.createElement("a");
    link.href = shareUrl;
    link.textContent = "打开分享页";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    elements.resultMessage.appendChild(separator);
    elements.resultMessage.appendChild(link);

    copyToClipboard(shareUrl).catch(() => {
      // ignore copy failure
    });
  }
}

function updateSubmitState() {
  const hasSelection = state.selectedBookmarkIds.size > 0 || state.selectedTabIds.size > 0;
  const hasName = Boolean(elements.shareNameInput.value.trim());
  const ready = hasSelection && hasName && state.isAuthenticated && !state.isUploading && Boolean(state.baseUrl);
  elements.uploadButton.disabled = !ready;
}

function sanitizeBaseUrl(input) {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return "";
  }
}

function buildApiUrl(path, baseOverride) {
  const baseCandidate = typeof baseOverride === "string" && baseOverride.trim() ? baseOverride.trim() : state.baseUrl;
  const sanitizedBase = baseCandidate.replace(/\/+$/, "");
  if (!path.startsWith("/")) {
    return sanitizedBase ? `${sanitizedBase}/${path}` : path;
  }
  return sanitizedBase ? `${sanitizedBase}${path}` : path;
}

function buildApiPathVariants(path) {
  if (!path || typeof path !== "string") {
    return [];
  }

  const variants = [];
  const seen = new Set();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const cleaned = normalized.replace(/\/+$/, "").replace(/\/+/g, "/");

  const pushVariant = (candidate) => {
    if (!seen.has(candidate)) {
      seen.add(candidate);
      variants.push(candidate);
    }
  };

  if (cleaned) {
    pushVariant(cleaned);
  }

  if (cleaned && !cleaned.endsWith("/")) {
    pushVariant(`${cleaned}/`);
  }

  if (cleaned.startsWith("/api/")) {
    const withoutApi = cleaned.slice(4);
    if (withoutApi) {
      pushVariant(withoutApi);
      if (!withoutApi.endsWith("/")) {
        pushVariant(`${withoutApi}/`);
      }
    }
  }

  return variants;
}

function buildBaseUrlCandidates(baseUrl) {
  const candidates = [];
  const seen = new Set();

  const appendFromValue = (value) => {
    if (!value) {
      return;
    }

    const sanitized = sanitizeBaseUrl(value);
    if (!sanitized || seen.has(sanitized)) {
      return;
    }

    try {
      const parsed = new URL(sanitized);
      const origin = parsed.origin;
      const pathname = parsed.pathname.replace(/\/+$/, "");
      const segments = pathname.split("/").filter(Boolean);

      for (let i = segments.length; i >= 0; i -= 1) {
        const partialPath = segments.slice(0, i).join("/");
        const candidate = partialPath ? `${origin}/${partialPath}` : origin;
        if (!seen.has(candidate)) {
          seen.add(candidate);
          candidates.push(candidate);
        }
      }
    } catch {
      seen.add(sanitized);
      candidates.push(sanitized);
    }
  };

  appendFromValue(baseUrl);
  appendFromValue(DEFAULT_BASE_URL);

  return candidates;
}

async function fetchWithBaseFallback(path, init = {}) {
  const candidates = buildBaseUrlCandidates(state.baseUrl);
  const pathVariants = buildApiPathVariants(path);

  if (!candidates.length || !pathVariants.length) {
    throw new Error("请先设置导航站地址");
  }

  let lastNotFoundStatus = null;
  let lastError = null;

  for (const candidate of candidates) {
    for (const pathVariant of pathVariants) {
      const requestInit = { ...init };
      const url = buildApiUrl(pathVariant, candidate);

      try {
        const response = await fetch(url, requestInit);
        if (response.status === 404) {
          lastNotFoundStatus = response.status;
          continue;
        }
        return { response, resolvedBaseUrl: candidate };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  if (lastNotFoundStatus) {
    throw new Error(`加载失败（${lastNotFoundStatus}）`);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("请求失败，请稍后重试");
}

async function applyResolvedBaseUrl(resolvedBaseUrl) {
  const normalized = sanitizeBaseUrl(resolvedBaseUrl);
  if (!normalized || normalized === state.baseUrl) {
    return;
  }

  state.baseUrl = normalized;
  state.lastAccessToken = null;

  if (elements.baseUrlInput) {
    elements.baseUrlInput.value = normalized;
    elements.baseUrlInput.readOnly = true;
  }

  if (elements.saveBaseUrlButton) {
    elements.saveBaseUrlButton.disabled = true;
    elements.saveBaseUrlButton.style.display = "none";
  }

  try {
    await storageSet({ baseUrl: normalized });
  } catch (error) {
    console.warn("同步导航站地址失败", error);
  }
}

function buildDefaultShareName(siteTitle) {
  const title = (siteTitle || "我的导航站").trim();
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${title} · ${month}-${day} 标签精选`;
}

async function buildAuthHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = await resolveAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function resolveAccessToken() {
  if (!state.baseUrl || typeof chrome === "undefined" || !chrome.cookies) {
    state.lastAccessToken = null;
    return null;
  }

  const lookupUrl = getCookieLookupUrl();
  if (!lookupUrl) {
    state.lastAccessToken = null;
    return null;
  }

  return new Promise((resolve) => {
    chrome.cookies.getAll({ url: lookupUrl }, (cookies) => {
      if (chrome.runtime.lastError) {
        console.warn("读取 Supabase Cookie 失败", chrome.runtime.lastError);
        state.lastAccessToken = null;
        resolve(null);
        return;
      }

      const target = Array.isArray(cookies)
        ? cookies.find((cookie) => SUPABASE_COOKIE_REGEX.test(cookie.name ?? ""))
        : undefined;

      if (target?.value) {
        const decoded = decodeCookieValue(target.value);
        try {
          const parsed = JSON.parse(decoded);
          const token = typeof parsed?.access_token === "string" ? parsed.access_token : null;
          state.lastAccessToken = token ?? null;
          resolve(token ?? null);
          return;
        } catch (error) {
          console.warn("解析 Supabase 会话失败", error);
        }
      }

      state.lastAccessToken = null;
      resolve(null);
    });
  });
}

function decodeCookieValue(value) {
  if (typeof value !== "string") {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getCookieLookupUrl() {
  try {
    const parsed = new URL(state.baseUrl);
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}

async function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[key]);
      }
    });
  });
}

async function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

async function queryCurrentWindowTabs() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(Array.isArray(tabs) ? tabs : []);
      }
    });
  });
}

function isShareableTab(tab) {
  return Boolean(tab?.url && isShareableUrl(tab.url));
}

function getTabId(tab) {
  if (!tab || typeof tab.id === "undefined" || tab.id === null) {
    return "";
  }
  return String(tab.id);
}

function isShareableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function copyToClipboard(text) {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.warn("复制到剪贴板失败", error);
  }
}
