'use strict';

const state = {
  original: null,
  working: null,
  query: '',
  selectedFolderPath: [],
};

const uiState = {
  collapsedFolders: new Set(),
  draggingBookmark: null,
};

function deepClone(data) {
  return JSON.parse(JSON.stringify(data));
}

function computeStats(node) {
  if (!node) {
    return { total_folders: 0, total_bookmarks: 0 };
  }

  const walk = (current) => {
    if (current.type === 'bookmark') {
      return { folders: 0, bookmarks: 1 };
    }
    let folders = 1; // include current folder
    let bookmarks = 0;
    const children = current.children || [];
    for (const child of children) {
      const result = walk(child);
      folders += result.folders;
      bookmarks += result.bookmarks;
    }
    return { folders, bookmarks };
  };

  const { folders, bookmarks } = walk(node);
  return {
    total_folders: Math.max(folders - 1, 0),
    total_bookmarks: bookmarks,
  };
}

function prepareForExport() {
  if (!state.working) return;
  state.working.generated_at = new Date().toISOString();
  state.working.statistics = computeStats(state.working.root);
}

function getNodeByPath(path) {
  if (!state.working || !state.working.root) {
    return null;
  }
  let current = state.working.root;
  if (!Array.isArray(path) || path.length === 0) {
    return current;
  }
  for (const index of path) {
    if (!current.children || index < 0 || index >= current.children.length) {
      return null;
    }
    current = current.children[index];
  }
  return current;
}

function pathsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function getNodeKey(node, path) {
  if (node && node.id) {
    return node.id;
  }
  if (!Array.isArray(path) || path.length === 0) {
    return 'root';
  }
  return `path:${path.join('-')}`;
}

function toggleCollapse(nodeKey) {
  if (!nodeKey) return;
  if (uiState.collapsedFolders.has(nodeKey)) {
    uiState.collapsedFolders.delete(nodeKey);
  } else {
    uiState.collapsedFolders.add(nodeKey);
  }
  render();
}

function formatDate(isoString) {
  if (!isoString) return '未知时间';
  const date = new Date(isoString);
  if (Number.isNaN(date.valueOf())) {
    return isoString;
  }
  return date.toLocaleString();
}

function countBookmarks(node) {
  if (!node || node.type !== 'folder') {
    return 0;
  }
  const children = node.children || [];
  let total = 0;
  for (const child of children) {
    if (child.type === 'bookmark') {
      total += 1;
    } else if (child.type === 'folder') {
      total += countBookmarks(child);
    }
  }
  return total;
}

function findFirstFolderPath(node, currentPath = []) {
  if (!node || node.type !== 'folder') {
    return null;
  }
  if (currentPath.length > 0) {
    return currentPath;
  }
  const children = node.children || [];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.type === 'folder') {
      const result = findFirstFolderPath(child, [...currentPath, i]);
      if (result) {
        return result;
      }
    }
  }
  return currentPath;
}

function ensureSelectedFolderPath() {
  if (!state.working || !state.working.root) {
    state.selectedFolderPath = [];
    return;
  }
  const node = getNodeByPath(state.selectedFolderPath);
  if (!node || node.type !== 'folder') {
    const fallback = findFirstFolderPath(state.working.root);
    state.selectedFolderPath = fallback || [];
  }
}

function buildFolderNames(path) {
  const names = [];
  if (!state.working || !state.working.root) {
    return names;
  }
  let current = state.working.root;
  if (current.name) {
    names.push(current.name);
  }
  if (!Array.isArray(path)) {
    return names;
  }
  for (const index of path) {
    if (!current.children || index < 0 || index >= current.children.length) {
      break;
    }
    current = current.children[index];
    if (current.type === 'folder' && current.name) {
      names.push(current.name);
    }
  }
  return names;
}

function renderMetaInfo() {
  const metaInfo = document.getElementById('meta-info');
  if (!metaInfo) return;

  if (!state.working || !state.working.root) {
    metaInfo.innerHTML = '';
    return;
  }

  const stats = computeStats(state.working.root);
  state.working.statistics = stats;
  const generatedAt = formatDate(state.working.generated_at);
  const source = state.working.source || '未知来源';

  const metaPieces = [
    `共 <strong>${stats.total_folders}</strong> 个目录`,
    `共 <strong>${stats.total_bookmarks}</strong> 个书签`,
    `最近更新：<strong>${generatedAt}</strong>`,
    `数据来源：<strong>${source}</strong>`,
  ];

  metaInfo.innerHTML = '';
  metaPieces.forEach((text) => {
    const span = document.createElement('span');
    span.innerHTML = text;
    metaInfo.appendChild(span);
  });
}

