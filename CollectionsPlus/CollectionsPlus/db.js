// db.js — SQLite database layer via sql.js (WASM)
// Persists to a user-chosen .db file via the File System Access API.
// File handle is stored in IndexedDB so it survives popup close/reopen.

const IDB_NAME        = 'collections-plus-meta';
const IDB_STORE       = 'handles';
const IDB_KEY         = 'dbFileHandle';
const IDB_BACKUP_KEY  = 'backupFileHandle';
const IDB_BACKUP_TS   = 'lastBackupTimestamp';
const DB_FILENAME     = 'collections.db';
const BACKUP_FILENAME = 'backup.db';

export class CollectionsDB {
  constructor() {
    this.SQL          = null;   // sql.js module
    this.db           = null;   // sql.js Database instance
    this.fileHandle   = null;   // FileSystemFileHandle (local db)
    this.backupHandle = null;   // FileSystemFileHandle (OneDrive backup)
  }

  // ─────────────────────────────────────────────
  // Bootstrap
  // ─────────────────────────────────────────────

  /**
   * Call once on popup open.
   * Returns { status: 'ready' } or { status: 'setup_required' }
   */
  async init() {
    // Load sql.js — initSqlJs is injected globally via sql-wasm.js script tag
    this.SQL = await initSqlJs({
      locateFile: (file) => chrome.runtime.getURL(file)
    });

    // Try to recover a stored file handle from IndexedDB
    const handle = await this._idbGet(IDB_KEY);
    if (handle) {
      this.fileHandle = handle;
      // Check existing permission without prompting
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await this._loadFromHandle();
        return { status: 'ready' };
      }
      // Permission needs a user gesture to request — signal the UI to show unlock button
      return { status: 'permission_required' };
    }

