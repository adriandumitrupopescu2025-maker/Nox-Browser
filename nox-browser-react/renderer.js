const { ipcRenderer, clipboard } = require('electron');
const path = require('path');

let tabCount = 0;

// Elemente DOM
const tabsContainer = document.getElementById('tabs-container');
const contentsContainer = document.getElementById('contents-container');
const toggleNavBtn = document.getElementById('toggle-nav-btn');
const newTabBtn = document.getElementById('new-tab-btn');
const menuBtn = document.getElementById('menu-btn');
const mainToolbar = document.getElementById('main-toolbar');
const adblockToggleBtn = document.getElementById('adblock-toggle-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const passwordsBtn = document.getElementById('passwords-btn');
const historyBtn = document.getElementById('history-btn');
const settingsBtn = document.getElementById('settings-btn');
const btnSplitVGlobal = document.getElementById('btn-split-v-global');
const btnSplitHGlobal = document.getElementById('btn-split-h-global');
const bookmarksBar = document.getElementById('bookmarks-bar');
const bookmarksContainer = document.getElementById('bookmarks-container');

const passwordPromptBar = document.getElementById('password-prompt-bar');
const passwordPromptText = document.getElementById('password-prompt-text');
const pwdSaveConfirmBtn = document.getElementById('pwd-save-confirm-btn');
const pwdSaveDismissBtn = document.getElementById('pwd-save-dismiss-btn');

let pendingPasswordCapture = null;
let autoPushTimer = null;
let isApplyingRemoteSync = false;

const DOMAIN_ZOOM_STORAGE_KEY = 'nox-domain-zoom';

// ASCULTĂTOR IPC GLOBAL PENTRU DESCHIDEREA LINK-URILOR DE PE DASHBOARD ÎN TAB NOU
ipcRenderer.on('open-in-new-tab', (event, url) => {
  if (url && url !== 'about:blank') {
    createTab(url);
  }
});

// --- 0. ASCUNDERE / AFIȘARE BARĂ DE SUS (IMPLICIT EXTINSĂ) ---
function setTopNavHidden(hidden) {
  document.body.classList.toggle('nav-hidden', hidden);
  if (toggleNavBtn) {
    toggleNavBtn.textContent = hidden ? '▼' : '▲';
    toggleNavBtn.dataset.tooltip = hidden ? 'Arată bara de sus' : 'Ascunde bara de sus';
  }
}

setTopNavHidden(false);

if (toggleNavBtn) {
  toggleNavBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willHide = !document.body.classList.contains('nav-hidden');
    setTopNavHidden(willHide);
  });
}

function getActivePaneElement() {
  const activeTabId = getActiveTabId();
  if (!activeTabId) return null;
  const tabContent = document.getElementById(activeTabId);
  if (!tabContent) return null;
  return (
    tabContent.querySelector('.pane.active') ||
    tabContent.querySelector('.pane')
  );
}

function handleZoomShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;

  const isZoomIn =
    e.key === '+' ||
    e.key === '=' ||
    e.code === 'Equal' ||
    e.code === 'NumpadAdd';
  const isZoomOut =
    e.key === '-' ||
    e.key === '_' ||
    e.code === 'Minus' ||
    e.code === 'NumpadSubtract';
  const isZoomReset =
    e.key === '0' ||
    e.code === 'Digit0' ||
    e.code === 'Numpad0';

  if (!isZoomIn && !isZoomOut && !isZoomReset) return false;

  const activePane = getActivePaneElement();
  if (!activePane) return false;

  if (isZoomIn && typeof activePane._noxZoomStep === 'function') {
    activePane._noxZoomStep(10);
    return true;
  }
  if (isZoomOut && typeof activePane._noxZoomStep === 'function') {
    activePane._noxZoomStep(-10);
    return true;
  }
  if (isZoomReset && typeof activePane._noxZoomReset === 'function') {
    activePane._noxZoomReset();
    return true;
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (handleZoomShortcut(e)) {
    e.preventDefault();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    setTopNavHidden(false);
    const activeTabId = getActiveTabId();
    const tabContent = activeTabId ? document.getElementById(activeTabId) : null;
    const input =
      tabContent?.querySelector('.pane.active .pane-url') ||
      tabContent?.querySelector('.pane .pane-url');
    if (input) {
      input.focus();
      input.select();
    }
  } else if (e.key === 'Escape' && mainToolbar && !mainToolbar.classList.contains('hidden')) {
    mainToolbar.classList.add('hidden');
  }
});

document.addEventListener(
  'wheel',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.deltaY === 0) return;

    const targetPane =
      e.target?.closest?.('.pane') || getActivePaneElement();
    if (!targetPane || typeof targetPane._noxZoomStep !== 'function') return;

    e.preventDefault();

    const splitContainer = targetPane.closest('.split-container');
    if (splitContainer) {
      splitContainer.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
      targetPane.classList.add('active');
    }

    const step = e.deltaY < 0 ? 10 : -10;
    targetPane._noxZoomStep(step);
  },
  { passive: false }
);

// --- 1. MENIU & TOOLBAR TOGGLE ---
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeFolderDropdown();
  mainToolbar.classList.toggle('hidden');
});

// --- 2. AD-BLOCKER TOGGLE ---
async function initAdBlockerStatus() {
  const isEnabled = await ipcRenderer.invoke('get-adblock-status');
  updateAdBlockBtn(isEnabled);
}

function updateAdBlockBtn(enabled) {
  if (enabled) {
    adblockToggleBtn.innerText = '🛡️ AdBlock: ON';
    adblockToggleBtn.style.background = '#27ae60';
    adblockToggleBtn.style.color = 'white';
  } else {
    adblockToggleBtn.innerText = '🛡️ AdBlock: OFF';
    adblockToggleBtn.style.background = '#7f8c8d';
    adblockToggleBtn.style.color = 'white';
  }
}

adblockToggleBtn.addEventListener('click', async () => {
  const currentStatus = await ipcRenderer.invoke('get-adblock-status');
  const newStatus = !currentStatus;
  const res = await ipcRenderer.invoke('toggle-adblock', newStatus);
  if (res.success) {
    updateAdBlockBtn(res.enabled);
  }
});