function renderFolderTree() {
  const treeContainer = document.getElementById('folder-tree');
  if (!treeContainer) return;

  treeContainer.innerHTML = '';
  if (!state.working || !state.working.root) {
    treeContainer.innerHTML =
      '<div class="empty-state">未找到书签数据，请先运行解析脚本。</div>';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'tree-list';
  list.setAttribute('role', 'presentation');
  list.appendChild(createTreeNode(state.working.root, [], 0));
  treeContainer.appendChild(list);
}

function createTreeNode(node, path, depth) {
  const li = document.createElement('li');
  li.className = 'tree-node';

  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.style.setProperty('--depth', depth);
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-level', String(depth + 1));

  const nodeKey = getNodeKey(node, path);
  const folderChildren = (node.children || []).reduce((acc, child, index) => {
    if (child.type === 'folder') {
      acc.push({ node: child, index });
    }
    return acc;
  }, []);
  const hasChildren = folderChildren.length > 0;
  const isCollapsed = uiState.collapsedFolders.has(nodeKey);

  if (hasChildren) {
    row.setAttribute('aria-expanded', String(!isCollapsed));
  }

  if (pathsEqual(path, state.selectedFolderPath)) {
    row.classList.add('selected');
  }

  if (hasChildren) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tree-toggle';
    toggle.setAttribute('aria-label', isCollapsed ? '展开目录' : '折叠目录');
    toggle.textContent = isCollapsed ? '▸' : '▾';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCollapse(nodeKey);
    });
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'tree-spacer';
    row.appendChild(spacer);
  }

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'tree-label';
  label.textContent = node.name || '未命名目录';
  const bookmarkCount = countBookmarks(node);
  if (bookmarkCount > 0) {
    const countEl = document.createElement('span');
    countEl.className = 'count';
    countEl.textContent = String(bookmarkCount);
    label.appendChild(countEl);
  }
  label.addEventListener('click', (event) => {
    event.stopPropagation();
    selectFolder(path);
  });

  row.addEventListener('click', () => {
    selectFolder(path);
  });

  row.appendChild(label);
  li.appendChild(row);

  if (hasChildren && !isCollapsed) {
    const childList = document.createElement('ul');
    childList.className = 'tree-children';
    childList.setAttribute('role', 'group');
    folderChildren.forEach(({ node: childNode, index }) => {
      const childPath = [...path, index];
      childList.appendChild(createTreeNode(childNode, childPath, depth + 1));
    });
    li.appendChild(childList);
  }

  return li;
}

function selectFolder(path) {
  if (!Array.isArray(path)) return;
  state.selectedFolderPath = path;
  if (state.query) {
    state.query = '';
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = '';
    }
  }
  render();
}

function renderContent() {
  const query = state.query.trim();
  if (query) {
    renderSearchResults(query);
  } else {
    renderSelectedFolder();
  }
}

