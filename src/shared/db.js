/**
 * EDU MODE — IndexedDB & Storage Persistence Layer
 * Implements the 6 tables defined in database-schema.json:
 * - channels
 * - videos
 * - playlists
 * - user_overrides
 * - taxonomy
 * - audit_log
 *
 * Also manages transactional snapshot updates and fallback to last valid local snapshot.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EduModeDB = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'EduModeRegistryDB';
  const DB_VERSION = 1;

  const STORES = {
    CHANNELS: 'channels',
    VIDEOS: 'videos',
    PLAYLISTS: 'playlists',
    USER_OVERRIDES: 'user_overrides',
    TAXONOMY: 'taxonomy',
    AUDIT_LOG: 'audit_log'
  };

  let dbPromise = null;

  function openDB() {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORES.CHANNELS)) {
          const chStore = db.createObjectStore(STORES.CHANNELS, { keyPath: 'channel_id' });
          chStore.createIndex('channel_name', 'channel_name', { unique: false });
          chStore.createIndex('handle', 'handle', { unique: false });
          chStore.createIndex('approval_status', 'approval_status', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.VIDEOS)) {
          const vidStore = db.createObjectStore(STORES.VIDEOS, { keyPath: 'video_id' });
          vidStore.createIndex('channel_id', 'channel_id', { unique: false });
          vidStore.createIndex('decision', 'decision', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.PLAYLISTS)) {
          const plStore = db.createObjectStore(STORES.PLAYLISTS, { keyPath: 'playlist_id' });
          plStore.createIndex('channel_id', 'channel_id', { unique: false });
          plStore.createIndex('approval_status', 'approval_status', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.USER_OVERRIDES)) {
          const ovStore = db.createObjectStore(STORES.USER_OVERRIDES, { keyPath: 'id' });
          ovStore.createIndex('entity_type', 'entity_type', { unique: false });
          ovStore.createIndex('entity_id', 'entity_id', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.TAXONOMY)) {
          db.createObjectStore(STORES.TAXONOMY, { keyPath: 'subject_id' });
        }

        if (!db.objectStoreNames.contains(STORES.AUDIT_LOG)) {
          const auditStore = db.createObjectStore(STORES.AUDIT_LOG, { keyPath: 'id' });
          auditStore.createIndex('created_at', 'created_at', { unique: false });
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    return dbPromise;
  }

  async function getAllFromStore(storeName) {
    const db = await openDB();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function putInStore(storeName, record) {
    const db = await openDB();
    if (!db) return record;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFromStore(storeName, key) {
    const db = await openDB();
    if (!db) return true;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearStore(storeName) {
    const db = await openDB();
    if (!db) return true;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function logAudit(entry) {
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entity_type: entry.entity_type || 'system',
      entity_id: entry.entity_id || 'global',
      old_decision: entry.old_decision || null,
      new_decision: entry.new_decision || 'BLOCK',
      reason: entry.reason || 'Policy update',
      created_at: new Date().toISOString()
    };
    return putInStore(STORES.AUDIT_LOG, record);
  }

  /**
   * Transactionally apply a validated database snapshot (Section 8)
   * Preserves existing snapshot if validation or transaction fails.
   */
  async function applySnapshotTransactionally(snapshot, validatorFn) {
    if (typeof validatorFn === 'function') {
      const check = validatorFn(snapshot);
      if (!check.valid) {
        throw new Error(check.error || 'Snapshot validation failed');
      }
    }

    const db = await openDB();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.CHANNELS, STORES.AUDIT_LOG], 'readwrite');
      const chStore = tx.objectStore(STORES.CHANNELS);
      const auditStore = tx.objectStore(STORES.AUDIT_LOG);

      for (const ch of snapshot.channels) {
        const key = ch.channel_id || ch.seed_id || `name:${String(ch.channel_name).toLowerCase().trim()}`;
        const record = Object.assign({}, ch, {
          channel_id: key,
          handle: ch.handle || ch.handle_hint || null,
          allowed_video_policy: ch.allowed_video_policy || 'per_video',
          updated_at: new Date().toISOString(),
          created_at: ch.created_at || new Date().toISOString()
        });
        chStore.put(record);
      }

      auditStore.put({
        id: `sync-${Date.now()}`,
        entity_type: 'snapshot',
        entity_id: snapshot.schema_version || '1.0.0',
        old_decision: null,
        new_decision: snapshot.default_decision || 'BLOCK',
        reason: `Applied snapshot (${snapshot.channels.length} candidate channels)`,
        created_at: new Date().toISOString()
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB snapshot transaction failed'));
      tx.onabort = () => reject(new Error('IndexedDB snapshot transaction aborted'));
    });
  }

  return {
    STORES,
    openDB,
    getAllFromStore,
    putInStore,
    deleteFromStore,
    clearStore,
    logAudit,
    applySnapshotTransactionally
  };
});