initAdBlockerStatus();

// --- 3. SETĂRI, ZOOM PER DOMENIU & SINCRONIZARE AUTOMATĂ ---
const defaultSettings = {
  homepage: 'https://google.com',
  showHomeBtn: true,
  showBookmarksBar: true,
  searchEngine: 'https://www.google.com/search?q=',
  defaultZoom: 100,
  syncUrl: '',
  syncId: '',
  syncKey: '',
  syncToken: '',
  autoSync: true
};

function getSettings() {
  try {
    const saved = localStorage.getItem('app-settings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  } catch (e) {
    return defaultSettings;
  }
}

function saveSettings(settings, triggerAutoPush = false) {
  localStorage.setItem('app-settings', JSON.stringify(settings));
  if (triggerAutoPush) {
    scheduleAutoPush();
  }
}

function getDomainZoomMap() {
  try {
    const raw = localStorage.getItem(DOMAIN_ZOOM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function getHostnameFromLocation(loc) {
  if (!loc) return null;
  try {
    const parsed = new URL(loc.startsWith('http') ? loc : `https://${loc}`);
    return parsed.hostname || null;
  } catch (e) {
    return null;
  }
}

function getSavedZoomForUrl(url) {
  const host = getHostnameFromLocation(url);
  if (!host) return null;
  const map = getDomainZoomMap();
  const val = map[host];
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function saveManualZoomForUrl(url, zoomPercent) {
  const host = getHostnameFromLocation(url);
  if (!host) return;
  const map = getDomainZoomMap();
  map[host] = Math.min(200, Math.max(50, zoomPercent));
  localStorage.setItem(DOMAIN_ZOOM_STORAGE_KEY, JSON.stringify(map));
}

function clearManualZoomForUrl(url) {
  const host = getHostnameFromLocation(url);
  if (!host) return;
  const map = getDomainZoomMap();
  if (Object.prototype.hasOwnProperty.call(map, host)) {
    delete map[host];
    localStorage.setItem(DOMAIN_ZOOM_STORAGE_KEY, JSON.stringify(map));
  }
}

function hasSyncConfigured(cfg = null) {
  const s = cfg || getSettings();
  return Boolean(s.autoSync && s.syncUrl && s.syncUrl.trim() && s.syncId && s.syncId.trim());
}

function scheduleAutoPush() {
  if (isApplyingRemoteSync) return;
  const s = getSettings();
  if (!hasSyncConfigured(s)) return;

  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    const latest = getSettings();
    if (!hasSyncConfigured(latest)) return;
    if (syncStatusMsg) syncStatusMsg.textContent = '⏳ Auto-sync...';
    const res = await ipcRenderer.invoke('sync-push', {
      endpointUrl: latest.syncUrl.trim(),
      syncId: latest.syncId.trim(),
      syncKey: latest.syncKey || '',
      syncToken: latest.syncToken || '',
      settings: latest
    });
    if (syncStatusMsg) {
      syncStatusMsg.textContent = res.success
        ? `✅ Auto-sync (${res.updatedAt || 'OK'})`
        : `❌ Auto-sync: ${res.error}`;
    }
  }, 1500);
}

async function runAutoPullOnStartup() {
  const s = getSettings();
  if (!hasSyncConfigured(s)) return;

  isApplyingRemoteSync = true;
  try {
    const res = await ipcRenderer.invoke('sync-pull', {
      endpointUrl: s.syncUrl.trim(),
      syncId: s.syncId.trim(),
      syncKey: s.syncKey || '',
      syncToken: s.syncToken || ''
    });

    if (res && res.success && !res.empty) {
      if (res.settings && typeof res.settings === 'object') {
        const merged = {
          ...defaultSettings,
          ...res.settings,
          syncUrl: s.syncUrl.trim(),
          syncId: s.syncId.trim(),
          syncKey: s.syncKey || res.settings.syncKey || '',
          syncToken: s.syncToken || res.settings.syncToken || '',
          autoSync: s.autoSync
        };
        localStorage.setItem('app-settings', JSON.stringify(merged));
        bookmarksBar.style.display = merged.showBookmarksBar ? 'flex' : 'none';
        document.querySelectorAll('.btn-home').forEach(btn => {
          btn.style.display = merged.showHomeBtn ? 'inline-block' : 'none';
        });
      }
      await renderBookmarks();
      if (syncStatusMsg) {
        syncStatusMsg.textContent = `✅ Pull la pornire (${res.updatedAt || 'OK'})`;
      }
    }
  } catch (e) {
    // Ignorăm erorile de rețea la pornire ca să nu blocăm deschiderea browserului
  } finally {
    isApplyingRemoteSync = false;
  }
}

// Modal Setări
const settingsModal = document.getElementById('settings-modal');
const closeModalBtn = document.querySelector('.close-modal');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const homepageInput = document.getElementById('homepage-input');
const showHomeBtnCheckbox = document.getElementById('show-home-btn');
const showBookmarksCheckbox = document.getElementById('show-bookmarks-bar');
const searchEngineSelect = document.getElementById('search-engine');
const defaultZoomInput = document.getElementById('default-zoom-input');

const syncUrlInput = document.getElementById('sync-url-input');
const syncIdInput = document.getElementById('sync-id-input');
const syncKeyInput = document.getElementById('sync-key-input');
const syncTokenInput = document.getElementById('sync-token-input');
const autoSyncCheckbox = document.getElementById('auto-sync-checkbox');
const syncPushBtn = document.getElementById('sync-push-btn');
const syncPullBtn = document.getElementById('sync-pull-btn');
const syncStatusMsg = document.getElementById('sync-status-msg');

settingsBtn.addEventListener('click', () => {
  const currentSettings = getSettings();
  homepageInput.value = currentSettings.homepage;
  showHomeBtnCheckbox.checked = currentSettings.showHomeBtn;
  showBookmarksCheckbox.checked = currentSettings.showBookmarksBar;
  searchEngineSelect.value = currentSettings.searchEngine;
  if (defaultZoomInput) defaultZoomInput.value = currentSettings.defaultZoom ?? 100;
  if (syncUrlInput) syncUrlInput.value = currentSettings.syncUrl || '';
  if (syncIdInput) syncIdInput.value = currentSettings.syncId || '';
  if (syncKeyInput) syncKeyInput.value = currentSettings.syncKey || '';
  if (syncTokenInput) syncTokenInput.value = currentSettings.syncToken || '';
  if (autoSyncCheckbox) autoSyncCheckbox.checked = currentSettings.autoSync !== false;
  if (syncStatusMsg) syncStatusMsg.textContent = '';
  if (mainToolbar) mainToolbar.classList.add('hidden');
  settingsModal.classList.add('active');
});

closeModalBtn.addEventListener('click', () => settingsModal.classList.remove('active'));

saveSettingsBtn.addEventListener('click', () => {
  const parsedZoom = defaultZoomInput ? parseInt(defaultZoomInput.value, 10) : 100;
  const safeZoom = Number.isFinite(parsedZoom) ? Math.min(200, Math.max(50, parsedZoom)) : 100;

  const newSettings = {
    homepage: homepageInput.value.trim() || 'https://google.com',
    showHomeBtn: showHomeBtnCheckbox.checked,
    showBookmarksBar: showBookmarksCheckbox.checked,
    searchEngine: searchEngineSelect.value,
    defaultZoom: safeZoom,
    syncUrl: syncUrlInput ? syncUrlInput.value.trim() : '',
    syncId: syncIdInput ? syncIdInput.value.trim() : '',
    syncKey: syncKeyInput ? syncKeyInput.value : '',
    syncToken: syncTokenInput ? syncTokenInput.value : '',
    autoSync: autoSyncCheckbox ? autoSyncCheckbox.checked : true
  };
  saveSettings(newSettings, true);
  settingsModal.classList.remove('active');

  document.querySelectorAll('.btn-home').forEach(btn => {
    btn.style.display = newSettings.showHomeBtn ? 'inline-block' : 'none';
  });
  bookmarksBar.style.display = newSettings.showBookmarksBar ? 'flex' : 'none';

  document.querySelectorAll('.pane').forEach(pane => {
    const wv = pane.querySelector('webview');
    const url = wv && typeof wv.getURL === 'function' && wv.getURL()
      ? wv.getURL()
      : (pane.querySelector('.pane-url')?.value || '');
    const customZoom = getSavedZoomForUrl(url);
    const effectiveZoom = customZoom ?? safeZoom;
    if (typeof pane._noxApplyZoomDirect === 'function') {
      pane._noxApplyZoomDirect(effectiveZoom);
    }
  });
});

function collectSyncConfigFromForm() {
  const saved = getSettings();
  return {
    endpointUrl: syncUrlInput ? syncUrlInput.value.trim() : saved.syncUrl,
    syncId: syncIdInput ? syncIdInput.value.trim() : saved.syncId,
    syncKey: syncKeyInput ? syncKeyInput.value : saved.syncKey,
    syncToken: syncTokenInput ? syncTokenInput.value : saved.syncToken
  };
}

if (syncPushBtn) {
  syncPushBtn.addEventListener('click', async () => {
    const cfg = collectSyncConfigFromForm();
    const currentSettings = {
      ...getSettings(),
      syncUrl: cfg.endpointUrl,
      syncId: cfg.syncId,
      syncKey: cfg.syncKey,
      syncToken: cfg.syncToken
    };
    saveSettings(currentSettings, false);
    if (syncStatusMsg) syncStatusMsg.textContent = 'Se trimite...';
    const res = await ipcRenderer.invoke('sync-push', {
      ...cfg,
      settings: currentSettings
    });
    if (syncStatusMsg) {
      syncStatusMsg.textContent = res.success
        ? `✅ Sincronizat (${res.updatedAt || 'OK'})`
        : `❌ ${res.error}`;
    }
  });
}

if (syncPullBtn) {
  syncPullBtn.addEventListener('click', async () => {
    const cfg = collectSyncConfigFromForm();
    if (syncStatusMsg) syncStatusMsg.textContent = 'Se preia...';
    isApplyingRemoteSync = true;
    try {
      const res = await ipcRenderer.invoke('sync-pull', cfg);
      if (!res.success) {
        if (syncStatusMsg) syncStatusMsg.textContent = `❌ ${res.error}`;
        return;
      }
      if (res.empty) {
        if (syncStatusMsg) syncStatusMsg.textContent = 'ℹ️ Nu există date salvate pe server pentru acest ID.';
        return;
      }
      if (res.settings && typeof res.settings === 'object') {
        const merged = {
          ...defaultSettings,
          ...res.settings,
          syncUrl: cfg.endpointUrl,
          syncId: cfg.syncId,
          syncKey: cfg.syncKey || res.settings.syncKey || '',
          syncToken: cfg.syncToken || res.settings.syncToken || ''
        };
        saveSettings(merged, false);
        bookmarksBar.style.display = merged.showBookmarksBar ? 'flex' : 'none';
        document.querySelectorAll('.btn-home').forEach(btn => {
          btn.style.display = merged.showHomeBtn ? 'inline-block' : 'none';
        });
      }
      await renderBookmarks();
      if (syncStatusMsg) {
        syncStatusMsg.textContent = `✅ Preluat (${res.updatedAt || 'OK'})`;
      }
    } finally {
      isApplyingRemoteSync = false;
    }
  });
}

// --- 4. TEMĂ ---
function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    themeToggleBtn.innerText = '☀️';
    themeToggleBtn.dataset.tooltip = 'Temă: Light (apasă pentru Dark)';
  } else {
    document.body.classList.remove('light-theme');
    themeToggleBtn.innerText = '🌙';
    themeToggleBtn.dataset.tooltip = 'Temă: Dark (apasă pentru Light)';
  }
}

applyTheme(localStorage.getItem('app-theme') || 'dark');

themeToggleBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light-theme');
  const newTheme = isLight ? 'light' : 'dark';
  applyTheme(newTheme);
  localStorage.setItem('app-theme', newTheme);
});

