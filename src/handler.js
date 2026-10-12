import crypto from 'node:crypto';
import fs from 'node:fs';
import { cfg, getPage } from './config.js';
import { markSeen, getConvo, patchConvo, usage, addUsage } from './store.js';
import { sendText, sendImage, downloadTo } from './graph.js';
import { classifyGarment, runTryOn } from './tryon.js';
import { createQueue } from './queue.js';

const GARMENT_MAX_AGE_MS = 24 * 3600 * 1000;
const rid = () => crypto.randomUUID();

const MSG = {
  pickFirst: 'اول یکی از لباس‌ها رو انتخاب کن تا بتونیم پرو کنیم 🙂',
  askPhoto: 'عکس خودتو بفرست. برای شلوار و پالتو عکس تمام‌قد، برای پیرهن از کمر به بالا هم کافیه. عکس‌ها بعد از پردازش پاک می‌شن.',
  limit: 'سقف امروزت پر شده؛ فردا دوباره امتحان کن 🙏',
  received: 'عکس رسید! تا یه دقیقه نتیجه آماده می‌شه ✨',
  done: 'این پیش‌نمایشه؛ برای سفارش همین‌جا پیام بده 🛍️',
  fail: 'متأسفانه الان نشد. یه عکس واضح‌تر بفرست یا برای صحبت با فروشنده بنویس: پشتیبان',
  unsupported: 'این نوع لباس فعلاً پرو نمی‌شه. برای سفارش همین‌جا پیام بده.',
};

const queue = createQueue(cfg.concurrency, async job => {
  const { pageId, userId, personPath, garmentPath } = job;
  const page = getPage(pageId);
  try {
    const category = await classifyGarment(garmentPath);
    if (!cfg.enabledCategories.includes(category)) {
      await sendText(page.token, userId, MSG.unsupported);
      return;
    }
    const result = await runTryOn({ personPath, garmentPath, category });
    const name = `${rid()}.jpg`;
    fs.writeFileSync(`data/files/${name}`, result);
    await sendImage(page.token, userId, `${cfg.publicBase}/files/${name}`);
    await sendText(page.token, userId, MSG.done);
    addUsage(pageId, userId);
  } catch (err) {
    console.error('tryon error', err);
    await sendText(page.token, userId, MSG.fail);
  } finally {
    fs.rmSync(personPath, { force: true });
    patchConvo(pageId, userId, { state: 'IDLE' });
  }
});

export async function handleEvent(pageId, ev) {
  const m = ev.message;
  if (!m) return;
  if (!markSeen(m.mid)) return; // duplicate delivery

  const page = getPage(pageId);
  if (!page) { console.warn('Unknown entry.id (add it to pages.json):', pageId); return; }

  const img = (m.attachments || []).find(a => a.type === 'image');

  // Echo = message sent BY the page (e.g. Inzy sending the garment photo)
  if (m.is_echo) {
    if (String(m.app_id) === process.env.APP_ID) return; // ignore our own bot's messages
    const userId = ev.recipient.id;
    if (img) {
      const p = `data/files/garment-${rid()}.jpg`;
      await downloadTo(img.payload.url, p);
      patchConvo(pageId, userId, { garmentPath: p, garmentAt: Date.now() });
    }
    return;
  }

  const userId = ev.sender.id;
  const convo = getConvo(pageId, userId);

  if (m.text && m.text.trim() === cfg.trigger) {
    const fresh = convo.garmentPath && Date.now() - convo.garmentAt < GARMENT_MAX_AGE_MS
      && fs.existsSync(convo.garmentPath);
    if (!fresh) return void (await sendText(page.token, userId, MSG.pickFirst));
    patchConvo(pageId, userId, { state: 'WAITING_PHOTO' });
    return void (await sendText(page.token, userId, MSG.askPhoto));
  }

  if (img && convo.state === 'WAITING_PHOTO') {
    const u = usage(pageId, userId);
    if (u.user >= cfg.userDailyLimit || u.page >= (page.dailyLimit ?? 100)) {
      return void (await sendText(page.token, userId, MSG.limit));
    }
    const personPath = `data/files/person-${rid()}.jpg`;
    await downloadTo(img.payload.url, personPath);
    patchConvo(pageId, userId, { state: 'PROCESSING' });
    queue.add({ pageId, userId, personPath, garmentPath: convo.garmentPath });
    await sendText(page.token, userId, MSG.received);
  }
}
