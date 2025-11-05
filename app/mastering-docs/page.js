"use client";

import React from "react";

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border border-gray-200 rounded-xl bg-white/70 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <span className="text-gray-500 text-xl leading-none">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm text-gray-700">
          {children}
        </div>
      )}
    </section>
  );
}

function Code({ children }) {
  return (
    <pre className="relative group">
      <code className="block overflow-x-auto rounded-lg bg-gray-900 text-gray-100 text-sm leading-relaxed p-4 whitespace-pre">
        {children}
      </code>
    </pre>
  );
}

function CodeBlock({ label, code }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide uppercase text-gray-600">
          {label}
        </span>
      </div>
      <Code>{code}</Code>
    </div>
  );
}

const CODE_UPLOAD = `const API_KEY = process.env.CM_API_KEY;

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

if (!response.ok) {
  throw new Error('Unable to request upload URL');
}

const { uploadUrl, s3Key, headers, expiresIn } = await response.json();

console.log('Upload using signed URL before it expires:', expiresIn, 'seconds');
// PUT your file to uploadUrl with the provided headers before expiresIn seconds elapse.`;

const CODE_SUBMIT = `const API_KEY = process.env.CM_API_KEY;

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
    size: '5.4',
    mode: 'process', // required: process | lite | warm
    // No need to send a type flag—the API tags the job as B2B and deducts a credit when accepted.
  }),
});

if (!res.ok) {
  throw new Error('Mastering submission failed');
}

const data = await res.json();
console.log('Mastering job queued with ID:', data.jobId);
if (data.expectedKey) {
  console.log('Deliverable key:', data.expectedKey);
}
if (data.expectedUrl) {
  console.log('CloudFront URL:', data.expectedUrl);
}`;

const CODE_STATUS = `const API_KEY = process.env.CM_API_KEY;

const res = await fetch('https://chosenmasters.com/api/b2b/mastering/' + jobId, {
  headers: { 'x-api-key': API_KEY },
});

if (!res.ok) {
  throw new Error('Unable to retrieve mastering job');
}

const data = await res.json();
console.log('Mastering job status:', data);

if (data.expectedKey) {
  console.log('Deliverable key:', data.expectedKey);
}
if (data.expectedUrl) {
  console.log('CloudFront URL:', data.expectedUrl);
}
if (Array.isArray(data.deliverables)) {
  console.log('All deliverables:', data.deliverables);
}

if (data.mastered && data.url) {
  console.log('Download your mastered file at:', data.url);
  // Stream while the signed CloudFront URL is valid:
  // document.getElementById('mastered-preview').src = data.url;
}`;

