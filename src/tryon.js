
import fs from 'node:fs';
import path from 'node:path';

const SPACE_URL = (
  process.env.HF_SPACE_URL ||
  'https://fashn-ai-fashn-vton-1-5.hf.space'
).replace(/\/+$/, '');

function getHeaders() {
  const token = process.env.HF_TOKEN;

  if (!token) {
    throw new Error('HF_TOKEN is missing from environment variables');
  }

  return { Authorization: `Bearer ${token}` };
}

async function uploadImage(imagePath) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const bytes = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);

  const form = new FormData();
  form.append(
    'files',
    new Blob([bytes]),
    filename
  );

  const response = await fetch(`${SPACE_URL}/gradio_api/upload`, {
    method: 'POST',
    headers: getHeaders(),
    body: form,
    signal: AbortSignal.timeout(120000),
  });

  if (!response.ok) {
    throw new Error(
      `Image upload failed (${response.status}): ${await response.text()}`
    );
  }

  const uploaded = await response.json();

  if (!Array.isArray(uploaded) || !uploaded[0]) {
    throw new Error('Hugging Face returned no uploaded file path');
  }

  return {
    path: uploaded[0],
    orig_name: filename,
    meta: { _type: 'gradio.FileData' },
  };
}

// Temporary default. A vision classifier can be added later.
export async function classifyGarment(_imagePath) {
  return process.env.DEFAULT_CATEGORY || 'tops';
}

// Returns a Buffer containing the generated image.
export async function runTryOn({ personPath, garmentPath, category }) {
  const provider = process.env.TRYON_PROVIDER || 'mock';

  if (provider === 'mock') {
    return fs.readFileSync(personPath);
  }

  if (provider !== 'hf') {
    throw new Error(`Unknown TRYON_PROVIDER: ${provider}`);
  }

  // Upload both images to the Space.
  const person = await uploadImage(personPath);
  const garment = await uploadImage(garmentPath);

  // These settings match the successful manual test.
  const body = {
    data: [
      person,
      garment,
      category || 'tops',
      process.env.HF_GARMENT_TYPE || 'flat-lay',
      30,
      1.5,
      42,
      true,
    ],
  };

  const startResponse = await fetch(
    `${SPACE_URL}/gradio_api/call/try_on`,
    {
      method: 'POST',
      headers: {
        ...getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    }
  );

  if (!startResponse.ok) {
    throw new Error(
      `Try-on request failed (${startResponse.status}): ${await startResponse.text()}`
    );
  }

  const { event_id: eventId } = await startResponse.json();

  if (!eventId) {
    throw new Error('Hugging Face did not return an event_id');
  }

  // Wait for the generated result.
  const resultResponse = await fetch(
    `${SPACE_URL}/gradio_api/call/try_on/${eventId}`,
    {
      headers: getHeaders(),
      signal: AbortSignal.timeout(300000),
    }
  );

  if (!resultResponse.ok) {
    throw new Error(
      `Result request failed (${resultResponse.status}): ${await resultResponse.text()}`
    );
  }

  const sse = await resultResponse.text();

  const eventBlocks = sse.split(/\r?\n\r?\n/);
  const completeBlock = eventBlocks.find(
    (block) => /^event:\s*complete\s*$/m.test(block)
  );

  if (!completeBlock) {
    const errorBlock = eventBlocks.find(
      (block) => /^event:\s*error\s*$/m.test(block)
    );

    throw new Error(
      errorBlock
        ? 'FASHN model returned event: error. Check the Space logs and input settings.'
        : `No completed result returned by FASHN: ${sse.slice(0, 1000)}`
    );
  }

  const dataLine = completeBlock
    .split(/\r?\n/)
    .find((line) => line.startsWith('data:'));

  if (!dataLine) {
    throw new Error('FASHN completed without returning image data');
  }

  const outputs = JSON.parse(dataLine.slice(5).trim());
  const imageUrl = outputs?.[0]?.url;

  if (!imageUrl) {
    throw new Error('FASHN completed, but no output image URL was returned');
  }

  // Download the actual generated image, not the customer's original.
  const imageResponse = await fetch(imageUrl, {
    headers: getHeaders(),
    signal: AbortSignal.timeout(120000),
  });

  if (!imageResponse.ok) {
    throw new Error(
      `Could not download generated image (${imageResponse.status})`
    );
  }

  return Buffer.from(await imageResponse.arrayBuffer());
}