// --- 5. BARA DE MARCAJE CU FOLDERE ---
const addFolderBtn = document.getElementById('add-folder-btn');
const bookmarkPopover = document.getElementById('bookmark-popover');
const bmTitleInput = document.getElementById('bm-title-input');
const bmFolderSelect = document.getElementById('bm-folder-select');
const bmSaveBtn = document.getElementById('bm-save-btn');
const bmCancelBtn = document.getElementById('bm-cancel-btn');

const folderPopover = document.getElementById('folder-popover');
const newFolderNameInput = document.getElementById('new-folder-name-input');
const createFolderSaveBtn = document.getElementById('create-folder-save-btn');
const createFolderCancelBtn = document.getElementById('create-folder-cancel-btn');

let pendingBookmark = null;
let openFolderDropdown = null;

function closeFolderDropdown() {
  if (openFolderDropdown) {
    openFolderDropdown.remove();
    openFolderDropdown = null;
  }
}

document.addEventListener('click', (e) => {
  if (openFolderDropdown && !openFolderDropdown.contains(e.target) && !e.target.closest('.bookmark-folder-btn')) {
    closeFolderDropdown();
  }
  if (bookmarkPopover && !bookmarkPopover.classList.contains('hidden') && !bookmarkPopover.contains(e.target) && !e.target.closest('.btn-bookmark')) {
    bookmarkPopover.classList.add('hidden');
    pendingBookmark = null;
  }
  if (folderPopover && !folderPopover.classList.contains('hidden') && !folderPopover.contains(e.target) && e.target !== addFolderBtn) {
    folderPopover.classList.add('hidden');
  }
  if (mainToolbar && !mainToolbar.classList.contains('hidden') && !mainToolbar.contains(e.target) && e.target !== menuBtn) {
    mainToolbar.classList.add('hidden');
  }
});

