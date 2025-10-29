const DEFAULT_TABS_FOLDER_NAME = "当前打开的页面";
const SUPABASE_COOKIE_REGEX = /^sb-.*-auth-token$/;

const state = {
  baseUrl: "",
  context: null,
  tabs: [],
  selectedFolderIds: new Set(),
  selectedTabIds: new Set(),
  isUploading: false,
  isLoadingContext: false,
  isAuthenticated: false,
  lastAccessToken: null,
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
    if (!state.context?.folderOptions?.length) return;
    state.selectedFolderIds = new Set(state.context.folderOptions.map((option) => option.id));
    renderFolders(state.context.folderOptions);
    updateSubmitState();
  });

  elements.foldersClearButton.addEventListener("click", () => {
    state.selectedFolderIds.clear();
    renderFolders(state.context?.folderOptions ?? []);
    updateSubmitState();
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

  elements.shareNameInput.addEventListener("input", () => {
    updateSubmitState();
  });

  elements.uploadButton.addEventListener("click", async () => {
    await handleUpload();
  });
}

async function loadBaseUrl() {
  try {
    const stored = await storageGet("baseUrl");
    const saved = typeof stored === "string" ? stored : "";
    const sanitized = sanitizeBaseUrl(saved);
    if (sanitized) {
      state.baseUrl = sanitized;
      state.lastAccessToken = null;
      elements.baseUrlInput.value = sanitized;
    }
  } catch (error) {
    console.error("读取地址失败", error);
    setResultMessage("读取已保存地址失败", "error");
  }
}

async function refreshAll() {
  if (!state.baseUrl) {
    setStatus("请先填写导航站地址", "error");
    state.isAuthenticated = false;
    state.context = null;
    renderFolders([]);
    await refreshTabs();
    ensureDefaultInputs();
    updateSubmitState();
    return;
  }

  await refreshContext();
  await refreshTabs();
  ensureDefaultInputs();
  updateSubmitState();
}

async function refreshContext() {
  state.isLoadingContext = true;
  setStatus("加载目录中…");

  try {
    const headers = await buildAuthHeaders();
    const { response, resolvedBaseUrl } = await fetchWithBaseFallback("/api/extension/context", {
      method: "GET",
      credentials: "include",
      headers,
    });

    if (typeof resolvedBaseUrl === "string" && resolvedBaseUrl && resolvedBaseUrl !== state.baseUrl) {
      await applyResolvedBaseUrl(resolvedBaseUrl);
    }

    if (response.status === 401) {
      state.isAuthenticated = false;
      state.context = null;
      renderFolders([]);
      setStatus("未登录，请先在导航站完成登录", "error");
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message = typeof payload.error === "string" ? payload.error : `加载失败（${response.status}）`;
      throw new Error(message);
    }

    const data = await response.json();
    state.context = data;
    state.isAuthenticated = true;

    if (Array.isArray(data.folderOptions)) {
      const existingSelection = new Set(state.selectedFolderIds);
      state.selectedFolderIds = new Set(
        data.folderOptions
          .map((option) => option.id)
          .filter((id) => existingSelection.has(id)),
      );
      renderFolders(data.folderOptions);
    } else {
      renderFolders([]);
    }

    setStatus(data.userEmail ? `已登录：${data.userEmail}` : "已登录");
  } catch (error) {
    console.error("加载目录失败", error);
    state.isAuthenticated = false;
    state.context = null;
    renderFolders([]);
    setStatus(error instanceof Error ? error.message : "加载目录失败", "error");
  } finally {
    state.isLoadingContext = false;
  }
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
  if (state.isUploading) return;

  const trimmedName = elements.shareNameInput.value.trim();
  const folderName = elements.tabsFolderNameInput.value.trim();
  const selectedFolderIds = Array.from(state.selectedFolderIds);
  const selectedTabs = state.tabs
    .filter((tab) => state.selectedTabIds.has(getTabId(tab)))
    .map((tab) => ({
      title: (tab.title || "").trim(),
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || undefined,
    }))
    .filter((tab) => tab.url && isShareableUrl(tab.url));

  if (!trimmedName) {
    setResultMessage("请填写分享站名称", "error");
    return;
  }

  if (selectedFolderIds.length === 0 && selectedTabs.length === 0) {
    setResultMessage("请至少选择一个目录或标签页", "error");
    return;
  }

  if (!state.baseUrl) {
    setResultMessage("请先设置导航站地址", "error");
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

    const response = await fetch(buildApiUrl("/api/extension/upload-tabs"), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        name: trimmedName,
        folderIds: selectedFolderIds,
        tabs: selectedTabs,
        tabsFolderName: folderName,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
      setResultMessage("未登录，请先在导航站登录后重试", "error");
      state.isAuthenticated = false;
      await refreshContext();
      return;
    }

    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : `上传失败（${response.status}）`;
      throw new Error(message);
    }

    if (payload.createdFolder?.id) {
      state.selectedFolderIds.add(payload.createdFolder.id);
    }

    await refreshContext();

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

function renderFolders(options) {
  const container = elements.foldersContainer;
  container.innerHTML = "";

  if (!state.isAuthenticated) {
    appendEmptyHint(container, "未登录或未能获取目录");
    return;
  }

  if (!options || options.length === 0) {
    const hint = state.context?.hasDocument
      ? "当前书签暂无可分享目录"
      : "请先在导航站导入浏览器书签";
    appendEmptyHint(container, hint);
    return;
  }

  options.forEach((option) => {
    const id = option.id;
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = id;
    checkbox.checked = state.selectedFolderIds.has(id);
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked) {
        state.selectedFolderIds.add(id);
      } else {
        state.selectedFolderIds.delete(id);
      }
      updateSubmitState();
    });

    const content = document.createElement("div");
    content.className = "checkbox-content";

    const title = document.createElement("span");
    title.className = "checkbox-title";
    title.textContent = option.label || "未命名目录";

    const desc = document.createElement("span");
    desc.className = "checkbox-desc";
    if (typeof option.directBookmarkCount === "number") {
      desc.textContent = `${option.directBookmarkCount} 个直接书签`;
    } else {
      desc.textContent = "";
    }

    content.appendChild(title);
    if (desc.textContent) {
      content.appendChild(desc);
    }

    wrapper.appendChild(checkbox);
    wrapper.appendChild(content);
    container.appendChild(wrapper);
  });
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
    elements.shareNameInput.value = buildDefaultShareName(state.context?.siteTitle);
  }

  if (!elements.tabsFolderNameInput.value.trim()) {
    elements.tabsFolderNameInput.value = DEFAULT_TABS_FOLDER_NAME;
  }
}