function renderSelectedFolder() {
  const bookmarkList = document.getElementById('bookmark-list');
  const contentTitle = document.getElementById('content-title');
  const contentPath = document.getElementById('content-path');
  const contentMeta = document.getElementById('content-meta');

  if (!bookmarkList || !contentTitle || !contentPath || !contentMeta) {
    return;
  }

  bookmarkList.innerHTML = '';
  bookmarkList.ondragover = null;
  bookmarkList.ondrop = null;

  const folder = getNodeByPath(state.selectedFolderPath);
  if (!folder || folder.type !== 'folder') {
    contentTitle.textContent = '请选择目录';
    contentPath.textContent = '';
    contentMeta.innerHTML = '';
    bookmarkList.innerHTML =
      '<div class="empty-state">请选择左侧目录以查看内容。</div>';
    return;
  }

  contentTitle.textContent = folder.name || '未命名目录';
  const names = buildFolderNames(state.selectedFolderPath);
  if (state.selectedFolderPath.length === 0) {
    contentPath.textContent = '';
  } else if (names.length > 1) {
    contentPath.textContent = names.slice(0, -1).join(' / ');
  } else {
    contentPath.textContent = names[0] || '';
  }

  const children = Array.isArray(folder.children) ? folder.children : [];
  const bookmarkEntries = [];
  let folderCount = 0;
  children.forEach((child, index) => {
    if (child.type === 'bookmark') {
      bookmarkEntries.push({ node: child, index });
    } else if (child.type === 'folder') {
      folderCount += 1;
    }
  });

  const bookmarkCount = bookmarkEntries.length;
  const metaPieces = [
    { html: `书签 <strong>${bookmarkCount}</strong>` },
    { html: `子目录 <strong>${folderCount}</strong>` },
  ];
  if (bookmarkCount > 1) {
    metaPieces.push({ text: '可拖动以调整顺序' });
  }

  contentMeta.innerHTML = '';
  metaPieces.forEach((piece) => {
    const span = document.createElement('span');
    if (piece.html) {
      span.innerHTML = piece.html;
    } else if (piece.text) {
      span.textContent = piece.text;
    }
    contentMeta.appendChild(span);
  });

  if (!bookmarkCount) {
    bookmarkList.innerHTML =
      '<div class="empty-state">此目录下暂无网页书签，可在浏览器中新增后重新导出。</div>';
    return;
  }

  const allowDrag = bookmarkCount > 1;
  const clearDropIndicators = () => {
    bookmarkList
      .querySelectorAll('.bookmark-item')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  };

  if (allowDrag) {
    bookmarkList.ondragover = (event) => {
      if (!uiState.draggingBookmark) return;
      event.preventDefault();
    };
    bookmarkList.ondrop = (event) => {
      if (!uiState.draggingBookmark) return;
      event.preventDefault();
      const from = uiState.draggingBookmark.from;
      if (typeof from !== 'number') return;
      clearDropIndicators();
      uiState.draggingBookmark = null;
      reorderBookmarks(state.selectedFolderPath, from, bookmarkEntries.length);
    };
  }

  bookmarkEntries.forEach(({ node }, position) => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.dataset.position = String(position);

    if (allowDrag) {
      item.setAttribute('draggable', 'true');
      item.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(position));
        uiState.draggingBookmark = { from: position };
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        uiState.draggingBookmark = null;
        clearDropIndicators();
      });
      item.addEventListener('dragover', (event) => {
        if (!uiState.draggingBookmark) return;
        event.preventDefault();
        const rect = item.getBoundingClientRect();
        const dropAfter = event.clientY - rect.top > rect.height / 2;
        item.classList.toggle('drop-before', !dropAfter);
        item.classList.toggle('drop-after', dropAfter);
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-before', 'drop-after');
      });
      item.addEventListener('drop', (event) => {
        if (!uiState.draggingBookmark) return;
        event.preventDefault();
        const rect = item.getBoundingClientRect();
        const dropAfter = event.clientY - rect.top > rect.height / 2;
        const from = uiState.draggingBookmark.from;
        if (typeof from !== 'number') return;
        let to = position;
        if (dropAfter) {
          to = position + 1;
        }
        clearDropIndicators();
        uiState.draggingBookmark = null;
        reorderBookmarks(state.selectedFolderPath, from, to);
      });
    }

    const info = document.createElement('div');
    info.className = 'bookmark-info';

    const link = document.createElement('a');
    link.href = node.url || '#';
    link.textContent = node.name || node.url || '未命名书签';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    info.appendChild(link);

    if (node.url) {
      const urlEl = document.createElement('span');
      urlEl.className = 'bookmark-url';
      urlEl.textContent = node.url;
      info.appendChild(urlEl);
    }

    if (node.description) {
      const desc = document.createElement('p');
      desc.className = 'bookmark-description';
      desc.textContent = node.description;
      info.appendChild(desc);
    }

    item.appendChild(info);
    bookmarkList.appendChild(item);
  });
}

