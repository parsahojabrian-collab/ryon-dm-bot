import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { handleEvent } from './handler.js';

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Result images are served with unguessable names; they are deleted after FILE_TTL_HOURS.
app.use('/files', express.static('data/files', { index: false }));

app.get('/health', (_req, res) => res.send('ok'));

// Meta webhook verification
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const sig = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET || '')
    .update(req.rawBody || '').digest('hex');
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return res.sendStatus(401);

  res.sendStatus(200); // answer fast, work afterwards
  for (const entry of req.body.entry || []) {
    for (const ev of entry.messaging || []) {
      handleEvent(String(entry.id), ev).catch(err => console.error('event error', err));
    }
  }
});

// Delete old files (customer photos, results, garments)
setInterval(() => {
  const dir = 'data/files';
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (Date.now() - fs.statSync(p).mtimeMs > cfg.fileTtlMs) fs.rmSync(p, { force: true });
  }
}, 30 * 60 * 1000);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`listening on :${port}`));
