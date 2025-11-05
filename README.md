Chosen Masters Mastering API Demo

This repository hosts the demo application for the Chosen Masters B2B mastering API. It showcases the end-to-end workflow for requesting a signed upload URL, submitting a mastering job, and streaming mastered intensities with the same stack that powers the production dashboard.

Prerequisites

Node.js 18 or newer (the project is built with the Next.js App Router)

npm 9+ (or an alternative package manager configured for Next.js projects)

Getting started

Install dependencies:

npm install


Create a .env.local file in the project root with the required configuration:

CM_API_KEY=
PARENT_BASE_URL=https://chosenmasters.com
NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net


CM_API_KEY – Your private API key. Keep this secret and only reference it from server-side code.

PARENT_BASE_URL – The base domain for live API requests. Leave at the default unless you are targeting a staging stack.

NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL – Public CloudFront distribution used for streaming mastered previews.

Start the development server:

npm run dev


Open http://localhost:3000
 to view the demo. The interactive documentation is available at /mastering-docs and reflects the current production flow.

Useful scripts
Command	Description
npm run dev	Starts the development server with hot reloading.
npm run build	Creates an optimized production build.
npm run start	Runs the built app in production mode.
Additional resources

Chosen Masters
 – Request access to the B2B mastering program.

Next.js documentation
 – Framework reference used by this project.

B2B Mastering API – Full Integration Guide

Authenticate requests with your API key. Each song submission costs one credit. Credit rates start at $0.50 and decrease to $0.14 at higher tiers. Mastered files stay on our CloudFront CDN for 30 days—download anything you need to keep beyond that window.

Cost control tip: We recommend gating the upload URL endpoint by requiring at least one available credit and tagging uploads with temp=true so you can auto-expire unused objects via an S3 lifecycle rule.

Environment

Create .env.local:

CM_API_KEY=your-live-or-sandbox-key
PARENT_BASE_URL=https://chosenmasters.com
NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net


Keep CM_API_KEY private (server only).

NEXT_PUBLIC_* vars can be exposed to the browser.

How the B2B flow works

Authenticate each request with your API key (header x-api-key).

Request upload URL and PUT your file directly to S3. The returned s3Key is already namespaced for your tenant.

Submit mastering with POST /api/b2b/mastering using that s3Key and a required mode (process | lite | warm). One credit is deducted on acceptance; the job is tagged with type:"b2b".

Poll job status and intensities via:

GET /api/b2b/mastering/:id (parent status)

GET /api/b2b/mastering/:id/audio?intensity=all (per-intensity URLs)

Errors: 401 invalid/missing key; 403 out of credits. Other non-2xx → not accepted by engine; fix input and retry.

Engine modes (required)

process – Modern sheen & width (default in demo).

lite – Open, gentle lift, more transient detail.

warm – Powerful, saturated tilt, extra weight.

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

// PUT the file to `uploadUrl` with returned `headers`

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

Once any CloudFront mastered URL appears (either via parent status data.url or /audio response), you can assume other intensities will arrive within ~30s in most cases. Reduce the polling interval or switch to a slower backoff, but continue polling to populate the full ladder.

A simple cadence:

Poll /api/b2b/mastering/:id every 3s until mastered===true (then you can slow to 5–8s).

Poll /api/b2b/mastering/:id/audio?intensity=all every 3–5s while there are requested levels not yet available.

After you see the first mastered URL, continue polling /audio for ~30s to fill in the rest (or until all requested levels are available), then stop.

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
  console.log('Still rendering—poll again in ~10s');
}

const level3 = playable.find(x => x.level === 3) || playable[0];
if (level3?.url) {
  console.log('Play preferred master at:', level3.url);
}

Download format logic (MP3/WAV swap)

The demo lets users download the currently selected master as MP3 or WAV by swapping the extension on the signed CloudFront URL before the query string (when both variants exist).

Helpers:

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


Derive available formats & compute download URL:

// `selectedMasteredUrl` is the current mastered preview URL (e.g., intensity L3)
// Try to keep WAV always available as a choice; MP3 is common for previews.

const baseExt = extractExtension(selectedMasteredUrl);
const availableFormats = (() => {
  const out = [];
  const seen = new Set();
  const push = (value, label) => { if (!seen.has(value)) { seen.add(value); out.push({value, label}); } };

  if (baseExt) push(baseExt, baseExt.toUpperCase()); else push('mp3', 'MP3');
  if (baseExt !== 'wav') push('wav', 'WAV'); // expose WAV as a second option if possible

  return out; // e.g., [{value:'mp3',label:'MP3'},{value:'wav',label:'WAV'}]
})();

let chosenFormat = baseExt || 'mp3'; // default
// when user changes a <select>, set chosenFormat = event.target.value.toLowerCase()

const downloadUrl =
  selectedMasteredUrl
    ? swapExtension(selectedMasteredUrl, chosenFormat)
    : null;

// render:
// <a href={downloadUrl} download={`Title.${chosenFormat}`}>Download</a>


Note: If a swapped extension 404s (e.g., no WAV built for a preview), fall back to the original extension.

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
  const t0 = Date.now();

  async function pollParent() {
    const r = await fetch('/api/b2b/mastering/' + jobId, { headers: { 'x-api-key': apiKey } });
    if (r.ok) {
      const d = await r.json();
      if (d.mastered && d.url) masteredSeen = true;
    }
  }

  async function pollAudio() {
    const r = await fetch('/api/b2b/mastering/' + jobId + '/audio?intensity=all',
      { headers: { 'x-api-key': apiKey } });
    if (r.ok) {
      const d = await r.json();
      const playable = (d.intensities || []).filter(x => x.available && x.url);
      // render your ladder here
      if (playable.length) {
        // once ANY url appears, keep polling up to ~30s to fill the rest
        if (Date.now() - t0 > 30_000 && masteredSeen) return true; // stop after grace window
        if (d.availableLevels && d.requestedLevels &&
            d.availableLevels.length === d.requestedLevels.length) return true; // got all
      }
    }
    return false;
  }

  // cadence: parent every 3s; audio every 3-5s until full
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

Gate uploads: require ≥ 1 credit to issue a signed URL. Return 403 “Insufficient credits” when none remain.

Tag uploads: set temp=true on pre-signed uploads; attach an S3 lifecycle rule to auto-expire temp objects (e.g., after 1 day) that were never submitted.

This prevents tenants with 0 credits from running up S3 PUT/storage costs and cleans up orphaned files automatically.
