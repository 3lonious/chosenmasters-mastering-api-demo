Chosen Masters Mastering API Demo

This repository hosts the demo application for the Chosen Masters B2B mastering API. It showcases the end-to-end workflow for requesting a signed upload URL, submitting a mastering job, and streaming mastered intensities with the same stack that powers the production dashboard.

Prerequisites

Node.js 18+ (App Router)

npm 9+ (or another package manager configured for Next.js)

Getting started

Install dependencies

npm install


Create .env.local in the project root:

CM_API_KEY=
PARENT_BASE_URL=https://chosenmasters.com
NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net


CM_API_KEY – Your private API key. Keep this secret and use it only in server-side code.

PARENT_BASE_URL – Base domain for live API requests (keep default unless targeting staging).

NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL – Public CloudFront distribution for mastered previews.

Start the dev server

npm run dev


Open the app

App: http://localhost:3000

Interactive docs: /mastering-docs (mirrors production flow)

Useful scripts
Command	Description
npm run dev	Starts the development server with hot reloading.
npm run build	Creates an optimized production build.
npm run start	Runs the built app in production mode.
Additional resources

Chosen Masters – Request B2B mastering access: https://chosenmasters.com/ai-mastering-api

Next.js docs – https://nextjs.org/docs

B2B Mastering API – Full Integration Guide

Authenticate requests with your API key. Each song submission costs one credit. Credit rates start at $0.50 and decrease to $0.14 at higher tiers. Mastered files stay on our CloudFront CDN for 30 days — download what you want to keep beyond that window.

Cost control tip: Gate the upload URL endpoint by requiring ≥ 1 available credit and tag uploads with temp=true so you can auto-expire unused objects with an S3 lifecycle rule.

Environment

Create .env.local:

CM_API_KEY=your-live-or-sandbox-key
PARENT_BASE_URL=https://chosenmasters.com
NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net


Keep CM_API_KEY private (server only).

NEXT_PUBLIC_* variables can be safely exposed to the browser.

How the B2B flow works

Authenticate requests with header x-api-key: <CM_API_KEY>.

Request a signed upload URL and PUT your file directly to S3. The returned s3Key is already namespaced for your tenant.

Submit mastering with POST /api/b2b/mastering using the s3Key and a required mode (process | lite | warm). One credit is deducted on acceptance; the job is tagged with type: "b2b".

Poll status and intensities:

GET /api/b2b/mastering/:id (parent job)

GET /api/b2b/mastering/:id/audio?intensity=all (per-intensity URLs)

Errors

401 invalid/missing key

403 out of credits

Other non-2xx ⇒ not accepted by engine; fix input and retry.

Engine modes (required)

process — Modern sheen & width (default in demo)

lite — Open, gentle lift, extra transient detail

warm — Powerful, saturated tilt, added weight

1) Request a signed upload URL
const API_KEY = process.env.CM_API_KEY;

const response = await fetch('https://chosenmasters.com/api/b2b/mastering/upload-url', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  },
  body: JSON.stringify({
    fileName: 'mix.wav',
    fileType: 'audio/wav',
  }),
});

if (!response.ok) throw new Error('Unable to request upload URL');

const { uploadUrl, s3Key, headers, expiresIn } = await response.json();
console.log('Upload using signed URL before it expires:', expiresIn, 'seconds');

// PUT the file to `uploadUrl` with the **returned** `headers`

2) Submit a mastering job (mode is required)
const API_KEY = process.env.CM_API_KEY;

const res = await fetch('https://chosenmasters.com/api/b2b/mastering', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  },
  body: JSON.stringify({
    s3Key: 'path/to/file.wav',
    title: 'My Track',
    ext: 'wav',
    size: '5.4',         // MB (string or number)
    mode: 'process',     // required: process | lite | warm
  }),
});

if (!res.ok) throw new Error('Mastering submission failed');

const data = await res.json();
console.log('Job queued:', data.jobId);
console.log('Expected key/url:', data.expectedKey, data.expectedUrl);

3) Parent status polling
const API_KEY = process.env.CM_API_KEY;

const res = await fetch('https://chosenmasters.com/api/b2b/mastering/' + jobId, {
  headers: { 'x-api-key': API_KEY },
});

if (!res.ok) throw new Error('Unable to retrieve mastering job');

const data = await res.json();
console.log('Mastering status:', data);

if (data.mastered && data.url) {
  console.log('Signed CloudFront URL:', data.url);
  // stream while valid, and keep polling intensities (see below)
}

New polling guidance (important)

Do not stop intensity polling just because Level 3 appears. Keep polling /audio until all requested levels report available, or until you hit a sensible ceiling (e.g., ~60–120s after the first appears).

Once any CloudFront mastered URL appears (parent data.url or /audio), you can assume other intensities will usually arrive within ~30s. Reduce the interval or back off, but continue polling to populate the full ladder.

Cadence suggestion

Parent: GET /api/b2b/mastering/:id every 3s until mastered === true, then slow to 5–8s.

Audio: GET /api/b2b/mastering/:id/audio?intensity=all every 3–5s while requested levels are still missing.

After the first mastered URL, keep polling /audio for ~30s (or until all requested levels are available), then stop.

4) Retrieve/stream intensities
const API_KEY = process.env.CM_API_KEY;