function prepareNextShare() {
  elements.shareNameInput.value = buildDefaultShareName(state.context?.siteTitle);
  elements.tabsFolderNameInput.value = DEFAULT_TABS_FOLDER_NAME;
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
  const hasSelection = state.selectedFolderIds.size > 0 || state.selectedTabIds.size > 0;
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
  const baseCandidate =
    typeof baseOverride === "string" && baseOverride.trim() ? baseOverride.trim() : state.baseUrl;
  const sanitizedBase = baseCandidate.replace(/\/+$/, "");
  if (!path.startsWith("/")) {
    return sanitizedBase ? `${sanitizedBase}/${path}` : path;
  }
  return sanitizedBase ? `${sanitizedBase}${path}` : path;
}

function buildBaseUrlCandidates(baseUrl) {
  if (!baseUrl) {
    return [];
  }

  const candidates = [];
  const seen = new Set();

  try {
    const parsed = new URL(baseUrl);
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

    return candidates;
  } catch {
    return [baseUrl];
  }
}

async function fetchWithBaseFallback(path, init = {}) {
  const candidates = buildBaseUrlCandidates(state.baseUrl);
  if (!candidates.length) {
    throw new Error("请先设置导航站地址");
  }

  let lastNotFoundStatus = null;
  let lastError = null;

  for (const candidate of candidates) {
    const requestInit = { ...init };
    const url = buildApiUrl(path, candidate);

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
  elements.baseUrlInput.value = normalized;

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