if (addFolderBtn) {
  addFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeFolderDropdown();
    if (bookmarkPopover) bookmarkPopover.classList.add('hidden');
    if (!folderPopover) return;

    const rect = addFolderBtn.getBoundingClientRect();
    folderPopover.style.top = `${rect.top}px`;
    folderPopover.style.left = `${Math.max(10, rect.left - 280)}px`;
    newFolderNameInput.value = '';
    folderPopover.classList.remove('hidden');
    newFolderNameInput.focus();
  });
}

async function submitNewFolder() {
  if (!newFolderNameInput) return;
  const folderName = newFolderNameInput.value.trim();
  if (!folderName) return;
  const res = await ipcRenderer.invoke('create-bookmark-folder', folderName);
  if (res.success) {
    if (folderPopover) folderPopover.classList.add('hidden');
    await renderBookmarks();
    scheduleAutoPush();
  }
}

if (createFolderSaveBtn) {
  createFolderSaveBtn.addEventListener('click', submitNewFolder);
}

if (newFolderNameInput) {
  newFolderNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitNewFolder();
    if (e.key === 'Escape' && folderPopover) folderPopover.classList.add('hidden');
  });
}

if (createFolderCancelBtn) {
  createFolderCancelBtn.addEventListener('click', () => {
    if (folderPopover) folderPopover.classList.add('hidden');
  });
}

