import fs from 'node:fs';

fs.mkdirSync('data/files', { recursive: true });
const FILE = 'data/state.json';

let db = { convos: {}, seen: [], usage: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch { /* first run */ }

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => fs.writeFileSync(FILE, JSON.stringify(db)), 500);
}

const IDLE_AFTER_MS = 30 * 60 * 1000;

// true = new message, false = duplicate (Meta retries webhooks)
export function markSeen(mid) {
  if (!mid) return true;
  if (db.seen.includes(mid)) return false;
  db.seen.push(mid);
  if (db.seen.length > 5000) db.seen.splice(0, 1000);
  save();
  return true;
}

export function getConvo(pageId, userId) {
  const k = `${pageId}:${userId}`;
  const c = (db.convos[k] ||= { state: 'IDLE', garmentPath: null, garmentAt: 0, updatedAt: Date.now() });
  if (c.state !== 'IDLE' && Date.now() - c.updatedAt > IDLE_AFTER_MS) c.state = 'IDLE';
  return c;
}

export function patchConvo(pageId, userId, patch) {
  Object.assign(getConvo(pageId, userId), patch, { updatedAt: Date.now() });
  save();
}

const day = () => new Date().toISOString().slice(0, 10);

export function usage(pageId, userId) {
  return {
    user: db.usage[`${day()}:${pageId}:${userId}`] || 0,
    page: db.usage[`${day()}:${pageId}`] || 0,
  };
}

export function addUsage(pageId, userId) {
  const a = `${day()}:${pageId}:${userId}`;
  const b = `${day()}:${pageId}`;
  db.usage[a] = (db.usage[a] || 0) + 1;
  db.usage[b] = (db.usage[b] || 0) + 1;
  save();
}
