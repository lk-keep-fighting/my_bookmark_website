'use strict';

const state = {
  original: null,
  working: null,
  query: '',
};

const uiState = {
  collapsedFolders: new Set(),
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
  let current = state.working.root;
  if (!path || path.length === 0) {
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

function moveNode(path, direction) {
  if (!Array.isArray(path) || !path.length) {
    return;
  }
  const parentPath = path.slice(0, -1);
  const parent = getNodeByPath(parentPath);
  if (!parent || !Array.isArray(parent.children)) {
    return;
  }
  const currentIndex = path[path.length - 1];
  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= parent.children.length) {
    return;
  }
  const [node] = parent.children.splice(currentIndex, 1);
  parent.children.splice(targetIndex, 0, node);

  state.working.generated_at = new Date().toISOString();
  state.working.statistics = computeStats(state.working.root);
  render();
}

function toggleCollapse(nodeId) {
  if (uiState.collapsedFolders.has(nodeId)) {
    uiState.collapsedFolders.delete(nodeId);
  } else {
    uiState.collapsedFolders.add(nodeId);
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

function filterTree(nodes, query) {
  if (!query) {
    return deepClone(nodes);
  }
  const lowered = query.toLowerCase();
  const filtered = [];

  for (const node of nodes) {
    if (node.type === 'folder') {
      const childResult = filterTree(node.children || [], query);
      const match = node.name && node.name.toLowerCase().includes(lowered);
      if (match || childResult.length > 0) {
        const clone = deepClone({ ...node, children: childResult });
        filtered.push(clone);
      }
    } else if (node.type === 'bookmark') {
      const nameMatch = node.name && node.name.toLowerCase().includes(lowered);
      const urlMatch = node.url && node.url.toLowerCase().includes(lowered);
      if (nameMatch || urlMatch) {
        filtered.push(deepClone(node));
      }
    }
  }

  return filtered;
}

function createMoveButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function renderBookmarkItem(node, path, allowReorder) {
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

  item.appendChild(info);

  if (allowReorder) {
    const actions = document.createElement('div');
    actions.className = 'bookmark-actions';
    actions.appendChild(
      createMoveButton('↑', '上移书签', () => moveNode(path, -1))
    );
    actions.appendChild(
      createMoveButton('↓', '下移书签', () => moveNode(path, 1))
    );
    item.appendChild(actions);
  }

  return item;
}

function renderFolder(node, path, allowReorder, depth) {
  const isCollapsed = uiState.collapsedFolders.has(node.id);

  const container = document.createElement(depth === 0 ? 'section' : 'div');
  container.className = depth === 0 ? 'folder-card' : 'nested-folder';
  if (isCollapsed) {
    container.classList.add('collapsed');
  }

  const header = document.createElement('div');
  header.className = depth === 0 ? 'folder-header' : 'nested-folder-header';

  const headingTag = depth === 0 ? 'h2' : 'h3';
  const title = document.createElement(headingTag);
  title.className = 'folder-title';
  title.textContent = node.name || '未命名目录';
  header.appendChild(title);

  const totalChildren = (node.children || []).length;
  const badges = document.createElement('div');
  badges.className = 'folder-meta';
  const badge = document.createElement('span');
  badge.textContent = `${totalChildren} 项`;
  badges.appendChild(badge);
  header.appendChild(badges);

  const actions = document.createElement('div');
  actions.className = 'folder-actions';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'ghost';
  collapseBtn.textContent = isCollapsed ? '展开' : '折叠';
  collapseBtn.title = isCollapsed ? '展开目录' : '折叠目录';
  collapseBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCollapse(node.id);
  });
  actions.appendChild(collapseBtn);

  if (allowReorder) {
    actions.appendChild(createMoveButton('↑', '上移目录', () => moveNode(path, -1)));
    actions.appendChild(createMoveButton('↓', '下移目录', () => moveNode(path, 1)));
  }

  header.appendChild(actions);
  container.appendChild(header);

  if (!isCollapsed) {
    const body = document.createElement('div');
    body.className = depth === 0 ? 'folder-body' : 'nested-folder-body';
    const children = node.children || [];
    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '目录为空，可在浏览器中新增书签后重新导出。';
      body.appendChild(empty);
    } else {
      children.forEach((child, index) => {
        const childPath = [...path, index];
        if (child.type === 'folder') {
          body.appendChild(renderFolder(child, childPath, allowReorder, depth + 1));
        } else {
          body.appendChild(renderBookmarkItem(child, childPath, allowReorder));
        }
      });
    }
    container.appendChild(body);
  }

  return container;
}

function renderTree(nodes, parent, allowReorder, basePath = []) {
  nodes.forEach((node, index) => {
    const currentPath = [...basePath, index];
    if (node.type === 'folder') {
      parent.appendChild(renderFolder(node, currentPath, allowReorder, 0));
    } else {
      const card = document.createElement('section');
      card.className = 'folder-card bookmark-card';
      card.appendChild(renderBookmarkItem(node, currentPath, allowReorder));
      parent.appendChild(card);
    }
  });
}

function render() {
  const container = document.getElementById('bookmarks-container');
  const metaInfo = document.getElementById('meta-info');

  if (!state.working) {
    metaInfo.textContent = '';
    container.innerHTML = '<div class="empty-state">未找到书签数据，请先运行解析脚本。</div>';
    return;
  }

  const allowReorder = state.query.trim().length === 0;
  const rootChildren = state.working.root?.children || [];
  const nodesForRender = allowReorder
    ? rootChildren
    : filterTree(rootChildren, state.query.trim());

  // Update meta info
  const stats = computeStats(state.working.root);
  state.working.statistics = stats;
  const generatedAt = formatDate(state.working.generated_at);
  const source = state.working.source || '未知来源';

  metaInfo.innerHTML = '';
  const metaPieces = [
    `共 <strong>${stats.total_folders}</strong> 个目录`,
    `共 <strong>${stats.total_bookmarks}</strong> 个书签`,
    `最近更新：<strong>${generatedAt}</strong>`,
    `数据来源：<strong>${source}</strong>`,
  ];
  metaPieces.forEach((text) => {
    const span = document.createElement('span');
    span.innerHTML = text;
    metaInfo.appendChild(span);
  });

  container.innerHTML = '';

  if (!nodesForRender.length) {
    container.innerHTML = '<div class="empty-state">没有匹配的书签，请修改搜索关键词或重新导出书签。</div>';
    return;
  }

  renderTree(nodesForRender, container, allowReorder, []);
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
    render();
  } catch (error) {
    console.error(error);
    const container = document.getElementById('bookmarks-container');
    const metaInfo = document.getElementById('meta-info');
    metaInfo.textContent = '';
    container.innerHTML = `<div class="empty-state">${error.message}<br/>请确认已执行解析脚本并生成 bookmarks.json。</div>`;
  }
}

function resetOrder() {
  if (!state.original) return;
  state.working = deepClone(state.original);
  state.query = '';
  uiState.collapsedFolders.clear();
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
