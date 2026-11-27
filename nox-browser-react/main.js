const { app, BrowserWindow, ipcMain, session, Menu, MenuItem, clipboard, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = require('cross-fetch');

const APP_ID = 'nox-browser';
app.setAppUserModelId(APP_ID);

let historyFilePath;
let bookmarksFilePath;
let passwordsFilePath;
let windowStateFilePath;
let adBlockerInstance = null;
let isAdBlockerEnabled = true;

let windowState = { width: 1400, height: 900, x: undefined, y: undefined, isMaximized: false };

// --- CRIPTARE PAROLE ---
function getFallbackKey() {
  const seed = `${APP_ID}:${app.getPath('userData')}:local-vault-key`;
  return crypto.scryptSync(seed, 'nox-salt-v1', 32);
}

function encryptSecret(plainText) {
  if (!plainText) return { mode: 'plain', data: '' };
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plainText);
      return { mode: 'safeStorage', data: buf.toString('base64') };
    }
  } catch (e) {}

  const key = getFallbackKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    mode: 'aes-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64')
  };
}

function decryptSecret(secretObj) {
  if (!secretObj) return '';
  if (typeof secretObj === 'string') return secretObj;

  try {
    if (secretObj.mode === 'safeStorage' && safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(secretObj.data, 'base64');
      return safeStorage.decryptString(buf);
    }
    if (secretObj.mode === 'aes-gcm') {
      const key = getFallbackKey();
      const iv = Buffer.from(secretObj.iv, 'base64');
      const tag = Buffer.from(secretObj.tag, 'base64');
      const enc = Buffer.from(secretObj.data, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }
    return secretObj.data || '';
  } catch (e) {
    return '';
  }
}

async function ensurePasswordsFile() {
  if (!passwordsFilePath) {
    passwordsFilePath = path.join(app.getPath('userData'), 'passwords.json');
  }
  if (!fs.existsSync(passwordsFilePath)) {
    await fs.promises.writeFile(passwordsFilePath, JSON.stringify([], null, 2));
  }
}

async function readPasswordsVault() {
  await ensurePasswordsFile();
  try {
    const raw = await fs.promises.readFile(passwordsFilePath, 'utf8');
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function writePasswordsVault(list) {
  await ensurePasswordsFile();
  await fs.promises.writeFile(passwordsFilePath, JSON.stringify(list, null, 2));
}

function normalizeBookmarks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    if (item && item.type === 'folder') {
      return {
        id: item.id || `fld-${Date.now()}-${idx}`,
        type: 'folder',
        title: item.title || 'Folder',
        items: Array.isArray(item.items)
          ? item.items.map((bm, bIdx) => ({
              id: bm.id || `bm-${Date.now()}-${idx}-${bIdx}`,
              title: bm.title || bm.url,
              url: bm.url
            }))
          : []
      };
    }
    return {
      id: item.id || `bm-${Date.now()}-${idx}`,
      type: 'bookmark',
      title: item.title || item.url,
      url: item.url
    };
  });
}

async function readNormalizedBookmarks() {
  const data = await fs.promises.readFile(bookmarksFilePath, 'utf8');
  return normalizeBookmarks(JSON.parse(data || '[]'));
}

async function writeNormalizedBookmarks(list) {
  await fs.promises.writeFile(bookmarksFilePath, JSON.stringify(list, null, 2));
}

