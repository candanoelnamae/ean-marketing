// Browser implementation of the offline store.
// Android continues to use offlineStore.js with SQLite and SecureStore.

const PREFIX = 'ean-marketing-web:';
const read = key => {
  try {
    const value = globalThis.localStorage?.getItem(PREFIX + key);
    return value == null ? null : JSON.parse(value);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
};
const remove = key => globalThis.localStorage?.removeItem(PREFIX + key);

export async function saveCachedRecords(userId, cacheKey, value) {
  if (!userId) return;
  write('cache:' + userId + ':' + cacheKey, value ?? null);
}

export async function readCachedRecords(userId, cacheKey) {
  if (!userId) return null;
  return read('cache:' + userId + ':' + cacheKey);
}

export async function addPendingOperation(userId, operation) {
  if (!userId) throw new Error('A signed-in user is required to save an offline change.');
  const operations = read('pending') || [];
  const id = operation.id || 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  operations.push({
    id,
    user_id: userId,
    operation_type: operation.type,
    table_name: operation.table,
    record_id: operation.recordId || null,
    payload: operation.payload ?? {},
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  });
  write('pending', operations);
  return id;
}

export async function getPendingOperations(userId) {
  return (read('pending') || [])
    .filter(item => item.user_id === userId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removePendingOperation(id) {
  write('pending', (read('pending') || []).filter(item => item.id !== id));
}

export async function recordOperationFailure(id, message) {
  const operations = read('pending') || [];
  write('pending', operations.map(item => item.id === id
    ? { ...item, attempts: (item.attempts || 0) + 1, last_error: String(message || 'Unknown sync error') }
    : item));
}

export async function getNetworkStatus() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function subscribeToNetworkChanges(callback) {
  if (typeof window === 'undefined') return () => {};
  const update = () => callback(navigator.onLine !== false);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  return () => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  };
}

const secureAuthKey = key => PREFIX + 'supabase-auth-' + key;
export const supabaseAuthStorage = {
  async getItem(key) {
    try { return globalThis.localStorage?.getItem(secureAuthKey(key)) ?? null; }
    catch { return null; }
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(secureAuthKey(key), value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(secureAuthKey(key));
  }
};
