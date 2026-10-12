import fs from 'node:fs';

const BASE = `https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v21.0'}`;

async function send(token, userId, message) {
  const r = await fetch(`${BASE}/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: userId }, message }),
  });
  if (!r.ok) console.error('send failed', r.status, await r.text());
  return r.ok;
}

export const sendText = (token, userId, text) => send(token, userId, { text });

export const sendImage = (token, userId, url) =>
  send(token, userId, { attachment: { type: 'image', payload: { url } } });

// Instagram attachment links expire: download right away.
export async function downloadTo(url, destPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed ${r.status}`);
  fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
}