const res = await fetch(
  'https://chosenmasters.com/api/b2b/mastering/' + jobId + '/audio?intensity=all',
  { mode: 'cors', headers: { 'x-api-key': API_KEY } }
);

if (!res.ok) throw new Error('Unable to load mastered intensities');

const data = await res.json();

console.log('Original:', data.originalUrl);
console.log('Requested levels:', data.requestedLevels);
console.log('Available levels:', data.availableLevels);
console.log('All intensities:', data.intensities);

const playable = (data.intensities || []).filter(x => x.available && x.url);
if (!playable.length) {
  console.log('Still rendering — poll again in ~10s');
}

const level3 = playable.find(x => x.level === 3) || playable[0];
if (level3?.url) {
  console.log('Play preferred master at:', level3.url);
}

Download format logic (MP3/WAV swap)

The demo lets users download the currently selected master as MP3 or WAV by swapping the extension on the signed CloudFront URL before the query string (when both variants exist).

Helpers

function extractExtension(url) {
  if (!url) return null;
  const [path] = url.split('?');
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

function swapExtension(url, nextExt) {
  if (!url || !nextExt) return url;
  const normalized = nextExt.toLowerCase();
  const [path, query] = url.split('?');
  const m = path.match(/\.([a-z0-9]+)$/i);
  if (!m) return url;
  if (m[1].toLowerCase() === normalized) return url;
  const updatedPath = path.replace(/\.(mp3|wav|m4a|flac)$/i, `.${normalized}`);
  return query ? `${updatedPath}?${query}` : updatedPath;
}


Derive available formats & compute the download URL

// `selectedMasteredUrl` is the current mastered preview URL (e.g., an intensity L3)
const baseExt = extractExtension(selectedMasteredUrl);

const availableFormats = (() => {
  const out = [];
  const seen = new Set();
  const push = (value, label) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, label });
  };

  if (baseExt) push(baseExt, baseExt.toUpperCase());
  else push('mp3', 'MP3');

  if (baseExt !== 'wav') push('wav', 'WAV'); // expose WAV as a second option if possible
  return out; // e.g., [{value:'mp3',label:'MP3'},{value:'wav',label:'WAV'}]
})();

let chosenFormat = baseExt || 'mp3'; // default; update from a <select> UI

const downloadUrl = selectedMasteredUrl
  ? swapExtension(selectedMasteredUrl, chosenFormat)
  : null;

// Example render:
// <a href={downloadUrl} download={`Title.${chosenFormat}`}>Download</a>


If a swapped extension 404s (e.g., no WAV built for this preview), fall back to the original extension.

Example: minimal client flow (upload → submit → poll)
import axios from 'axios';

async function uploadAndSubmit(file, apiKey) {
  // 1) Upload URL
  const up = await fetch('/api/b2b/mastering/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ fileName: file.name, fileType: file.type || 'audio/wav' }),
  });
  if (!up.ok) throw new Error('upload-url failed');
  const { uploadUrl, s3Key, headers } = await up.json();

  // 2) PUT to S3
  await axios.put(uploadUrl, file, { headers });

  // 3) Submit mastering
  const sub = await fetch('/api/b2b/mastering', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      s3Key,
      title: file.name.replace(/\.[^/.]+$/, ''),
      ext: (file.name.split('.').pop() || 'wav').toLowerCase(),
      size: (file.size / 1048576).toFixed(2),
      mode: 'process',
    }),
  });
  if (!sub.ok) throw new Error('submit failed');
  const { jobId } = await sub.json();

  // 4) Poll parent until mastered, then keep polling /audio
  let masteredSeen = false;
  let firstMasteredAt = null;

  async function pollParent() {
    const r = await fetch('/api/b2b/mastering/' + jobId, { headers: { 'x-api-key': apiKey } });
    if (r.ok) {
      const d = await r.json();
      if (d.mastered && d.url && !masteredSeen) {
        masteredSeen = true;
        firstMasteredAt = Date.now();
      }
    }
  }

  async function pollAudio() {
    const r = await fetch('/api/b2b/mastering/' + jobId + '/audio?intensity=all',
      { headers: { 'x-api-key': apiKey } });
    if (!r.ok) return false;
    const d = await r.json();

    const requested = Array.isArray(d.requestedLevels) ? d.requestedLevels : [];
    const available = Array.isArray(d.availableLevels) ? d.availableLevels : [];
    const allReady = requested.length && requested.length === available.length;

    const anyPlayable = (d.intensities || []).some(x => x.available && x.url);

    // Stop when full ladder is ready OR ~30s after first mastered URL
    if (anyPlayable && masteredSeen) {
      const sinceFirst = Date.now() - (firstMasteredAt || Date.now());
      if (allReady || sinceFirst >= 30_000) return true;
    }
    return false;
  }

  const parentIv = setInterval(pollParent, 3000);
  (async function loop() {
    while (true) {
      const done = await pollAudio();
      if (done) break;
      await new Promise(r => setTimeout(r, 4000));
    }
    clearInterval(parentIv);
  })();
}

Credit gate & temp cleanup (recommended)

Gate uploads: require ≥ 1 credit to issue a signed URL (403 "Insufficient credits" when none remain).

Tag uploads: set temp=true on pre-signed uploads and attach an S3 lifecycle rule to auto-expire temp objects (e.g., after 1 day) that were never submitted.

This prevents tenants with zero credits from running up S3 PUT/storage costs and cleans up orphaned files automatically.