function renderSearchResults(query) {
  const bookmarkList = document.getElementById('bookmark-list');
  const contentTitle = document.getElementById('content-title');
  const contentPath = document.getElementById('content-path');
  const contentMeta = document.getElementById('content-meta');

  if (!bookmarkList || !contentTitle || !contentPath || !contentMeta) {
    return;
  }

  bookmarkList.innerHTML = '';
  bookmarkList.ondragover = null;
  bookmarkList.ondrop = null;

  contentTitle.textContent = '搜索结果';
  contentPath.textContent = '';

  const matches = searchBookmarks(query);

  contentMeta.innerHTML = '';
  const querySpan = document.createElement('span');
  querySpan.innerHTML = `关键词：<strong>${query}</strong>`;
  contentMeta.appendChild(querySpan);
  const countSpan = document.createElement('span');
  countSpan.innerHTML = `匹配项：<strong>${matches.length}</strong>`;
  contentMeta.appendChild(countSpan);

  if (!matches.length) {
    bookmarkList.innerHTML =
      '<div class="empty-state">没有匹配的书签，请调整搜索关键词。</div>';
    return;
  }

  matches.forEach(({ node, path }) => {
    const item = document.createElement('div');
    item.className = 'bookmark-item';

    const info = document.createElement('div');
    info.className = 'bookmark-info';

    const link = document.createElement('a');
    link.href = node.url || '#';
    link.textContent = node.name || node.url || '未命名书签';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    info.appendChild(link);

    if (node.url) {
      const urlEl = document.createElement('span');
      urlEl.className = 'bookmark-url';
      urlEl.textContent = node.url;
      info.appendChild(urlEl);
    }

    if (node.description) {
      const desc = document.createElement('p');
      desc.className = 'bookmark-description';
      desc.textContent = node.description;
      info.appendChild(desc);
    }

    const folderPath = path.slice(0, -1);
    const folderNames = buildFolderNames(folderPath);
    if (folderNames.length) {
      const displayNames = folderNames.length > 1 ? folderNames.slice(1) : folderNames;
      const extra = document.createElement('span');
      extra.className = 'bookmark-extra';
      extra.textContent = displayNames.join(' / ');
      info.appendChild(extra);
    }

    item.appendChild(info);
    bookmarkList.appendChild(item);
  });
}

function searchBookmarks(query) {
  if (!state.working || !state.working.root) {
    return [];
  }
  const lowered = query.toLowerCase();
  const matches = [];

  const walk = (node, path) => {
    if (node.type === 'bookmark') {
      const name = (node.name || '').toLowerCase();
      const url = (node.url || '').toLowerCase();
      if ((name && name.includes(lowered)) || (url && url.includes(lowered))) {
        matches.push({ node, path });
      }
    } else if (node.type === 'folder') {
      const children = node.children || [];
      children.forEach((child, index) => {
        walk(child, [...path, index]);
      });
    }
  };

  walk(state.working.root, []);
  return matches;
}

function reorderBookmarks(folderPath, fromPosition, toPosition) {
  const folder = getNodeByPath(folderPath);
  if (!folder || !Array.isArray(folder.children)) {
    return;
  }

  const bookmarkIndices = [];
  const bookmarkNodes = [];
  folder.children.forEach((child, index) => {
    if (child.type === 'bookmark') {
      bookmarkIndices.push(index);
      bookmarkNodes.push(child);
    }
  });

  if (bookmarkIndices.length <= 1) {
    render();
    return;
  }

  if (fromPosition < 0 || fromPosition >= bookmarkNodes.length) {
    render();
    return;
  }

  let target = toPosition;
  if (target < 0) target = 0;
  if (target > bookmarkNodes.length) target = bookmarkNodes.length;

  const [moved] = bookmarkNodes.splice(fromPosition, 1);
  if (fromPosition < target) {
    target -= 1;
  }
  if (target < 0) target = 0;
  if (target > bookmarkNodes.length) target = bookmarkNodes.length;
  bookmarkNodes.splice(target, 0, moved);

  bookmarkIndices.forEach((childIndex, idx) => {
    folder.children[childIndex] = bookmarkNodes[idx];
  });

  state.working.generated_at = new Date().toISOString();
  render();
}