async function openBookmarkPopover(anchorEl, url, defaultTitle) {
  closeFolderDropdown();
  if (folderPopover) folderPopover.classList.add('hidden');
  if (!bookmarkPopover) return;

  pendingBookmark = { url, title: defaultTitle || url };
  const bookmarks = await ipcRenderer.invoke('get-bookmarks');
  const folders = bookmarks.filter(b => b.type === 'folder');

  if (bmTitleInput) bmTitleInput.value = pendingBookmark.title;
  if (bmFolderSelect) {
    bmFolderSelect.innerHTML = '<option value="">Bara de marcaje (rădăcină)</option>';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `📁 ${f.title}`;
      bmFolderSelect.appendChild(opt);
    });
  }

  const rect = anchorEl.getBoundingClientRect();
  bookmarkPopover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 170)}px`;
  bookmarkPopover.style.left = `${Math.max(10, Math.min(rect.left - 120, window.innerWidth - 280))}px`;
  bookmarkPopover.classList.remove('hidden');
  if (bmTitleInput) bmTitleInput.focus();
}

if (bmSaveBtn) {
  bmSaveBtn.addEventListener('click', async () => {
    if (!pendingBookmark) return;
    const title = bmTitleInput ? (bmTitleInput.value.trim() || pendingBookmark.url) : pendingBookmark.url;
    const folderId = bmFolderSelect ? (bmFolderSelect.value || null) : null;
    await ipcRenderer.invoke('add-bookmark', {
      url: pendingBookmark.url,
      title,
      folderId
    });
    if (bookmarkPopover) bookmarkPopover.classList.add('hidden');
    pendingBookmark = null;
    await renderBookmarks();
    scheduleAutoPush();
  });
}

if (bmCancelBtn) {
  bmCancelBtn.addEventListener('click', () => {
    if (bookmarkPopover) bookmarkPopover.classList.add('hidden');
    pendingBookmark = null;
  });
}

function toggleFolderMenu(folder, triggerEl) {
  const alreadyOpen = openFolderDropdown && openFolderDropdown.dataset.folderId === folder.id;
  closeFolderDropdown();
  if (alreadyOpen) return;

  const menu = document.createElement('div');
  menu.className = 'bookmark-folder-menu';
  menu.dataset.folderId = folder.id;

  const rect = triggerEl.getBoundingClientRect();
  menu.style.top = `${Math.min(rect.top, window.innerHeight - 240)}px`;
  menu.style.right = `${window.innerWidth - rect.left + 8}px`;

  if (!folder.items || folder.items.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'folder-empty';
    emptyEl.textContent = 'Folder gol';
    menu.appendChild(emptyEl);
  } else {
    folder.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'folder-entry';
      row.innerHTML = `
        <span class="folder-entry-title" title="${item.url}">🌐 ${item.title}</span>
        <span class="remove-bm" title="Șterge marcaj">&times;</span>
      `;
      row.querySelector('.folder-entry-title').addEventListener('click', () => {
        createTab(item.url);
        closeFolderDropdown();
      });
      row.querySelector('.remove-bm').addEventListener('click', async (e) => {
        e.stopPropagation();
        await ipcRenderer.invoke('remove-bookmark', { id: item.id, url: item.url, folderId: folder.id });
        await renderBookmarks();
        closeFolderDropdown();
        scheduleAutoPush();
      });
      menu.appendChild(row);
    });
  }

  const footer = document.createElement('div');
  footer.className = 'folder-menu-footer';
  footer.innerHTML = `<button type="button" class="delete-folder-btn">Șterge folderul</button>`;
  footer.querySelector('.delete-folder-btn').addEventListener('click', async () => {
    await ipcRenderer.invoke('delete-bookmark-folder', folder.id);
    closeFolderDropdown();
    await renderBookmarks();
    scheduleAutoPush();
  });
  menu.appendChild(footer);

  document.body.appendChild(menu);
  openFolderDropdown = menu;
}

async function renderBookmarks() {
  closeFolderDropdown();
  const bookmarks = await ipcRenderer.invoke('get-bookmarks');
  bookmarksContainer.innerHTML = '';

  if (bookmarks.length === 0) {
    bookmarksContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 11px; writing-mode: vertical-rl;">Fără marcaje</span>';
    return;
  }

  bookmarks.forEach(entry => {
    if (entry.type === 'folder') {
      const folderEl = document.createElement('div');
      folderEl.className = 'bookmark-item bookmark-folder-btn';
      folderEl.dataset.tooltip = `Folder: ${entry.title}`;
      folderEl.innerHTML = `<span>📁</span>`;

      folderEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        folderEl.classList.add('drag-over');
      });
      folderEl.addEventListener('dragleave', () => {
        folderEl.classList.remove('drag-over');
      });
      folderEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        folderEl.classList.remove('drag-over');
        const bmId = e.dataTransfer.getData('text/bookmark-id');
        if (bmId) {
          await ipcRenderer.invoke('move-bookmark-to-folder', { bookmarkId: bmId, targetFolderId: entry.id });
          await renderBookmarks();
          scheduleAutoPush();
        }
      });

      folderEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFolderMenu(entry, folderEl);
      });

      bookmarksContainer.appendChild(folderEl);
    } else {
      const bmEl = document.createElement('div');
      bmEl.className = 'bookmark-item';
      bmEl.draggable = true;
      bmEl.dataset.tooltip = `${entry.title} (${entry.url})`;
      const isLocal = entry.url.startsWith('/') || entry.url.match(/^[a-zA-Z]:\\/);

      bmEl.innerHTML = `
        <span>${isLocal ? '📂' : '🌐'}</span>
        <span class="remove-bm" title="Șterge marcaj">&times;</span>
      `;

      bmEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/bookmark-id', entry.id);
      });

      bmEl.addEventListener('click', (e) => {
        if (!e.target.classList.contains('remove-bm')) {
          createTab(entry.url);
        }
      });

      bmEl.querySelector('.remove-bm').addEventListener('click', async (e) => {
        e.stopPropagation();
        await ipcRenderer.invoke('remove-bookmark', { id: entry.id, url: entry.url, folderId: null });
        await renderBookmarks();
        scheduleAutoPush();
      });

      bookmarksContainer.appendChild(bmEl);
    }
  });
}

const initSettings = getSettings();
bookmarksBar.style.display = initSettings.showBookmarksBar ? 'flex' : 'none';
renderBookmarks();

// --- 6. TAB-URI & SPLIT GLOBAL ---
function getActiveTabId() {
  const activeTab = document.querySelector('.tab.active');
  return activeTab ? activeTab.dataset.tabId : null;
}

btnSplitVGlobal.addEventListener('click', () => {
  const activeTabId = getActiveTabId();
  if (activeTabId) addPane(activeTabId, 'vertical', getSettings().homepage);
});

btnSplitHGlobal.addEventListener('click', () => {
  const activeTabId = getActiveTabId();
  if (activeTabId) addPane(activeTabId, 'horizontal', getSettings().homepage);
});

function setTabTitle(tabId, title) {
  if (!tabId || !title) return;
  const cleanTitle = String(title).trim();
  if (!cleanTitle) return;

  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (tabEl) {
    tabEl.dataset.tooltip = cleanTitle;
    tabEl.title = cleanTitle;
  }

  const tabTitleEl = document.querySelector(`.tab[data-tab-id="${tabId}"] .tab-title`);
  if (tabTitleEl) {
    tabTitleEl.textContent = cleanTitle.slice(0, 2).toUpperCase();
    tabTitleEl.title = cleanTitle;
  }
}

function createTab(initialUrl = null) {
  tabCount++;
  const tabId = `tab-${tabCount}`;
  const settings = getSettings();
  const startUrl = initialUrl || settings.homepage;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tabId;
  tabEl.dataset.tooltip = `Tab ${tabCount}`;
  tabEl.innerHTML = `
    <span class="tab-title">T${tabCount}</span>
    <span class="close-btn">&times;</span>
  `;

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.id = tabId;
  contentEl.innerHTML = `<div class="split-container vertical"></div>`;

  tabsContainer.appendChild(tabEl);
  contentsContainer.appendChild(contentEl);

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-btn')) closeTab(tabId);
    else switchTab(tabId);
  });

  addPane(tabId, 'vertical', startUrl);
  switchTab(tabId);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const activeTab = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  const activeContent = document.getElementById(tabId);

  if (activeTab && activeContent) {
    activeTab.classList.add('active');
    activeContent.classList.add('active');
  }
}

function closeTab(tabId) {
  const tabEl = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  const contentEl = document.getElementById(tabId);
  if (tabEl) tabEl.remove();
  if (contentEl) contentEl.remove();

  const remainingTabs = document.querySelectorAll('.tab');
  if (remainingTabs.length > 0) {
    switchTab(remainingTabs[remainingTabs.length - 1].dataset.tabId);
  } else {
    createTab();
  }
}

// --- 7. SPLIT VIEW, PANOURI NAVIGARE & ZOOM ---
function addPane(tabId, orientation, targetPath) {
  const tabContent = document.getElementById(tabId);
  const splitContainer = tabContent.querySelector('.split-container');
  const settings = getSettings();

  if (orientation === 'horizontal') {
    splitContainer.classList.remove('vertical');
    splitContainer.classList.add('horizontal');
  } else if (orientation === 'vertical') {
    splitContainer.classList.remove('horizontal');
    splitContainer.classList.add('vertical');
  }

  const initialZoom = getSavedZoomForUrl(targetPath) ?? (settings.defaultZoom ?? 100);

  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.innerHTML = `
    <div class="pane-nav">
      <button class="btn-back" title="Înapoi">◄</button>
      <button class="btn-forward" title="Înainte">►</button>
      <button class="btn-reload" title="Reîncărcare (Refresh)">🔄</button>
      <button class="btn-home" style="display: ${settings.showHomeBtn ? 'inline-block' : 'none'};" title="Acasă">🏠</button>
      <div class="pane-zoom-group">
        <button type="button" class="btn-zoom-out" title="Micșorează (Zoom -)">-</button>
        <span class="pane-zoom-label">${initialZoom}%</span>
        <button type="button" class="btn-zoom-in" title="Mărește (Zoom +)">+</button>
        <button type="button" class="btn-zoom-reset" title="Resetează zoom">↺</button>
      </div>
      <input type="text" class="pane-url" value="${targetPath}" placeholder="Adresă web sau cale locală..." />
      <button class="btn-bookmark" title="Adaugă la Marcaje">⭐</button>
      <button class="btn-close-pane" title="Închide panou">✕</button>
    </div>
    <div class="pane-viewport"></div>
  `;

  splitContainer.appendChild(pane);

  pane.addEventListener('mousedown', () => {
    splitContainer.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    pane.classList.add('active');
  });

  const urlInput = pane.querySelector('.pane-url');
  const viewport = pane.querySelector('.pane-viewport');
  const btnHome = pane.querySelector('.btn-home');
  const btnBack = pane.querySelector('.btn-back');
  const btnForward = pane.querySelector('.btn-forward');
  const btnReload = pane.querySelector('.btn-reload');
  const btnBookmark = pane.querySelector('.btn-bookmark');
  const btnZoomOut = pane.querySelector('.btn-zoom-out');
  const btnZoomIn = pane.querySelector('.btn-zoom-in');
  const btnZoomReset = pane.querySelector('.btn-zoom-reset');
  const zoomLabel = pane.querySelector('.pane-zoom-label');

  let currentZoomPercent = initialZoom;

  function getCurrentTargetUrl() {
    const wv = viewport.querySelector('webview');
    if (wv && typeof wv.getURL === 'function' && wv.getURL()) {
      return wv.getURL();
    }
    return urlInput.value.trim();
  }

  function applyPaneZoom(percent, { persistManual = true } = {}) {
    currentZoomPercent = Math.min(200, Math.max(50, percent));
    if (zoomLabel) zoomLabel.textContent = `${currentZoomPercent}%`;

    const wv = viewport.querySelector('webview');
    if (wv && typeof wv.setZoomFactor === 'function') {
      wv.setZoomFactor(currentZoomPercent / 100);
    }

    if (persistManual) {
      saveManualZoomForUrl(getCurrentTargetUrl(), currentZoomPercent);
    }
  }

  function resetPaneZoomToDefault() {
    clearManualZoomForUrl(getCurrentTargetUrl());
    const defaultVal = getSettings().defaultZoom ?? 100;
    applyPaneZoom(defaultVal, { persistManual: false });
  }

  btnZoomOut?.addEventListener('click', () => applyPaneZoom(currentZoomPercent - 10));
  btnZoomIn?.addEventListener('click', () => applyPaneZoom(currentZoomPercent + 10));
  btnZoomReset?.addEventListener('click', () => resetPaneZoomToDefault());

  pane._noxZoomStep = (delta) => applyPaneZoom(currentZoomPercent + delta);
  pane._noxZoomReset = () => resetPaneZoomToDefault();
  pane._noxApplyZoomDirect = (percent) => applyPaneZoom(percent, { persistManual: false });

  const localHistory = [];
  let localHistoryIndex = -1;

  pane.querySelector('.btn-close-pane').addEventListener('click', () => {
    if (splitContainer.children.length > 1) pane.remove();
  });

  btnHome.addEventListener('click', () => {
    const curSettings = getSettings();
    urlInput.value = curSettings.homepage;
    loadLocation(curSettings.homepage);
  });

  btnBookmark.addEventListener('click', async (e) => {
    e.stopPropagation();
    const currentUrl = urlInput.value.trim();
    if (!currentUrl) return;

    let title = currentUrl;
    const webview = viewport.querySelector('webview');
    if (webview) {
      title = webview.getTitle() || currentUrl;
    } else {
      title = path.basename(currentUrl) || currentUrl;
    }

    openBookmarkPopover(btnBookmark, currentUrl, title);
  });

  btnReload.addEventListener('click', (e) => {
    const webview = viewport.querySelector('webview');
    if (webview) {
      if (e.shiftKey) {
        webview.reloadIgnoringCache();
      } else {
        webview.reload();
      }
    } else {
      loadLocation(urlInput.value.trim(), false);
    }
  });

  btnBack.addEventListener('click', () => {
    const webview = viewport.querySelector('webview');
    if (webview) {
      if (webview.canGoBack()) webview.goBack();
    } else if (localHistoryIndex > 0) {
      localHistoryIndex--;
      const prevPath = localHistory[localHistoryIndex];
      urlInput.value = prevPath;
      loadLocation(prevPath, false);
    }
  });

  btnForward.addEventListener('click', () => {
    const webview = viewport.querySelector('webview');
    if (webview) {
      if (webview.canGoForward()) webview.goForward();
    } else if (localHistoryIndex < localHistory.length - 1) {
      localHistoryIndex++;
      const nextPath = localHistory[localHistoryIndex];
      urlInput.value = nextPath;
      loadLocation(nextPath, false);
    }
  });

  async function loadLocation(loc, isNewNavigation = true) {
    loc = loc.trim();
    viewport.innerHTML = '';

    const isLocalPath = loc.startsWith('/') || loc.match(/^[a-zA-Z]:\\/) || loc.startsWith('file://');
    const isUrl = loc.includes('.') && !loc.includes(' ');

    if (!isLocalPath && !isUrl && !loc.startsWith('http://') && !loc.startsWith('https://')) {
      const curSettings = getSettings();
      loc = curSettings.searchEngine + encodeURIComponent(loc);
    }

    if (isLocalPath) {
      const cleanPath = loc.replace('file://', '');

      if (isNewNavigation) {
        if (localHistoryIndex < localHistory.length - 1) {
          localHistory.splice(localHistoryIndex + 1);
        }
        localHistory.push(cleanPath);
        localHistoryIndex = localHistory.length - 1;
      }

      try {
        const items = await ipcRenderer.invoke('read-dir', cleanPath);
        const fmContainer = document.createElement('div');
        fmContainer.className = 'file-manager';

        fmContainer.addEventListener('dragover', (e) => {
          e.preventDefault();
          fmContainer.style.background = 'var(--bg-tertiary)';
        });

        fmContainer.addEventListener('dragleave', () => {
          fmContainer.style.background = 'transparent';
        });

        fmContainer.addEventListener('drop', async (e) => {
          e.preventDefault();
          fmContainer.style.background = 'transparent';

          const srcPath = e.dataTransfer.getData('text/plain');
          if (srcPath && srcPath !== cleanPath) {
            const res = await ipcRenderer.invoke('move-file', { srcPath, destDir: cleanPath });
            if (res.success) {
              loadLocation(cleanPath, false);
            }
          }
        });

        const parentDir = path.dirname(cleanPath);
        if (parentDir !== cleanPath) {
          const upItem = document.createElement('div');
          upItem.className = 'file-item';
          upItem.innerHTML = `<div class="icon">📁</div><div>.. (Inapoi)</div>`;
          upItem.addEventListener('click', () => {
            urlInput.value = parentDir;
            loadLocation(parentDir);
          });
          fmContainer.appendChild(upItem);
        }

        items.forEach(item => {
          const itemEl = document.createElement('div');
          itemEl.className = 'file-item';
          itemEl.setAttribute('draggable', 'true');
          itemEl.innerHTML = `<div class="icon">${item.isDir ? '📁' : '📄'}</div><div>${item.name}</div>`;

          itemEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.path);
          });

          itemEl.addEventListener('dblclick', () => {
            if (item.isDir) {
              urlInput.value = item.path;
              loadLocation(item.path);
            }
          });

          fmContainer.appendChild(itemEl);
        });

        viewport.appendChild(fmContainer);
        const folderTitle = path.basename(cleanPath) || cleanPath;
        setTabTitle(tabId, `📁 ${folderTitle}`);

        ipcRenderer.invoke('add-history', {
          url: cleanPath,
          title: `📁 Folder: ${folderTitle}`
        });

      } catch (err) {
        viewport.innerHTML = `<div style="padding:20px; color:#e74c3c;">Eroare citire: ${err.message}</div>`;
      }

    } else {
      let webUrl = loc;
      if (!webUrl.startsWith('http://') && !webUrl.startsWith('https://')) {
        webUrl = 'https://' + webUrl;
      }
      urlInput.value = webUrl;

      const domainZoom = getSavedZoomForUrl(webUrl);
      currentZoomPercent = domainZoom ?? (getSettings().defaultZoom ?? 100);
      if (zoomLabel) zoomLabel.textContent = `${currentZoomPercent}%`;

      const webview = document.createElement('webview');
      webview.setAttribute('preload', path.join(__dirname, 'password-preload.js'));
      webview.src = webUrl;
      webview.setAttribute('allowpopups', '');
      viewport.appendChild(webview);

      webview.addEventListener('before-input-event', (event) => {
        const input = event.input;
        if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;

        const fakeEvent = {
          ctrlKey: Boolean(input.control),
          metaKey: Boolean(input.meta),
          altKey: Boolean(input.alt),
          key: input.key,
          code: input.code
        };
        handleZoomShortcut(fakeEvent);
      });

      webview.addEventListener('dom-ready', () => {
        const activeZoom = getSavedZoomForUrl(webview.getURL() || webUrl) ?? currentZoomPercent;
        currentZoomPercent = activeZoom;
        if (zoomLabel) zoomLabel.textContent = `${currentZoomPercent}%`;
        if (typeof webview.setZoomFactor === 'function') {
          webview.setZoomFactor(currentZoomPercent / 100);
        }

        webview
          .executeJavaScript(
            `
            if (!window.__noxWheelZoomBound) {
              window.__noxWheelZoomBound = true;
              window.addEventListener('wheel', (ev) => {
                if (ev.ctrlKey && ev.deltaY !== 0) {
                  ev.preventDefault();
                  console.debug('NOX_WHEEL_ZOOM:' + (ev.deltaY < 0 ? 'in' : 'out'));
                }
              }, { passive: false });
            }
          `,
            true
          )
          .catch(() => {});
      });

      webview.addEventListener('console-message', (e) => {
        if (typeof e.message === 'string' && e.message.startsWith('NOX_WHEEL_ZOOM:')) {
          const dir = e.message.split(':')[1];
          if (dir === 'in' && typeof pane._noxZoomStep === 'function') {
            pane._noxZoomStep(10);
          } else if (dir === 'out' && typeof pane._noxZoomStep === 'function') {
            pane._noxZoomStep(-10);
          }
        }
      });

      webview.addEventListener('new-window', (e) => {
        e.preventDefault();
        createTab(e.url);
      });

      webview.addEventListener('page-title-updated', (e) => {
        const pageUrl = webview.getURL();
        if (e.title) {
          setTabTitle(tabId, e.title);
        }
        if (pageUrl && !pageUrl.startsWith('data:')) {
          ipcRenderer.invoke('add-history', { url: pageUrl, title: e.title || pageUrl });
        }
      });

      webview.addEventListener('did-finish-load', async () => {
        const currentTitle = webview.getTitle();
        if (currentTitle) {
          setTabTitle(tabId, currentTitle);
        }
        try {
          const parsed = new URL(webview.getURL());
          if (parsed.hostname) {
            const matches = await ipcRenderer.invoke('get-passwords-for-domain', parsed.hostname);
            if (matches && matches.length > 0) {
              webview.send('autofill-credentials', matches);
            }
          }
        } catch (e) {}
      });

      webview.addEventListener('did-start-loading', () => {
        urlInput.value = webview.getURL();
      });

      webview.addEventListener('ipc-message', (event) => {
        if (event.channel === 'captured-password' && event.args && event.args[0]) {
          const cap = event.args[0];
          pendingPasswordCapture = cap;
          if (passwordPromptBar && passwordPromptText) {
            passwordPromptText.textContent = `Salvezi parola pentru ${cap.domain}${cap.username ? ` (${cap.username})` : ''}?`;
            passwordPromptBar.classList.remove('hidden');
          }
        }
      });
    }
  }

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadLocation(urlInput.value);
  });

  loadLocation(targetPath);
}

// --- 8. PAROLE & ISTORIC ---
if (pwdSaveConfirmBtn) {
  pwdSaveConfirmBtn.addEventListener('click', async () => {
    if (!pendingPasswordCapture) return;
    await ipcRenderer.invoke('save-password', pendingPasswordCapture);
    pendingPasswordCapture = null;
    if (passwordPromptBar) passwordPromptBar.classList.add('hidden');
    scheduleAutoPush();
  });
}

if (pwdSaveDismissBtn) {
  pwdSaveDismissBtn.addEventListener('click', () => {
    pendingPasswordCapture = null;
    if (passwordPromptBar) passwordPromptBar.classList.add('hidden');
  });
}

if (passwordsBtn) {
  passwordsBtn.addEventListener('click', async () => {
    const list = await ipcRenderer.invoke('get-passwords');
    tabCount++;
    const tabId = `tab-${tabCount}`;

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.tabId = tabId;
    tabEl.dataset.tooltip = 'Parole Salvate';
    tabEl.innerHTML = `<span class="tab-title">🔑</span><span class="close-btn">&times;</span>`;

    const contentEl = document.createElement('div');
    contentEl.className = 'tab-content';
    contentEl.id = tabId;

    const rowsHtml = list.map(item => `
      <tr data-id="${item.id}">
        <td>${item.domain}</td>
        <td>${item.username || '-'}</td>
        <td><span class="pwd-masked">••••••••</span><span class="pwd-plain" style="display:none; font-family:monospace;">${item.password}</span></td>
        <td>${item.updatedAt || ''}</td>
        <td>
          <button type="button" class="pwd-action-btn toggle-pwd-btn">👁️ Arată</button>
          <button type="button" class="pwd-action-btn copy-pwd-btn">📋 Copiază</button>
          <button type="button" class="pwd-action-btn danger del-pwd-btn">Șterge</button>
        </td>
      </tr>
    `).join('');

    contentEl.innerHTML = `
      <div style="padding: 20px; overflow-y: auto; height: 100%;">
        <h2 style="margin-bottom: 16px;">🔑 Parole Salvate (Criptate Local)</h2>
        <table class="passwords-table">
          <thead>
            <tr>
              <th>Domeniu</th>
              <th>Utilizator</th>
              <th>Parolă</th>
              <th>Actualizat</th>
              <th>Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="5">Nicio parolă salvată încă.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    tabsContainer.appendChild(tabEl);
    contentsContainer.appendChild(contentEl);

    contentEl.querySelectorAll('.toggle-pwd-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const masked = tr.querySelector('.pwd-masked');
        const plain = tr.querySelector('.pwd-plain');
        const showing = plain.style.display !== 'none';
        plain.style.display = showing ? 'none' : 'inline';
        masked.style.display = showing ? 'inline' : 'none';
        btn.textContent = showing ? '👁️ Arată' : '🙈 Ascunde';
      });
    });

    contentEl.querySelectorAll('.copy-pwd-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const plainText = tr.querySelector('.pwd-plain').textContent;
        clipboard.writeText(plainText);
        btn.textContent = '✅ Copiat';
        setTimeout(() => { btn.textContent = '📋 Copiază'; }, 1200);
      });
    });

    contentEl.querySelectorAll('.del-pwd-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const id = tr.dataset.id;
        await ipcRenderer.invoke('delete-password', id);
        tr.remove();
        scheduleAutoPush();
      });
    });

    tabEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('close-btn')) closeTab(tabId);
      else switchTab(tabId);
    });

    switchTab(tabId);
  });
}

