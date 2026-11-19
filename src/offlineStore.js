import * as SQLite from 'expo-sqlite';
import * as Network from 'expo-network';

let databasePromise;

async function database() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync('ean-marketing-offline.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cached_records (
          user_id TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          json_value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, cache_key)
        );
        CREATE TABLE IF NOT EXISTS pending_operations (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          table_name TEXT NOT NULL,
          record_id TEXT,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
      `);
      return db;
    })();
  }
  return databasePromise;
}

export async function saveCachedRecords(userId, cacheKey, value) {
  if (!userId) return;
  const db = await database();
  await db.runAsync(
    'INSERT OR REPLACE INTO cached_records (user_id, cache_key, json_value, updated_at) VALUES (?, ?, ?, ?)',
    userId, cacheKey, JSON.stringify(value ?? null), new Date().toISOString()
  );
}

export async function readCachedRecords(userId, cacheKey) {
  if (!userId) return null;
  const db = await database();
  const row = await db.getFirstAsync(
    'SELECT json_value FROM cached_records WHERE user_id = ? AND cache_key = ?',
    userId, cacheKey
  );
  if (!row) return null;
  try { return JSON.parse(row.json_value); } catch { return null; }
}

export async function addPendingOperation(userId, operation) {
  if (!userId) throw new Error('A signed-in user is required to save an offline change.');
  const db = await database();
  const id = operation.id || 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  await db.runAsync(
    'INSERT INTO pending_operations (id, user_id, operation_type, table_name, record_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, userId, operation.type, operation.table, operation.recordId || null,
    JSON.stringify(operation.payload ?? {}), new Date().toISOString()
  );
  return id;
}

export async function getPendingOperations(userId) {
  const db = await database();
  const rows = await db.getAllAsync(
    'SELECT * FROM pending_operations WHERE user_id = ? ORDER BY created_at ASC',
    userId
  );
  return rows.map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}

export async function removePendingOperation(id) {
  const db = await database();
  await db.runAsync('DELETE FROM pending_operations WHERE id = ?', id);
}

export async function recordOperationFailure(id, message) {
  const db = await database();
  await db.runAsync(
    'UPDATE pending_operations SET attempts = attempts + 1, last_error = ? WHERE id = ?',
    String(message || 'Unknown sync error'), id
  );
}

export async function getNetworkStatus() {
  const state = await Network.getNetworkStateAsync();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export function subscribeToNetworkChanges(callback) {
  return Network.addNetworkStateListener(state => {
    callback(Boolean(state.isConnected && state.isInternetReachable !== false));
  });
}