function createWindow() {
  try {
    if (fs.existsSync(windowStateFilePath)) {
      windowState = JSON.parse(fs.readFileSync(windowStateFilePath, 'utf8'));
    }
  } catch (e) {
    console.error("Nu s-a putut citi starea ferestrei:", e);
  }

  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    title: "Nox Browser",
    icon: path.join(__dirname, 'build', 'icon.png'),
    wmClass: APP_ID,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  if (windowState.isMaximized) {
    win.maximize();
  }

  const saveWindowState = () => {
    if (!win.isMaximized() && !win.isMinimized()) {
      const bounds = win.getBounds();
      windowState.width = bounds.width;
      windowState.height = bounds.height;
      windowState.x = bounds.x;
      windowState.y = bounds.y;
    }
    windowState.isMaximized = win.isMaximized();
    try {
      fs.writeFileSync(windowStateFilePath, JSON.stringify(windowState));
    } catch (e) {}
  };

  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  win.on('close', saveWindowState);

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'geolocation', 'notifications', 'fullscreen', 'pointerLock'];
    callback(allowedPermissions.includes(permission));
  });

  win.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media';
  });

  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Tunde (Cut)', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copiază (Copy)', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Lipește (Paste)', role: 'paste' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Selectează tot', role: 'selectAll' }));
    } else {
      if (params.selectionText) {
        menu.append(new MenuItem({ label: 'Copiază (Copy)', role: 'copy' }));
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({ label: 'Lipește (Paste)', role: 'paste' }));
      menu.append(new MenuItem({ label: 'Reîncarcă pagina', role: 'reload' }));
    }
    menu.popup({ window: win });
  });

  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  win.loadFile('index.html');
  win.setMenuBarVisibility(false);
}

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('open-in-new-tab', url);
      }
      return { action: 'deny' };
    });

    contents.on('context-menu', (e, params) => {
      const menu = new Menu();
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Tunde (Cut)', role: 'cut' }));
        menu.append(new MenuItem({ label: 'Copiază (Copy)', role: 'copy' }));
        menu.append(new MenuItem({ label: 'Lipește (Paste)', role: 'paste' }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Selectează tot', role: 'selectAll' }));
      } else {
        if (params.selectionText) {
          menu.append(new MenuItem({ label: 'Copiază (Copy)', role: 'copy' }));
        }
        if (params.linkURL) {
          menu.append(new MenuItem({
            label: 'Deschide link în tab nou',
            click: () => {
              const mainWindow = BrowserWindow.getAllWindows()[0];
              if (mainWindow) mainWindow.webContents.send('open-in-new-tab', params.linkURL);
            }
          }));
          menu.append(new MenuItem({
            label: 'Copiază adresa link-ului',
            click: () => { clipboard.writeText(params.linkURL); }
          }));
        }
        menu.append(new MenuItem({ label: 'Lipește (Paste)', role: 'paste' }));
      }
      menu.popup();
    });
  }
});

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  historyFilePath = path.join(userDataPath, 'history.json');
  bookmarksFilePath = path.join(userDataPath, 'bookmarks.json');
  passwordsFilePath = path.join(userDataPath, 'passwords.json');
  windowStateFilePath = path.join(userDataPath, 'window-state.json');

  if (!fs.existsSync(historyFilePath)) fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2));
  if (!fs.existsSync(bookmarksFilePath)) fs.writeFileSync(bookmarksFilePath, JSON.stringify([], null, 2));
  if (!fs.existsSync(passwordsFilePath)) fs.writeFileSync(passwordsFilePath, JSON.stringify([], null, 2));

  try {
    adBlockerInstance = await ElectronBlocker.fromPrebuiltFull(fetch);
    adBlockerInstance.enableBlockingInSession(session.defaultSession);
    isAdBlockerEnabled = true;
  } catch (err) {
    console.error("Eroare la încărcarea AdBlocker:", err);
  }

  createWindow();
});

// HANDLERE IPC AD-BLOCKER & MANAGER FIȘIERE
ipcMain.handle('get-adblock-status', () => isAdBlockerEnabled);

ipcMain.handle('toggle-adblock', (event, enable) => {
  if (!adBlockerInstance) return { success: false, enabled: false };
  if (enable) adBlockerInstance.enableBlockingInSession(session.defaultSession);
  else adBlockerInstance.disableBlockingInSession(session.defaultSession);
  isAdBlockerEnabled = enable;
  return { success: true, enabled: isAdBlockerEnabled };
});

ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return items.map(item => ({
      name: item.name,
      isDir: item.isDirectory(),
      path: path.join(dirPath, item.name)
    }));
  } catch (err) {
    throw new Error(err.message);
  }
});