/* --------------------- UPDATED POLLING SAMPLE (IMPORTANT) --------------------- */
const CODE_AUDIO = `const API_KEY = process.env.CM_API_KEY;

/**
 * Poll intensities until:
 * 1) ALL requestedLevels are available, OR
 * 2) ~30s after the first playable CloudFront URL appears (grace window).
 */
async function pollMasteredIntensities(jobId, { pollMs = 3000, graceMs = 30000 } = {}) {
  let firstPlayableAt = null;
  let requested = null;

  // Utility sleep
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  while (true) {
    const res = await fetch(
      'https://chosenmasters.com/api/b2b/mastering/' + jobId + '/audio?intensity=all',
      {
        mode: 'cors',
        headers: { 'x-api-key': API_KEY },
      }
    );

    if (!res.ok) {
      throw new Error('Unable to load mastered intensities');
    }

    const data = await res.json();

    // Establish requestedLevels once (fallback to 1..5 if not present)
    if (!requested) {
      requested = Array.isArray(data.requestedLevels) && data.requestedLevels.length
        ? data.requestedLevels.slice()
        : [1, 2, 3, 4, 5];
    }

    const intensities = Array.isArray(data.intensities) ? data.intensities : [];
    const playable = intensities.filter((i) => i.available && i.url);
    const ready = new Set(playable.map((i) => i.level));

    // Mark when CloudFront first becomes playable
    if (playable.length && !firstPlayableAt) {
      firstPlayableAt = Date.now();
    }

    // Stop if all requested levels are ready
    const allReady = requested.every((lvl) => ready.has(lvl));
    if (allReady) {
      return data; // all requested intensities are available
    }

    // Or stop after grace window once CF is first playable
    if (firstPlayableAt && Date.now() - firstPlayableAt >= graceMs) {
      return data; // good enough for UI; others will warm shortly
    }

    await wait(pollMs);
  }
}

// Usage:
const result = await pollMasteredIntensities(jobId);
console.log('Original file:', result.originalUrl);
console.log('Requested levels:', result.requestedLevels);
console.log('Available levels:', result.availableLevels);
console.log('All intensities:', result.intensities);

const preferred =
  (result.intensities || []).find((i) => i.level === 3 && i.available && i.url) ||
  (result.intensities || []).find((i) => i.available && i.url);

if (!preferred) {
  console.log('Mastered previews still warming. Keep polling until ready.');
} else {
  console.log('Play preferred master at:', preferred.url);
}`;
const CODE_PLAYBACK_DOWNLOAD = `function pickMp3Preview(intensities) {
  if (!Array.isArray(intensities)) return null;

  const mp3 = intensities.find(
    (item) =>
      item &&
      item.available &&
      typeof item.url === 'string' &&
      /\.mp3(?:\?|$)/i.test(item.url)
  );

  if (mp3) return mp3.url;

  const fallback = intensities.find(
    (item) => item && item.available && typeof item.url === 'string'
  );

  return fallback ? fallback.url : null;
}

function swapExtension(url, nextExt = 'wav') {
  if (!url || !nextExt) return url;
  const [path, query] = url.split('?');
  if (!/\.(mp3|wav|m4a|flac)$/i.test(path)) return url;
  const updated = path.replace(
    /\.(mp3|wav|m4a|flac)$/i,
    '.' + nextExt.toLowerCase()
  );
  return query ? updated + '?' + query : updated;
}

// Usage:
const previewUrl = pickMp3Preview(result.intensities);
const wavDownloadUrl = swapExtension(previewUrl, 'wav');
const mp3DownloadUrl = swapExtension(previewUrl, 'mp3');`
/* ----------------------------------------------------------------------------- */