function render() {
  const searchInput = document.getElementById('search-input');
  if (searchInput && searchInput.value !== state.query) {
    searchInput.value = state.query;
  }

  renderMetaInfo();

  if (!state.working || !state.working.root) {
    const treeContainer = document.getElementById('folder-tree');
    if (treeContainer) {
      treeContainer.innerHTML =
        '<div class="empty-state">未找到书签数据，请先运行解析脚本。</div>';
    }
    const bookmarkList = document.getElementById('bookmark-list');
    if (bookmarkList) {
      bookmarkList.innerHTML =
        '<div class="empty-state">未找到书签数据，请先运行解析脚本。</div>';
      bookmarkList.ondragover = null;
      bookmarkList.ondrop = null;
    }
    const contentTitle = document.getElementById('content-title');
    if (contentTitle) {
      contentTitle.textContent = '请选择目录';
    }
    const contentPath = document.getElementById('content-path');
    if (contentPath) {
      contentPath.textContent = '';
    }
    const contentMeta = document.getElementById('content-meta');
    if (contentMeta) {
      contentMeta.innerHTML = '';
    }
    return;
  }

  ensureSelectedFolderPath();
  renderFolderTree();
  renderContent();
}

async function loadBookmarks() {
  try {
    const response = await fetch('bookmarks.json', { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`无法加载 bookmarks.json: ${response.status}`);
    }
    const data = await response.json();
    state.original = deepClone(data);
    state.working = deepClone(data);
    uiState.collapsedFolders.clear();
    state.selectedFolderPath = findFirstFolderPath(state.working.root) || [];
    render();
  } catch (error) {
    console.error(error);
    state.original = null;
    state.working = null;
    renderMetaInfo();
    const treeContainer = document.getElementById('folder-tree');
    if (treeContainer) {
      treeContainer.innerHTML = `<div class="empty-state">${error.message}<br/>请确认已执行解析脚本并生成 bookmarks.json。</div>`;
    }
    const bookmarkList = document.getElementById('bookmark-list');
    if (bookmarkList) {
      bookmarkList.innerHTML = `<div class="empty-state">${error.message}<br/>请确认已执行解析脚本并生成 bookmarks.json。</div>`;
      bookmarkList.ondragover = null;
      bookmarkList.ondrop = null;
    }
    const contentTitle = document.getElementById('content-title');
    if (contentTitle) {
      contentTitle.textContent = '请选择目录';
    }
    const contentPath = document.getElementById('content-path');
    if (contentPath) {
      contentPath.textContent = '';
    }
    const contentMeta = document.getElementById('content-meta');
    if (contentMeta) {
      contentMeta.innerHTML = '';
    }
  }
}

function resetOrder() {
  if (!state.original) return;
  state.working = deepClone(state.original);
  state.query = '';
  uiState.collapsedFolders.clear();
  state.selectedFolderPath = findFirstFolderPath(state.working.root) || [];
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
  }
  render();
}

function copyJson() {
  if (!state.working) return;
  prepareForExport();
  const payload = JSON.stringify(state.working, null, 2);
  render();
  navigator.clipboard
    .writeText(payload)
    .then(() => {
      showToast('JSON 已复制到剪贴板');
    })
    .catch(() => {
      showToast('复制失败，请检查浏览器权限', true);
    });
}

function downloadJson() {
  if (!state.working) return;
  prepareForExport();
  const payload = JSON.stringify(state.working, null, 2);
  render();
  const blob = new Blob([payload], {
    type: 'application/json',
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = objectUrl;
  link.download = `bookmarks-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
  showToast('JSON 已下载');
}

let toastTimer = null;
function showToast(message, isError = false) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2400);
}

function attachEvents() {
  const searchInput = document.getElementById('search-input');
  const clearSearch = document.getElementById('clear-search');
  const resetOrderButton = document.getElementById('reset-order');
  const copyButton = document.getElementById('copy-json');
  const downloadButton = document.getElementById('download-json');

  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.query = event.target.value || '';
      render();
    });
  }

  if (clearSearch) {
    clearSearch.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
      }
      state.query = '';
      render();
    });
  }

  if (resetOrderButton) {
    resetOrderButton.addEventListener('click', resetOrder);
  }

  if (copyButton) {
    copyButton.addEventListener('click', copyJson);
  }

  if (downloadButton) {
    downloadButton.addEventListener('click', downloadJson);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  attachEvents();
  loadBookmarks();
});