ipcMain.handle('move-file', async (event, { srcPath, destDir }) => {
  try {
    const fileName = path.basename(srcPath);
    const destPath = path.join(destDir, fileName);
    if (srcPath === destPath) return { success: true };
    await fs.promises.rename(srcPath, destPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ISTORIC
ipcMain.handle('add-history', async (event, entry) => {
  try {
    const data = await fs.promises.readFile(historyFilePath, 'utf8');
    const history = JSON.parse(data || '[]');
    history.unshift({ url: entry.url, title: entry.title || entry.url, date: new Date().toLocaleString('ro-RO') });
    await fs.promises.writeFile(historyFilePath, JSON.stringify(history.slice(0, 500), null, 2));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('get-history', async () => {
  try { return JSON.parse(await fs.promises.readFile(historyFilePath, 'utf8') || '[]'); }
  catch (err) { return []; }
});

ipcMain.handle('clear-history', async () => {
  try { await fs.promises.writeFile(historyFilePath, JSON.stringify([], null, 2)); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

// MARCAJE & FOLDERE
ipcMain.handle('get-bookmarks', async () => {
  try {
    return await readNormalizedBookmarks();
  } catch (err) {
    return [];
  }
});

ipcMain.handle('create-bookmark-folder', async (event, title) => {
  try {
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return { success: false, error: 'Numele folderului este gol.' };
    const bookmarks = await readNormalizedBookmarks();
    bookmarks.push({
      id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'folder',
      title: cleanTitle,
      items: []
    });
    await writeNormalizedBookmarks(bookmarks);
    return { success: true, bookmarks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('add-bookmark', async (event, { url, title, folderId = null }) => {
  try {
    if (!url) return { success: false, error: 'URL lipsă.' };
    const bookmarks = await readNormalizedBookmarks();
    const entry = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: (title || url).trim(),
      url: url.trim()
    };

    if (folderId) {
      const folder = bookmarks.find(b => b.type === 'folder' && b.id === folderId);
      if (!folder) return { success: false, error: 'Folderul nu există.' };
      if (!folder.items.some(item => item.url === entry.url)) {
        folder.items.push(entry);
      }
    } else {
      if (!bookmarks.some(item => item.type === 'bookmark' && item.url === entry.url)) {
        bookmarks.push({ ...entry, type: 'bookmark' });
      }
    }

    await writeNormalizedBookmarks(bookmarks);
    return { success: true, bookmarks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('move-bookmark-to-folder', async (event, { bookmarkId, targetFolderId }) => {
  try {
    const bookmarks = await readNormalizedBookmarks();
    const bmIndex = bookmarks.findIndex(b => b.type === 'bookmark' && b.id === bookmarkId);
    if (bmIndex === -1) return { success: false, error: 'Marcajul nu a fost găsit.' };

    const targetFolder = bookmarks.find(b => b.type === 'folder' && b.id === targetFolderId);
    if (!targetFolder) return { success: false, error: 'Folderul destinație nu există.' };

    const [moved] = bookmarks.splice(bmIndex, 1);
    if (!targetFolder.items.some(item => item.url === moved.url)) {
      targetFolder.items.push({ id: moved.id, title: moved.title, url: moved.url });
    }

    await writeNormalizedBookmarks(bookmarks);
    return { success: true, bookmarks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('remove-bookmark', async (event, payload) => {
  try {
    const { id, url, folderId = null } = typeof payload === 'string' ? { url: payload } : (payload || {});
    let bookmarks = await readNormalizedBookmarks();
    if (folderId) {
      const folder = bookmarks.find(b => b.type === 'folder' && b.id === folderId);
      if (folder) {
        folder.items = folder.items.filter(item => (id ? item.id !== id : item.url !== url));
      }
    } else {
      bookmarks = bookmarks.filter(item => {
        if (item.type !== 'bookmark') return true;
        return id ? item.id !== id : item.url !== url;
      });
    }
    await writeNormalizedBookmarks(bookmarks);
    return { success: true, bookmarks };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-bookmark-folder', async (event, folderId) => {
  try {
    const bookmarks = await readNormalizedBookmarks();
    const updated = bookmarks.filter(item => !(item.type === 'folder' && item.id === folderId));
    await writeNormalizedBookmarks(updated);
    return { success: true, bookmarks: updated };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// PAROLE (SEIF CRIPTAT LOCAL)
ipcMain.handle('get-passwords', async () => {
  try {
    const vault = await readPasswordsVault();
    return vault.map(item => ({
      id: item.id,
      domain: item.domain,
      username: item.username || '',
      password: decryptSecret(item.secret),
      updatedAt: item.updatedAt || ''
    }));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('get-passwords-for-domain', async (event, domain) => {
  try {
    if (!domain) return [];
    const cleanDomain = String(domain).toLowerCase().replace(/^www\./, '');
    const vault = await readPasswordsVault();
    return vault
      .filter(item => {
        const itemDomain = String(item.domain || '').toLowerCase().replace(/^www\./, '');
        return itemDomain === cleanDomain || cleanDomain.endsWith('.' + itemDomain);
      })
      .map(item => ({
        id: item.id,
        domain: item.domain,
        username: item.username || '',
        password: decryptSecret(item.secret)
      }));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('save-password', async (event, { domain, username, password }) => {
  try {
    const cleanDomain = (domain || '').trim();
    const cleanUser = (username || '').trim();
    if (!cleanDomain || !password) {
      return { success: false, error: 'Domeniul și parola sunt obligatorii.' };
    }

    const vault = await readPasswordsVault();
    const existingIdx = vault.findIndex(
      item => item.domain.toLowerCase() === cleanDomain.toLowerCase() && (item.username || '') === cleanUser
    );

    const record = {
      id: existingIdx >= 0 ? vault[existingIdx].id : `pwd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      domain: cleanDomain,
      username: cleanUser,
      secret: encryptSecret(password),
      updatedAt: new Date().toLocaleString('ro-RO')
    };

    if (existingIdx >= 0) {
      vault[existingIdx] = record;
    } else {
      vault.unshift(record);
    }

    await writePasswordsVault(vault);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-password', async (event, id) => {
  try {
    const vault = await readPasswordsVault();
    const filtered = vault.filter(item => item.id !== id);
    await writePasswordsVault(filtered);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- SINCRONIZARE PHP/MYSQL ---
function deriveSyncKey(syncKeyText, syncId) {
  return crypto.scryptSync(`${syncKeyText}:${syncId}`, 'nox-sync-salt-v1', 32);
}

function encryptSyncPasswords(plainPasswordsArray, syncKeyText, syncId) {
  if (!syncKeyText) {
    return { encrypted: false, items: plainPasswordsArray };
  }
  const key = deriveSyncKey(syncKeyText, syncId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(plainPasswordsArray || []);
  const enc = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: true,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64')
  };
}

function decryptSyncPasswords(bundle, syncKeyText, syncId) {
  if (!bundle) return [];
  if (!bundle.encrypted) {
    return Array.isArray(bundle.items) ? bundle.items : (Array.isArray(bundle) ? bundle : []);
  }
  if (!syncKeyText) {
    throw new Error('Cheia de sincronizare (Sync Key) este necesară pentru a decripta parolele.');
  }
  const key = deriveSyncKey(syncKeyText, syncId);
  const iv = Buffer.from(bundle.iv, 'base64');
  const tag = Buffer.from(bundle.tag, 'base64');
  const enc = Buffer.from(bundle.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decStr = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(decStr || '[]');
  return Array.isArray(parsed) ? parsed : [];
}

ipcMain.handle('sync-push', async (event, { endpointUrl, syncId, syncKey, syncToken, settings }) => {
  try {
    const cleanUrl = (endpointUrl || '').trim();
    const cleanId = (syncId || '').trim();
    if (!cleanUrl || !cleanId) {
      return { success: false, error: 'Completează URL-ul endpoint-ului PHP și ID-ul de sincronizare.' };
    }

    const bookmarks = await readNormalizedBookmarks();
    const vault = await readPasswordsVault();
    const plainPasswords = vault.map(item => ({
      id: item.id,
      domain: item.domain,
      username: item.username || '',
      password: decryptSecret(item.secret),
      updatedAt: item.updatedAt || ''
    }));

    const passwordsPayload = encryptSyncPasswords(plainPasswords, (syncKey || '').trim(), cleanId);

    const headers = { 'Content-Type': 'application/json' };
    if (syncToken && syncToken.trim()) {
      headers['X-Sync-Token'] = syncToken.trim();
    }

    const resp = await fetch(cleanUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sync_id: cleanId,
        bookmarks,
        settings: settings || {},
        passwords: passwordsPayload
      })
    });

    const result = await resp.json();
    if (!resp.ok || !result.success) {
      return { success: false, error: result.error || `HTTP ${resp.status}` };
    }

    return { success: true, updatedAt: result.updatedAt };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync-pull', async (event, { endpointUrl, syncId, syncKey, syncToken }) => {
  try {
    const cleanUrl = (endpointUrl || '').trim();
    const cleanId = (syncId || '').trim();
    if (!cleanUrl || !cleanId) {
      return { success: false, error: 'Completează URL-ul endpoint-ului PHP și ID-ul de sincronizare.' };
    }

    const sep = cleanUrl.includes('?') ? '&' : '?';
    const urlWithQuery = `${cleanUrl}${sep}sync_id=${encodeURIComponent(cleanId)}`;
    const headers = {};
    if (syncToken && syncToken.trim()) {
      headers['X-Sync-Token'] = syncToken.trim();
    }

    const resp = await fetch(urlWithQuery, { method: 'GET', headers });
    const result = await resp.json();
    if (!resp.ok || !result.success) {
      return { success: false, error: result.error || `HTTP ${resp.status}` };
    }

    if (!result.exists || !result.data) {
      return { success: true, empty: true };
    }

    const pulledBookmarks = normalizeBookmarks(result.data.bookmarks || []);
    await writeNormalizedBookmarks(pulledBookmarks);

    const pulledPasswords = decryptSyncPasswords(result.data.passwords, (syncKey || '').trim(), cleanId);
    const reEncryptedVault = pulledPasswords.map((item, idx) => ({
      id: item.id || `pwd-${Date.now()}-${idx}`,
      domain: item.domain,
      username: item.username || '',
      secret: encryptSecret(item.password || ''),
      updatedAt: item.updatedAt || new Date().toLocaleString('ro-RO')
    }));
    await writePasswordsVault(reEncryptedVault);

    return {
      success: true,
      empty: false,
      settings: result.data.settings || null,
      updatedAt: result.data.updatedAt || null
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