    return { status: 'setup_required' };
  }

  // Called when user clicks the unlock button — has user gesture
  async requestPermissionAndLoad() {
    const perm = await this.fileHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      await this._loadFromHandle();
      return true;
    }
    return false;
  }

  /**
   * First-run setup: user picks a directory, we create collections.db there.
   */
  async setupWithDirectory(dirHandle) {
    this.fileHandle = await dirHandle.getFileHandle(DB_FILENAME, { create: true });
    await this._idbSet(IDB_KEY, this.fileHandle);

    const file = await this.fileHandle.getFile();
    if (file.size > 0) {
      await this._loadFromHandle();
    } else {
      this.db = new this.SQL.Database();
      this._applySchema();
      this._seedMeta();
      await this.save();
    }
  }

  // ─────────────────────────────────────────────
  // Schema
  // ─────────────────────────────────────────────

  _applySchema() {
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS collections (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        colour      TEXT    NOT NULL DEFAULT '#e8963c',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id   INTEGER NOT NULL,
        type            TEXT    NOT NULL DEFAULT 'page',
        url             TEXT             DEFAULT '',
        title           TEXT             DEFAULT '',
        content         TEXT             DEFAULT '',
        notes           TEXT    NOT NULL DEFAULT '',
        thumbnail       TEXT             DEFAULT NULL,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        last_visited_at INTEGER          DEFAULT NULL,
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        action     TEXT    NOT NULL,
        success    INTEGER NOT NULL DEFAULT 1,
        detail     TEXT             DEFAULT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  // ─────────────────────────────────────────────
  // Collections
  // ─────────────────────────────────────────────

  getCollections() {
    const stmt = this.db.prepare(`
      SELECT c.id, c.name, c.description, c.colour, c.sort_order,
             c.created_at, c.updated_at,
             COUNT(i.id) AS item_count
      FROM   collections c
      LEFT JOIN items i ON i.collection_id = c.id
      GROUP  BY c.id
      ORDER  BY c.sort_order ASC, c.created_at ASC
    `);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  getCollection(id) {
    const stmt = this.db.prepare('SELECT * FROM collections WHERE id = ?');
    stmt.bind([id]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  createCollection(name, description = '', colour = '#e8963c') {
    const res = this.db.exec('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM collections');
    const order = res[0]?.values[0][0] ?? 1;
    this.db.run(
      'INSERT INTO collections (name, description, colour, sort_order) VALUES (?,?,?,?)',
      [name, description, colour, order]
    );
    return this.db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
  }

  updateCollection(id, name, description, colour) {
    this.db.run(
      `UPDATE collections
       SET name=?, description=?, colour=?, updated_at=strftime('%s','now')
       WHERE id=?`,
      [name, description, colour, id]
    );
  }

  deleteCollection(id) {
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run('DELETE FROM collections WHERE id=?', [id]);
  }

  moveCollectionUp(id) {
    this._swapOrder('collections', id, 'up', null);
  }

  moveCollectionDown(id) {
    this._swapOrder('collections', id, 'down', null);
  }

  // Direct swap by ID — used by drag and drop
  swapCollectionOrder(idA, idB) {
    const resA = this.db.exec(`SELECT sort_order FROM collections WHERE id=${idA}`);
    const resB = this.db.exec(`SELECT sort_order FROM collections WHERE id=${idB}`);
    if (!resA[0]?.values[0] || !resB[0]?.values[0]) return;
    const orderA = resA[0].values[0][0];
    const orderB = resB[0].values[0][0];
    const tmp = -orderA - 1;
    this.db.run(`UPDATE collections SET sort_order=? WHERE id=?`, [tmp,    idA]);
    this.db.run(`UPDATE collections SET sort_order=? WHERE id=?`, [orderA, idB]);
    this.db.run(`UPDATE collections SET sort_order=? WHERE id=?`, [orderB, idA]);
  }

  // ─────────────────────────────────────────────
  // Items
  // ─────────────────────────────────────────────

  getItems(collectionId) {
    const stmt = this.db.prepare(`
      SELECT * FROM items
      WHERE  collection_id = ?
      ORDER  BY sort_order ASC, created_at ASC
    `);
    stmt.bind([collectionId]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  getItem(id) {
    const stmt = this.db.prepare('SELECT * FROM items WHERE id=?');
    stmt.bind([id]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  }

  addItem(collectionId, { type = 'page', url = '', title = '', content = '', notes = '', thumbnail = null }) {
    const res = this.db.exec(
      `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM items WHERE collection_id=${collectionId}`
    );
    const order = res[0]?.values[0][0] ?? 1;
    this.db.run(
      'INSERT INTO items (collection_id,type,url,title,content,notes,thumbnail,sort_order) VALUES (?,?,?,?,?,?,?,?)',
      [collectionId, type, url, title, content, notes, thumbnail, order]
    );
    // bump collection updated_at
    this.db.run(`UPDATE collections SET updated_at=strftime('%s','now') WHERE id=?`, [collectionId]);
    return this.db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
  }

  updateItem(id, { title, url, notes, content }) {
    this.db.run(
      'UPDATE items SET title=?, url=?, notes=?, content=? WHERE id=?',
      [title, url, notes, content, id]
    );
  }

  deleteItem(id) {
    this.db.run('DELETE FROM items WHERE id=?', [id]);
  }

  moveItemUp(id) {
    const item = this.getItem(id);
    if (item) this._swapOrder('items', id, 'up', item.collection_id);
  }

  moveItemDown(id) {
    const item = this.getItem(id);
    if (item) this._swapOrder('items', id, 'down', item.collection_id);
  }

  markVisited(id) {
    this.db.run(`UPDATE items SET last_visited_at=strftime('%s','now') WHERE id=?`, [id]);
  }

  // ─────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────

  async save() {
    if (!this.fileHandle || !this.db) return;
    const data = this.db.export();           // Uint8Array
    const writable = await this.fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  // ─────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // Backup & Restore
  // ─────────────────────────────────────────────

  /**
   * Returns info about the stored backup handle without requesting permission.
   * { hasHandle, permissionState, lastBackupTs }
   */
  async getBackupInfo() {
    const handle = await this._idbGet(IDB_BACKUP_KEY);
    const lastBackupTs = await this._idbGet(IDB_BACKUP_TS);
    if (!handle) return { hasHandle: false, permissionState: null, lastBackupTs: null };
    const permissionState = await handle.queryPermission({ mode: 'readwrite' });
    this.backupHandle = handle;
    return { hasHandle: true, permissionState, lastBackupTs: lastBackupTs ?? null };
  }

  /**
   * User picks the OneDrive backup folder. Creates/overwrites backup.db immediately.
   * Must be called from a user gesture.
   */
  async setupBackupFolder() {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    this.backupHandle = await dirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
    await this._idbSet(IDB_BACKUP_KEY, this.backupHandle);
    await this._writeBackup();
    this.addLog('backup_folder_set', true);
    await this.save();
    return true;
  }

  /**
   * Backs up local db to the OneDrive backup file.
   * Requests permission if needed — must be called from a user gesture.
   */
  async backup() {
    if (!this.backupHandle) {
      this.backupHandle = await this._idbGet(IDB_BACKUP_KEY);
    }
    if (!this.backupHandle) throw new Error('No backup location set. Choose a folder first.');

    let perm = await this.backupHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await this.backupHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') {
      this.addLog('backup', false, 'Permission denied');
      await this.save();
      throw new Error('Permission denied to backup location.');
    }

    try {
      await this._writeBackup();
      this.addLog('backup', true);
      await this.save();
    } catch (err) {
      this.addLog('backup', false, err.message);
      await this.save();
      throw err;
    }
  }

  /**
   * Returns metadata about the backup file so the UI can show the user
   * what they're about to restore from. Does not load anything yet.
   * Must be called from a user gesture (to request permission if needed).
   */
  async getRestoreInfo() {
    if (!this.backupHandle) {
      this.backupHandle = await this._idbGet(IDB_BACKUP_KEY);
    }
    if (!this.backupHandle) throw new Error('No backup location set.');

    let perm = await this.backupHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await this.backupHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') throw new Error('Permission denied to backup location.');

    const file = await this.backupHandle.getFile();
    return {
      lastModified: file.lastModified,   // ms epoch
      size: file.size
    };
  }

  /**
   * Overwrites local db with backup file contents and reloads.
   * Call getRestoreInfo first and confirm with the user before calling this.
   */
  async restore() {
    if (!this.backupHandle) throw new Error('No backup handle available.');
    try {
      const file   = await this.backupHandle.getFile();
      const buffer = await file.arrayBuffer();
      const data   = new Uint8Array(buffer);

      if (this.db) this.db.close();
      this.db = new this.SQL.Database(data);
      this._applySchema();
      this.db.run('PRAGMA foreign_keys = ON;');

      this.addLog('restore', true);
      await this.save();
    } catch (err) {
      this.addLog('restore', false, err.message);
      await this.save();
      throw err;
    }
  }

  async _writeBackup() {
    const data     = this.db.export();
    const writable = await this.backupHandle.createWritable();
    await writable.write(data);
    await writable.close();
    const ts = Date.now();
    await this._idbSet(IDB_BACKUP_TS, ts);
    return ts;
  }

  

  // ─────────────────────────────────────────────
  // Import from Edge Collections
  // ─────────────────────────────────────────────

  /**
   * Opens the Edge collectionsSQLite file and returns a preview without
   * writing anything. Call importFromEdgeConfirm() to actually import.
   * showOpenFilePicker must be called OUTSIDE this method (in the click
   * handler directly) to preserve the user gesture token.
   * Pass the ArrayBuffer from the picked file.
   */
  async importFromEdgePreview(buffer) {
    const edgeDb = new this.SQL.Database(new Uint8Array(buffer));

    // Verify it looks like an Edge Collections db
    const tables = edgeDb.exec(`SELECT name FROM sqlite_master WHERE type='table'`);
    const tableNames = tables[0]?.values.map(r => r[0]) ?? [];
    if (!tableNames.includes('collections') || !tableNames.includes('items')) {
      edgeDb.close();
      throw new Error('This does not appear to be an Edge Collections database file.');
    }

    // Count what we'd import
    const colCount  = edgeDb.exec(`SELECT COUNT(*) FROM collections WHERE is_marked_for_deletion != 1 OR is_marked_for_deletion IS NULL`);
    const itemCount = edgeDb.exec(`SELECT COUNT(*) FROM items WHERE is_marked_for_deletion != 1 OR is_marked_for_deletion IS NULL`);

    const preview = {
      collectionCount: colCount[0]?.values[0][0] ?? 0,
      itemCount:       itemCount[0]?.values[0][0] ?? 0,
      buffer
    };

    edgeDb.close();
    return preview;
  }

  /**
   * Performs the actual import using the buffer from importFromEdgePreview.
   * Returns { collectionsImported, itemsImported, skipped }
   */
  async importFromEdgeConfirm(buffer) {
    const edgeDb = new this.SQL.Database(new Uint8Array(buffer));

    // ── 1. Load all collections ───────────────────────────
    const edgeCollections = edgeDb.exec(`
      SELECT id, title, position, date_created
      FROM   collections
      WHERE  is_marked_for_deletion != 1 OR is_marked_for_deletion IS NULL
      ORDER  BY position ASC
    `);

    let collectionsImported = 0;
    let itemsImported       = 0;
    let skipped             = 0;

    if (!edgeCollections[0]) {
      edgeDb.close();
      return { collectionsImported, itemsImported, skipped };
    }

    const colCols = edgeCollections[0].columns;
    const colRows = edgeCollections[0].values;

    for (const colRow of colRows) {
      const edgeCol = Object.fromEntries(colCols.map((c, i) => [c, colRow[i]]));

      // Create collection, or find existing one with same name
      const existing = this.db.exec(
        `SELECT id FROM collections WHERE name = ? LIMIT 1`,
        [edgeCol.title]
      );

      let ourCollectionId;
      if (existing[0]?.values[0]) {
        ourCollectionId = existing[0].values[0][0];
      } else {
        ourCollectionId = this.createCollection(
          edgeCol.title,
          '',
          '#e8963c'
        );
        // Override created_at with Edge's date if available
        if (edgeCol.date_created) {
          const ts = Math.round(edgeCol.date_created);
          this.db.run(`UPDATE collections SET created_at=?, updated_at=? WHERE id=?`,
            [ts, ts, ourCollectionId]);
        }
        collectionsImported++;
      }

      // ── 2. Load items for this collection ────────────────
      const edgeItems = edgeDb.exec(`
        SELECT i.id, i.title, i.remote_url, i.text_content,
               i.canonical_image_data, i.type, i.date_created
        FROM   items i
        JOIN   collections_items_relationship r ON r.item_id = i.id
        WHERE  r.parent_id = ?
          AND  (i.is_marked_for_deletion != 1 OR i.is_marked_for_deletion IS NULL)
        ORDER  BY r.position ASC
      `, [edgeCol.id]);

      if (!edgeItems[0]) continue;

      const itemCols = edgeItems[0].columns;
      const itemRows = edgeItems[0].values;

      for (const itemRow of itemRows) {
        const ei = Object.fromEntries(itemCols.map((c, i) => [c, itemRow[i]]));

        const url = ei.remote_url || '';

        // Skip duplicates — same URL already in this collection
        if (url) {
          const dup = this.db.exec(
            `SELECT id FROM items WHERE collection_id=? AND url=? LIMIT 1`,
            [ourCollectionId, url]
          );
          if (dup[0]?.values[0]) { skipped++; continue; }
        }

        // ── Map type ──────────────────────────────────────
        const typeMap = { 'ProductCard': 'page', 'Article': 'page', 'Image': 'image', 'Note': 'note' };
        const ourType = typeMap[ei.type] ?? 'page';

        // ── Thumbnail: convert BLOB → base64 data URL ─────
        let thumbnail = null;
        if (ei.canonical_image_data && ei.canonical_image_data.length > 4) {
          thumbnail = this._blobToDataUrl(ei.canonical_image_data);
        }

        // ── Notes: pull first comment for this item ────────
        let notes = '';
        const commentRes = edgeDb.exec(
          `SELECT text FROM comments WHERE parent_id=? LIMIT 1`,
          [ei.id]
        );
        if (commentRes[0]?.values[0]?.[0]) {
          notes = commentRes[0].values[0][0];
        }

        // ── Insert ────────────────────────────────────────
        const newId = this.addItem(ourCollectionId, {
          type:      ourType,
          url:       url,
          title:     ei.title || '',
          content:   ei.text_content || '',
          notes,
          thumbnail
        });

        // Override created_at with Edge's timestamp
        if (ei.date_created) {
          const ts = Math.round(ei.date_created);
          this.db.run(`UPDATE items SET created_at=? WHERE id=?`, [ts, newId]);
        }

        itemsImported++;
      }
    }

    edgeDb.close();

    const detail = `${collectionsImported} collections, ${itemsImported} items imported, ${skipped} duplicates skipped`;
    this.addLog('import_edge', true, detail);
    await this.save();

    return { collectionsImported, itemsImported, skipped };
  }

  /**
   * Converts a Uint8Array image BLOB to a base64 data URL.
   * Detects JPEG, PNG, WEBP from magic bytes.
   */
  _blobToDataUrl(blob) {
    try {
      const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
      let mime = 'image/jpeg'; // default
      if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
      else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = 'image/webp';

      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return `data:${mime};base64,${btoa(binary)}`;
    } catch {
      return null;
    }
  }

  

  // ─────────────────────────────────────────────
  // Size helpers
  // ─────────────────────────────────────────────

  /**
   * Returns the total byte length of all saved HTML content in the database.
   * Synchronous — reads from the in-memory SQLite instance.
   */
  getContentSize() {
    const res = this.db.exec(
      "SELECT COALESCE(SUM(LENGTH(content)),0) FROM items WHERE content IS NOT NULL AND content != ''"
    );
    return res[0]?.values[0][0] ?? 0;
  }

  /**
   * Returns the on-disk size of the collections.db file in bytes.
   * Async — reads the FileSystemFileHandle metadata.
   * Returns null if no handle is available.
   */
  async getDbFileSize() {
    if (!this.fileHandle) return null;
    try {
      const file = await this.fileHandle.getFile();
      return file.size;
    } catch { return null; }
  }

  // ─────────────────────────────────────────────
  // Meta table — key/value store for device identity and owner profile
  // ─────────────────────────────────────────────

  /**
   * Seeds device_id and db_created_at on first access of any DB
   * (new or existing). Safe to call multiple times — only writes if missing.
   */
  _seedMeta() {
    if (!this.getMeta('device_id')) {
      // crypto.randomUUID() is available in extension contexts (Chromium 92+)
      const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      this.setMeta('device_id', uuid);
    }
    if (!this.getMeta('db_created_at')) {
      this.setMeta('db_created_at', String(Math.floor(Date.now() / 1000)));
    }
  }

  getMeta(key) {
    try {
      const stmt = this.db.prepare('SELECT value FROM meta WHERE key=?');
      stmt.bind([key]);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row ? row.value : null;
    } catch { return null; }
  }

  setMeta(key, value) {
    this.db.run(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)',
      [key, String(value ?? '')]
    );
  }

  /**
   * Returns the owner profile stored in the meta table.
   * All fields default to empty string if not yet set.
   */
  getProfile() {
    return {
      firstName:   this.getMeta('owner_first_name') || '',
      lastName:    this.getMeta('owner_last_name')  || '',
      email:       this.getMeta('owner_email')      || '',
      deviceId:    this.getMeta('device_id')        || '',
      dbCreatedAt: this.getMeta('db_created_at')    || ''
    };
  }

  /**
   * Persists owner profile to the meta table.
   * Call db.save() after this to write to disk.
   */
  setProfile({ firstName = '', lastName = '', email = '' }) {
    this.setMeta('owner_first_name', firstName);
    this.setMeta('owner_last_name',  lastName);
    this.setMeta('owner_email',      email);
  }

  addLog(action, success = true, detail = null) {
    this.db.run(
      'INSERT INTO logs (action, success, detail) VALUES (?,?,?)',
      [action, success ? 1 : 0, detail]
    );
    // Keep only the 100 most recent entries
    this.db.run(`
      DELETE FROM logs WHERE id NOT IN (
        SELECT id FROM logs ORDER BY created_at DESC LIMIT 100
      )
    `);
  }

  getLogs() {
    const stmt = this.db.prepare(
      'SELECT * FROM logs ORDER BY created_at DESC LIMIT 100'
    );
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  /**
   * table: 'collections' | 'items'
   * direction: 'up' | 'down'
   * scopeId: collection_id for items, null for collections
   */
  _swapOrder(table, id, direction, scopeId) {
    const scopeClause = scopeId != null ? `AND collection_id = ${scopeId}` : '';

    // Get current row's sort_order
    const cur = this.db.exec(
      `SELECT sort_order FROM ${table} WHERE id = ${id}`
    );
    if (!cur[0]?.values[0]) return;
    const curOrder = cur[0].values[0][0];

    // Find the neighbour
    let neighbourSql;
    if (direction === 'up') {
      neighbourSql = `SELECT id, sort_order FROM ${table}
                      WHERE sort_order < ${curOrder} ${scopeClause}
                      ORDER BY sort_order DESC LIMIT 1`;
    } else {
      neighbourSql = `SELECT id, sort_order FROM ${table}
                      WHERE sort_order > ${curOrder} ${scopeClause}
                      ORDER BY sort_order ASC LIMIT 1`;
    }

    const nb = this.db.exec(neighbourSql);
    if (!nb[0]?.values[0]) return; // already at top/bottom

    const [nbId, nbOrder] = nb[0].values[0];

    // Swap using a temporary value to avoid unique constraint issues
    const tmp = -curOrder - 1;
    this.db.run(`UPDATE ${table} SET sort_order = ${tmp}    WHERE id = ${id}`);
    this.db.run(`UPDATE ${table} SET sort_order = ${curOrder} WHERE id = ${nbId}`);
    this.db.run(`UPDATE ${table} SET sort_order = ${nbOrder}  WHERE id = ${id}`);
  }

  async _loadFromHandle() {
    const file   = await this.fileHandle.getFile();
    const buffer = await file.arrayBuffer();
    this.db = new this.SQL.Database(new Uint8Array(buffer));
    this._applySchema(); // idempotent — ensures schema exists on older dbs too
    this.db.run('PRAGMA foreign_keys = ON;');
    this._seedMeta();   // ensure device_id and db_created_at exist
  }

  _idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
      req.onsuccess  = (e) => resolve(e.target.result);
      req.onerror    = ()  => reject(new Error('IndexedDB open failed'));
    });
  }

  async _idbGet(key) {
    try {
      const idb = await this._idbOpen();
      return new Promise((resolve) => {
        const tx  = idb.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => resolve(null);
      });
    } catch { return null; }
  }

  async _idbSet(key, value) {
    const idb = await this._idbOpen();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror    = reject;
    });
  }
}
