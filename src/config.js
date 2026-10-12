import fs from 'node:fs';

export const cfg = {
  trigger: (process.env.TRIGGER_TEXT || 'پرو لباس').trim(),
  userDailyLimit: Number(process.env.DAILY_LIMIT_PER_USER || 3),
  concurrency: Number(process.env.CONCURRENCY || 2),
  fileTtlMs: Number(process.env.FILE_TTL_HOURS || 24) * 3600 * 1000,
  publicBase: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  enabledCategories: (process.env.ENABLED_CATEGORIES || 'tops,bottoms,outerwear,one-piece')
    .split(',').map(s => s.trim()),
};

let pages = {};
try {
  pages = JSON.parse(fs.readFileSync('pages.json', 'utf8'));
} catch {
  console.warn('pages.json not found: copy pages.json.example to pages.json');
}

export function getPage(id) {
  return pages[String(id)] || null;
}