export default function MasteringDocsPage() {
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-indigo-600 uppercase tracking-wide">
          Chosen Masters B2B API
        </p>
        <h1 className="text-3xl font-bold text-gray-900">
          Mastering integration guide
        </h1>
        <p className="text-gray-600">
          Authenticate requests with your API key. Each song submission costs
          one credit. Credit rates start at $0.50 and decrease to $0.14 at
          higher tiers. Mastered files stay on our CloudFront CDN for 30
          days—download anything you need to keep beyond that window.
        </p>
      </header>

      <Section title="Environment configuration" defaultOpen>
        <p>
          Create a <code className="font-mono text-xs">.env.local</code> file in
          the project root before running the demo. The variables below mirror
          the production configuration so you can make authenticated requests
          against the live API.
        </p>
        <CodeBlock
          label=".env.local"
          code={`CM_API_KEY=your-live-or-sandbox-key
PARENT_BASE_URL=https://chosenmasters.com
NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL=https://d2ojxa09qsr6gy.cloudfront.net`}
        />
        <p>
          Keep <code className="font-mono text-xs">CM_API_KEY</code>{" "}
          private—expose it only in server-side routes or scripts that proxy
          requests. The <code className="font-mono text-xs">NEXT_PUBLIC_*</code>{" "}
          variables are safe to surface in the browser and power the waveform
          previews inside this documentation site.
        </p>
      </Section>

      <Section title="How the B2B flow works" defaultOpen>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Authenticate every request with the API key provisioned to your
            business account. The live key shown below is automatically injected
            into the code samples when you are signed in.
          </li>
          <li>
            Request a pre-signed upload URL and PUT your mix directly to S3. The
            object key returned is already namespaced to your tenant—no extra
            flags required.
          </li>
          <li>
            Call{" "}
            <code className="font-mono text-xs">POST /api/b2b/mastering</code>{" "}
            with that <code className="font-mono text-xs">s3Key</code> to
            enqueue mastering. This deducts one mastering credit immediately and
            stamps the job with{" "}
            <code className="font-mono text-xs">type: &quot;b2b&quot;</code>,
            bypassing the retail purchase verification flow.
          </li>
          <li>
            Poll{" "}
            <code className="font-mono text-xs">
              GET /api/b2b/mastering/:id
            </code>{" "}
            or{" "}
            <code className="font-mono text-xs">
              GET /api/b2b/mastering/:id/audio
            </code>{" "}
            until the mastered assets are ready. If the engine returns{" "}
            <code className="font-mono text-xs">202 Accepted</code>, begin audio
            polling while CloudFront warms the signed URLs.
          </li>
        </ol>
        <p>
          Expect <span className="font-mono text-xs">401</span> for missing or
          invalid API keys and <span className="font-mono text-xs">403</span>{" "}
          when a tenant runs out of credits. Any other non-2xx response
          indicates the request never reached the mastering engine and should be
          retried after addressing the returned error message.
        </p>
      </Section>

      <Section title="Mastering engine modes" defaultOpen>
        <p>
          The mastering engine exposes three tonal profiles. Include one of
          these values in the <code className="font-mono text-xs">mode</code>{" "}
          field whenever you enqueue a job.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code className="font-mono text-xs">process</code> – Modern sheen
            and width. This is the default used by the demo app and mirrors the
            retail experience.
          </li>
          <li>
            <code className="font-mono text-xs">lite</code> – Open, gentle lift
            that preserves additional transient detail.
          </li>
          <li>
            <code className="font-mono text-xs">warm</code> – Powerful,
            saturated tilt for productions that need extra weight.
          </li>
        </ul>
        <p>
          The playground form and accompanying API route already forward the
          selected
          <code className="font-mono text-xs">mode</code> so you can mirror the
          same field in your own integration.
        </p>
      </Section>

      <Section title="Quick start" defaultOpen>
        <p>
          If you are integrating from a fresh Node.js project, install the
          helper dependencies and create a component like the one in the
          complete example below.
        </p>
        <CodeBlock
          label="Install dependencies"
          code={`npm install axios react-dropzone`}
        ></CodeBlock>
      </Section>

      <Section title="1. Upload to Chosen Masters" defaultOpen>
        <p>
          Request a signed URL from{" "}
          <code className="font-mono text-xs">
            POST /api/b2b/mastering/upload-url
          </code>{" "}
          using your API key in the{" "}
          <code className="font-mono text-xs">x-api-key</code> header. The
          response includes:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-mono text-xs">uploadUrl</span> – pre-signed S3
            destination.
          </li>
          <li>
            <span className="font-mono text-xs">s3Key</span> – send this in Step
            2 to trigger mastering.
          </li>
          <li>
            <span className="font-mono text-xs">headers</span> – required
            headers for the direct S3 upload.
          </li>
          <li>
            <span className="font-mono text-xs">expiresIn</span> – seconds
            before the upload URL becomes invalid.
          </li>
        </ul>
        <p>
          Use the exact headers returned and complete the upload before the
          expiry window closes.
        </p>
        <CodeBlock label="Request upload URL" code={CODE_UPLOAD} />
      </Section>

      <Section title="2. Submit for mastering" defaultOpen>
        <p>
          Once your file is stored, call{" "}
          <code className="font-mono text-xs">POST /api/b2b/mastering</code>{" "}
          with the <code className="font-mono text-xs">s3Key</code> from the
          upload step. Choose a processing mode and send it in the request body.
        </p>
        <p>
          The platform deducts one credit as soon as the job is accepted. A{" "}
          <code className="font-mono text-xs">403</code> response indicates the
          tenant is out of credits—top up before retrying.
        </p>
        <p className="text-xs text-gray-500">
          Mode values: <code className="font-mono text-xs">process</code>{" "}
          (Modern), <code className="font-mono text-xs">lite</code> (Open), or{" "}
          <code className="font-mono text-xs">warm</code> (Powerful).
        </p>
        <CodeBlock label="Submit mastering job" code={CODE_SUBMIT} />
      </Section>

      <Section title="3. Retrieve mastered file" defaultOpen>
        <p>
          Poll the job endpoint until{" "}
          <code className="font-mono text-xs">mastered</code> is true. Every
          response returns{" "}
          <code className="font-mono text-xs">expectedKey</code>,{" "}
          <code className="font-mono text-xs">expectedUrl</code>, and a{" "}
          <code className="font-mono text-xs">deliverables</code> array so you
          can pre-compute CloudFront download paths while the render completes.
        </p>
        <p>
          Once <code className="font-mono text-xs">mastered</code> is true, the
          payload includes a signed CloudFront URL for instant playback. If any
          deliverable is unavailable, continue polling—the job automatically
          refunds its credit if rendering fails.
        </p>
        <CodeBlock label="Poll job status" code={CODE_STATUS} />
      </Section>

      <Section title="4. Stream mastered intensities" defaultOpen>
        <p>
          After the job reports mastered, call{" "}
          <code className="font-mono text-xs">
            GET /api/b2b/mastering/:id/audio
          </code>{" "}
          to retrieve CloudFront URLs for each intensity.{" "}
          <strong>Don’t stop when Level 3 arrives</strong>—keep polling until{" "}
          <em>all</em> requested levels are ready, or until ~30 seconds after
          the first playable CloudFront URL appears (grace window). This mirrors
          the production player and avoids cutting the ladder short while CDN
          links are still warming.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="font-mono text-xs">intensities</span> – array of
            intensity levels with{" "}
            <span className="font-mono text-xs">level</span>,{" "}
            <span className="font-mono text-xs">available</span>,{" "}
            <span className="font-mono text-xs">url</span>,{" "}
            <span className="font-mono text-xs">expiresAt</span>, and{" "}
            <span className="font-mono text-xs">type</span>.
          </li>
          <li>
            <span className="font-mono text-xs">availableLevels</span> –
            mastered intensities ready to play. Clamp UI sliders to these
            values.
          </li>
          <li>
            <span className="font-mono text-xs">requestedLevels</span> – all
            intensities requested during submission; use this to determine when
            “all ready” has been reached.
          </li>
          <li>
            <span className="font-mono text-xs">originalUrl</span> – CloudFront
            playback path for the original upload (available even while masters
            warm).
          </li>
        </ul>
        <p>
          Signed URLs may take a few seconds to warm. The helper below
          implements the recommended strategy: continue polling beyond Level 3,
          and stop either when all{" "}
          <span className="font-mono text-xs">requestedLevels</span> are
          available or ~30 seconds after the first playable URL is detected.
        </p>
        <CodeBlock
          label="Poll intensities until all ready (with 30s CF grace window)"
          code={CODE_AUDIO}
        />
        <p>
          Always feed your audio player a CloudFront-signed
          <code className="font-mono text-xs">.mp3</code>{" "}
          preview. The CDN warms MP3 first, so waiting for another format can
          stall playback even though the mastered ladder is already ready to
          audition.
        </p>
        <p>
          The helper below mirrors the landing page implementation: prefer the
          MP3 preview for streaming, then swap extensions on the same signed path
          when you need a <code className="font-mono text-xs">.wav</code>{" "}
          or alternate download without launching a second mastering pass.
        </p>
        <CodeBlock
          label="Prefer MP3 playback and derive WAV/MP3 downloads"
          code={CODE_PLAYBACK_DOWNLOAD}
        />
        <p>
          The demo download button mirrors the currently selected intensity. Use
          the format picker to toggle the CloudFront link between the mastered
          preview format and a <code className="font-mono text-xs">.wav</code>{" "}
          render—the URL simply swaps extensions before the signed query string
          so you can grab either asset without another mastering pass.
        </p>
      </Section>
    </main>
  );
}