historyBtn.addEventListener('click', async () => {
  const historyData = await ipcRenderer.invoke('get-history');

  tabCount++;
  const tabId = `tab-${tabCount}`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = tabId;
  tabEl.dataset.tooltip = 'Istoric Navigare';
  tabEl.innerHTML = `<span class="tab-title">📜</span><span class="close-btn">&times;</span>`;

  const contentEl = document.createElement('div');
  contentEl.className = 'tab-content';
  contentEl.id = tabId;

  let rowsHtml = historyData.map(item => `
    <div class="history-item">
      <span class="history-date">${item.date}</span>
      <a href="#" class="history-link" data-url="${item.url}">${item.title}</a>
      <span class="history-url">${item.url}</span>
    </div>
  `).join('');

  contentEl.innerHTML = `
    <div style="padding: 20px; overflow-y: auto; height: 100%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2>📜 Istoric Navigare</h2>
        <button id="clear-history-btn" style="padding: 6px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Șterge Istoricul</button>
      </div>
      <div class="history-list">${rowsHtml || '<p>Istoricul este gol.</p>'}</div>
    </div>
  `;

  tabsContainer.appendChild(tabEl);
  contentsContainer.appendChild(contentEl);

  contentEl.querySelectorAll('.history-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      createTab(link.dataset.url);
    });
  });

  const clearBtn = contentEl.querySelector('#clear-history-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('clear-history');
      contentEl.querySelector('.history-list').innerHTML = '<p>Istoricul este gol.</p>';
    });
  }

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('close-btn')) closeTab(tabId);
    else switchTab(tabId);
  });

  switchTab(tabId);
});

// PORNIRE AUTOMATĂ CU PAGINA DE START + AUTO-PULL
newTabBtn.addEventListener('click', () => createTab());
const startSettings = getSettings();
createTab(startSettings.homepage);
runAutoPullOnStartup();
