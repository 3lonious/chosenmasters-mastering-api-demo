// app/mastering-docs/page.js
"use client";

import React, { useCallback, useMemo, useState } from "react";

/** -------------------------------------------------------------------------
 * Small UI helpers
 * ------------------------------------------------------------------------- */
function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-gray-200 rounded-xl bg-white/60 backdrop-blur-sm shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <span className="text-gray-500">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function Code({ children }) {
  return (
    <pre className="relative group">
      <code className="block overflow-x-auto rounded-lg bg-gray-900 text-gray-100 text-sm leading-relaxed p-4">
        {children}
      </code>
    </pre>
  );
}

function CodeBlock({ label, code }) {
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      alert("Copied!");
    } catch {
      // fallback
    }
  }, [code]);

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <button
          onClick={copy}
          className="px-3 py-1.5 text-xs rounded-md bg-gray-900 text-white hover:bg-black active:scale-[.98]"
        >
          Copy
        </button>
      </div>
      <Code>{code}</Code>
    </div>
  );
}

/** -------------------------------------------------------------------------
 * Exact source code (kept as strings so devs can copy/paste)
 * ------------------------------------------------------------------------- */

// 1) Child app — Upload URL proxy (mints S3 signed PUT via parent)
const SRC_child_upload_url = `export const runtime = "nodejs";

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type, x-api-key, authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}

export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

export async function POST(req) {
  const parent = process.env.PARENT_BASE_URL;        // e.g. https://chosenmasters.com
  const key = process.env.PARTNER_API_KEY || process.env.CM_API_KEY || "";
  if (!parent) {
    const r = new Response(JSON.stringify({ error: "Missing PARENT_BASE_URL" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
    setCors(r);
    return r;
  }

  const body = await req.json(); // { fileName, fileType }
  const upstream = await fetch(\`\${parent}/api/b2b/mastering/upload-url\`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });

  const text = await upstream.text();
  const r = new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
  setCors(r);
  return r;
}
`;

// 2) Parent app — upload-url (generates S3 signed PUT)
// (You already have this — leaving it here for completeness/side-by-side)
const SRC_parent_upload_url = `import AWS from "aws-sdk";
import { v4 as uuidv4 } from "uuid";
import dbConnect from "../../../../db/db";
import BusinessClients from "../../../../models/BusinessClients";

const REGION = process.env.BUCKET_REGION_MASTERING || process.env.BUCKET_REGION;
const ACCESS_KEY =
  process.env.AWS_ACCESS_KEY_MASTERING ||
  process.env.AWS_ACCESS_KEY ||
  process.env.NEXT_PUBLIC_AWS_ACCESS_KEY;
const SECRET_KEY =
  process.env.AWS_SECRET_ACCESS_KEY_MASTERING ||
  process.env.AWS_SECRET_ACCESS_KEY ||
  process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY;

const s3 = new AWS.S3({
  region: REGION,
  signatureVersion: "v4",
  accessKeyId: ACCESS_KEY,
  secretAccessKey: SECRET_KEY,
});

const URL_EXPIRATION_SECONDS = 15 * 60; // 15 minutes

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey =
    req.headers["x-api-key"] || req.headers.authorization?.replace("Bearer ", "");

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const bucket = process.env.MASTERING_BUCKET;

  if (!bucket) {
    return res.status(500).json({ error: "Missing MASTERING_BUCKET" });
  }

  const { fileName, fileType, extension } = req.body || {};

  if (!fileName && !extension) {
    return res
      .status(400)
      .json({ error: "Provide fileName or extension to determine file type" });
  }

  const contentType = fileType || "application/octet-stream";
  const extFromName =
    (extension || fileName?.split(".").pop() || "")
      .trim()
      .toLowerCase();

  if (!extFromName) {
    return res.status(400).json({ error: "Unable to determine file extension" });
  }

  try {
    await dbConnect();
    const client = await BusinessClients.findOne({ apiKey });

    if (!client) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const objectKey = \`b2b/mastering/\${client._id}/\${uuidv4()}.\${extFromName}\`;

    const params = {
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
      Expires: URL_EXPIRATION_SECONDS,
    };

    const uploadUrl = await s3.getSignedUrlPromise("putObject", params);

    return res.status(200).json({
      success: true,
      uploadUrl,
      s3Key: objectKey,
      expiresIn: URL_EXPIRATION_SECONDS,
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    console.error("B2B upload-url error", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
`;

// 3) Child app — submit mastering (optimistic 202 allowed)
const SRC_child_mastering_submit = `export const runtime = "nodejs";

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type, x-api-key, authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}

export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

// Proxies to parent: POST /api/b2b/mastering
export async function POST(req) {
  const parent = process.env.PARENT_BASE_URL;
  const key = process.env.PARTNER_API_KEY || process.env.CM_API_KEY || "";
  if (!parent) {
    const r = new Response(JSON.stringify({ error: "Missing PARENT_BASE_URL" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
    setCors(r);
    return r;
  }

  const body = await req.json(); // { s3Key, title, ext, size, mode }
  const upstream = await fetch(\`\${parent}/api/b2b/mastering\`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });

  // Important: upstream may return 202 or 200 + {jobId}
  const text = await upstream.text();
  const r = new Response(text || "{}", {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
  setCors(r);
  return r;
}
`;

// 4) Child app — poll job status via parent (fix for params.await)
const SRC_child_mastering_poll = `export const runtime = "nodejs";

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type, x-api-key, authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}

export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

export async function GET(_req, ctx) {
  const p = ctx?.params && typeof ctx.params.then === "function" ? await ctx.params : ctx.params;
  const jobId = p?.jobId;
  if (!jobId) {
    const r = new Response(JSON.stringify({ error: "Missing jobId" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
    setCors(r);
    return r;
  }

  const parent = process.env.PARENT_BASE_URL || "https://chosenmasters.com";
  const key = process.env.PARTNER_API_KEY || process.env.CM_API_KEY || "";

  try {
    const upstream = await fetch(\`\${parent}/api/b2b/mastering/\${jobId}\`, {
      headers: { "x-api-key": key, "Accept": "application/json" },
      cache: "no-store",
    });
    const txt = await upstream.text();
    const r = new Response(txt || "{}", {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  } catch (e) {
    const r = new Response(JSON.stringify({ error: \`Proxy poll error: \${e.message}\` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
    setCors(r);
    return r;
  }
}
`;

// 5) Child app — CloudFront probe (checks v1..v5 across multiple ext)
const SRC_child_cf_probe = `export const runtime = "nodejs";

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}

function withTimeout(ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort("timeout"), ms);
  return { signal: c.signal, clear: () => clearTimeout(t) };
}
function splitPathAndExt(key) {
  const i = key.lastIndexOf(".");
  if (i === -1) return { base: key, ext: "" };
  return { base: key.slice(0, i), ext: key.slice(i + 1) };
}
function joinUrl(host, path) {
  const h = host.replace(/^https?:\\/\\//, "").replace(/\\/$/, "");
  const p = String(path).replace(/^\\/+/, "");
  return \`https://\${h}/\${encodeURIComponent(p).replace(/%2F/g, "/")}\`;
}

export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

/**
 * GET /api/cf-probe?key=<s3Key>&ext=mp3,wav,m4a,flac
 * Tries:
 *   dir/name_v1..v5.ext
 *   dir/name/v1..v5.ext
 *   dir/mastered/name_v1..v5.ext   (optional)
 */
export async function GET(req) {
  const url = new URL(req.url);
  const s3Key = url.searchParams.get("key");
  const extParam = (url.searchParams.get("ext") || "mp3").toLowerCase();
  const exts = extParam.split(",").map(s => s.trim()).filter(Boolean);

  const cf = process.env.NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL;
  if (!cf) {
    const r = new Response(JSON.stringify({ error: "Missing NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
    setCors(r); return r;
  }
  if (!s3Key) {
    const r = new Response(JSON.stringify({ error: "Missing key" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
    setCors(r); return r;
  }

  const { base } = splitPathAndExt(s3Key);
  const lastSlash = base.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : base.slice(0, lastSlash);
  const name = lastSlash === -1 ? base : base.slice(lastSlash + 1);

  function relsForExt(e) {
    const variants = Array.from({ length: 5 }, (_, i) => i + 1);
    return [
      // suffix pattern
      ...variants.map(v => dir ? \`\${dir}/\${name}_v\${v}.\${e}\` : \`\${name}_v\${v}.\${e}\`),
      // folder pattern
      ...variants.map(v => dir ? \`\${dir}/\${name}/v\${v}.\${e}\` : \`\${name}/v\${v}.\${e}\`),
      // optional "mastered" subfolder
      ...variants.map(v => dir ? \`\${dir}/mastered/\${name}_v\${v}.\${e}\` : \`mastered/\${name}_v\${v}.\${e}\`),
    ];
  }

  const pathsToTry = exts.flatMap(relsForExt);

  async function exists(fullUrl) {
    const { signal, clear } = withTimeout(8000);
    try {
      const res = await fetch(fullUrl, { method: "GET", headers: { Range: "bytes=0-1" }, signal });
      clear();
      return res.ok || res.status === 206;
    } catch {
      clear();
      return false;
    }
  }

  const found = [];
  for (const rel of pathsToTry) {
    const full = joinUrl(cf, rel);
    /* eslint-disable no-await-in-loop */
    if (await exists(full)) found.push(full);
  }

  const r = new Response(JSON.stringify({
    success: true,
    mastered: found.length > 0,
    urls: found,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  setCors(r);
  return r;
}
`;

// 6) Child app — Demo UI page (the working one with CF probe + parent polling)
const SRC_child_demo_page = `"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import axios from "axios";

/* ---------- helpers ---------- */

// Hit your /api/cf-probe route to look for mastered outputs (v1..v5) on CloudFront
async function probeCloudFront(s3Key, { setStatus, onFound }) {
  try {
    const res = await fetch(
      \`/api/cf-probe?key=\${encodeURIComponent(s3Key)}&ext=mp3,wav,m4a,flac\`,
      { cache: "no-store" }
    );
    if (!res.ok) return false;

    const data = await res.json(); // { success, mastered, urls: [] }
    if (typeof window !== "undefined" && !window.__cm_cf_probe_once__) {
      window.__cm_cf_probe_once__ = true;
      console.log("[cf-probe]", data);
    }
    if (data.mastered && Array.isArray(data.urls) && data.urls.length) {
      onFound(data.urls);
      setStatus("Mastered files ready.");
      return true;
    }
  } catch {}
  return false;
}

// Cancelable CF poller (recursive setTimeout to avoid overlapping calls)
function makeCfPoller({ s3Key, setStatus, onFound, intervalMs = 3000, maxMs = 12 * 60 * 1000 }) {
  let canceled = false;
  const start = Date.now();

  async function tick() {
    if (canceled) return;
    const ok = await probeCloudFront(s3Key, { setStatus, onFound });
    if (ok || canceled) return;

    const elapsed = Math.round((Date.now() - start) / 1000);
    setStatus(\`Watching CloudFront… (\${elapsed}s)\`);

    if (Date.now() - start >= maxMs) {
      setStatus("Still processing. If this persists, verify pipeline paths and CloudFront origin.");
      return;
    }
    setTimeout(tick, intervalMs);
  }

  tick();
  return () => { canceled = true; };
}

function buildVariantsFrom(url) {
  const m = url.match(/(?:\\/|_)v(\\d+)\\.(mp3|wav|m4a|flac)$/i); // folder or suffix style
  if (!m) return [url];
  const ext = m[2];
  const base = url.replace(/(?:\\/|_)v\\d+\\.(mp3|wav|m4a|flac)$/i, "");
  return Array.from({ length: 5 }, (_, i) => \`\${base}_v\${i + 1}.\${ext}\`);
}

// Optional: parent poller (only used if a jobId is returned)
function makeParentPoller({ setStatus, onDone }) {
  return (jobId) => {
    let canceled = false;
    const controller = new AbortController();

    async function tick() {
      try {
        const r = await fetch(\`/api/mastering/\${jobId}\`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(await r.text());
        const d = await r.json();

        if (typeof window !== "undefined" && !window.__cm_polled_once__) {
          window.__cm_polled_once__ = true;
          console.log("[parent poll payload]", d);
        }

        setStatus(\`Status: \${d.mastered ? "mastered" : "processing"}\${d.error ? \` (error: \${d.error})\` : ""}\`);

        if (d.mastered && d.url) {
          if (!canceled) onDone(d.url);
          return; // stop polling
        }
      } catch {}
      if (!canceled) setTimeout(tick, 3000);
    }

    tick();
    return () => { canceled = true; controller.abort(); };
  };
}

/* ---------- page ---------- */

export default function Page() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("process"); // process | lite | warm
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);

  // UI for multiple mastered variants (v1..v5)
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState(null);
  const [masteredFiles, setMasteredFiles] = useState([]);
  const [selectedMasteredIndex, setSelectedMasteredIndex] = useState(0);
  const [isOriginal, setIsOriginal] = useState(true);

  // refs
  const parentPollCancelRef = useRef(null);
  const cfPollCancelRef = useRef(null);
  const s3KeyRef = useRef(null);

  const onDrop = useCallback((accepted) => {
    if (!accepted?.length) return;
    const f = accepted[0];

    // cleanup previous
    if (originalPreviewUrl) {
      try { URL.revokeObjectURL(originalPreviewUrl); } catch {}
    }
    if (parentPollCancelRef.current) { parentPollCancelRef.current(); parentPollCancelRef.current = null; }
    if (cfPollCancelRef.current) { cfPollCancelRef.current(); cfPollCancelRef.current = null; }

    setFile(f);
    setTitle(f.name.replace(/\\.[^/.]+$/, ""));
    setStatus(\`Selected: \${f.name} (\${(f.size / (1024 * 1024)).toFixed(2)} MB)\`);
    setProgress(0);
    setJobId(null);
    setDownloadUrl(null);
    setOriginalPreviewUrl(URL.createObjectURL(f));
    setMasteredFiles([]);
    setSelectedMasteredIndex(0);
    setIsOriginal(true);
    s3KeyRef.current = null;
  }, [originalPreviewUrl]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: { "audio/*": [".wav", ".aiff", ".aif", ".mp3", ".flac", ".ogg", ".m4a"] },
  });

  const border = useMemo(
    () => (isDragActive ? "3px dashed #4f46e5" : "3px dashed #9ca3af"),
    [isDragActive]
  );

  // parent poller instance
  const startParentPolling = useMemo(() =>
    makeParentPoller({
      setStatus,
      onDone: (url) => {
        if (cfPollCancelRef.current) { cfPollCancelRef.current(); cfPollCancelRef.current = null; }
        setDownloadUrl(url);
        const variants = buildVariantsFrom(url);
        setMasteredFiles(variants);
        setSelectedMasteredIndex(Math.min(1, variants.length - 1));
        setIsOriginal(false);
      },
    }),
  [setStatus]);

  useEffect(() => {
    return () => {
      if (parentPollCancelRef.current) parentPollCancelRef.current();
      if (cfPollCancelRef.current) cfPollCancelRef.current();
      if (originalPreviewUrl) { try { URL.revokeObjectURL(originalPreviewUrl); } catch {} }
    };
  }, [originalPreviewUrl]);

  async function handleStart() {
    try {
      if (!file) return;
      setStatus("Requesting upload URL…");

      // 1) Get signed URL
      const up = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type || "audio/wav",
        }),
      });
      if (!up.ok) {
        const t = await up.text();
        throw new Error(\`Upload-URL failed: \${t || up.status}\`);
      }
      const { uploadUrl, s3Key, headers, expiresIn } = await up.json();
      s3KeyRef.current = s3Key;
      setStatus(\`Got signed URL (expires in \${expiresIn}s). Uploading to S3…\`);

      // 2) Upload to S3
      await axios.put(uploadUrl, file, {
        headers,
        onUploadProgress: (e) => {
          if (!e.total) return;
          setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      setStatus("Upload complete. Submitting mastering job…");

      // 3) Submit to parent (optimistic: don't require jobId)
      const ext = (file.name.split(".").pop() || "wav").toLowerCase();
      const sizeMbStr = (file.size / (1024 * 1024)).toFixed(2);

      const sub = await fetch("/api/mastering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Key, title: title || file.name, ext, size: sizeMbStr, mode }),
      });

      // 4) Start CloudFront probe immediately (works even if no jobId ever returns)
      if (cfPollCancelRef.current) cfPollCancelRef.current();
      cfPollCancelRef.current = makeCfPoller({
        s3Key,
        setStatus,
        onFound: (urls) => {
          // sanitize + smart sort
          const cleaned = urls.filter(Boolean).filter(u => !/%7B|%7D|\\{|\\}/i.test(u));
          const seen = new Set();
          const uniq = cleaned.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
          function getV(u) {
            const a = u.match(/\\/v(\\d+)\\.(mp3|wav|m4a|flac)$/i);
            const b = u.match(/_v(\\d+)\\.(mp3|wav|m4a|flac)$/i);
            const m = a || b; return m ? parseInt(m[1], 10) : 999;
          }
          function extRank(u){ return /.mp3$/i.test(u)?0:/.m4a$/i.test(u)?1:/.wav$/i.test(u)?2:3; }
          const sorted = uniq.sort((A,B)=> {
            const ea=extRank(A), eb=extRank(B); if (ea!==eb) return ea-eb;
            const va=getV(A), vb=getV(B); if (va!==vb) return va-vb;
            return A.length - B.length;
          });
          if (sorted.length === 0) { setStatus("Mastered detected, but invalid URLs."); return; }

          setDownloadUrl(sorted[0]);
          setMasteredFiles(sorted);
          setSelectedMasteredIndex(0);
          setIsOriginal(false);
          setStatus("Mastered file available (CloudFront)");
        },
      });

      // Handle submit response once
      if (sub.status === 202) {
        setStatus("Submit accepted (upstream busy). Watching CloudFront…");
      } else if (!sub.ok) {
        const t = await sub.text();
        throw new Error(\`Submit failed: \${t || sub.status}\`);
      } else {
        let payload = null;
        try { payload = await sub.json(); } catch {}
        const jid = payload?.jobId;
        if (jid) {
          setJobId(jid);
          setStatus(\`Job queued: \${jid}. Polling parent + CloudFront…\`);
          if (parentPollCancelRef.current) parentPollCancelRef.current();
          parentPollCancelRef.current = startParentPolling(jid);
        } else {
          setStatus("Submitted. No jobId returned; probing CloudFront…");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(\`Error: \${(err && err.message) || String(err)}\`);
      if (parentPollCancelRef.current) { parentPollCancelRef.current(); parentPollCancelRef.current = null; }
      if (cfPollCancelRef.current) { cfPollCancelRef.current(); cfPollCancelRef.current = null; }
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-semibold mb-2">Chosen Masters — B2B Mastering Demo</h1>
      <p className="text-gray-600 mb-4">
        Drop a mix to upload via a signed URL, submit for mastering, then we’ll watch CloudFront for your mastered links.
      </p>

      <Drop onDrop={onDrop} isDragActive={isDragActive} getRootProps={getRootProps} getInputProps={getInputProps} border={border} />

      <Labeled label="Track Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="My Track"
          className="w-full mt-1 p-2.5 rounded-lg border border-gray-200"
        />
      </Labeled>

      <Labeled label="Mode">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="w-full mt-1 p-2.5 rounded-lg border border-gray-200 bg-white"
        >
          <option value="process">process (Modern)</option>
          <option value="lite">lite (Open)</option>
          <option value="warm">warm (Powerful)</option>
        </select>
      </Labeled>

      <button
        onClick={handleStart}
        disabled={!file}
        className={\`px-4 py-3 rounded-lg text-white border \${file ? "bg-gray-900 border-gray-900 hover:bg-black" : "bg-gray-400 border-gray-400 cursor-not-allowed"}\`}
      >
        {file ? "Start Mastering" : "Select a file first"}
      </button>

      {progress > 0 && progress < 100 && (
        <div className="mt-4">
          <div className="text-sm mb-1">Uploading: {progress}%</div>
          <div className="h-2 bg-gray-200 rounded-full">
            <div className="h-2 rounded-full bg-indigo-600 transition-[width] duration-200" style={{ width: \`\${progress}%\` }} />
          </div>
        </div>
      )}

      <div className="mt-4 text-gray-900">{status}</div>

      {jobId && !downloadUrl && (
        <div className="text-xs text-gray-500 mt-1">Job ID: {jobId}</div>
      )}

      {(originalPreviewUrl || masteredFiles.length > 0) && (
        <div className="mt-4">
          <div className="flex gap-2 flex-wrap">
            {originalPreviewUrl && (
              <Toggle onClick={() => setIsOriginal(true)} active={isOriginal}>Original</Toggle>
            )}
            {masteredFiles.map((u, i) => (
              <Toggle key={u} onClick={() => { setSelectedMasteredIndex(i); setIsOriginal(false); }} active={!isOriginal && selectedMasteredIndex === i}>
                Master v{i + 1}
              </Toggle>
            ))}
          </div>

          <div className="mt-2">
            <audio
              key={(isOriginal ? originalPreviewUrl : masteredFiles[selectedMasteredIndex]) || "empty"}
              controls
              crossOrigin="anonymous"
              src={isOriginal ? (originalPreviewUrl || undefined) : (masteredFiles[selectedMasteredIndex] || undefined)}
              className="w-full"
            />
          </div>
        </div>
      )}

      {downloadUrl && (
        <div className="mt-4">
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block px-4 py-2.5 rounded-lg bg-emerald-600 text-white"
          >
            Download Mastered File
          </a>
          <div className="text-xs text-gray-500 mt-1">
            CloudFront link remains available ~30 days — save what you want to keep.
          </div>
        </div>
      )}
    </main>
  );
}

function Drop({onDrop, isDragActive, getRootProps, getInputProps, border}) {
  return (
    <div
      {...getRootProps()}
      className="rounded-xl p-6 text-center cursor-pointer mb-4"
      style={{ border }}
    >
      <input {...getInputProps()} />
      <strong>{isDragActive ? "Release to drop" : "Drag & drop your audio here"}</strong>
      <div className="text-xs text-gray-500 mt-1">Supported: WAV, AIFF, MP3, FLAC, OGG, M4A</div>
    </div>
  );
}

function Labeled({label, children}) {
  return (
    <label className="block mb-4">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      {children}
    </label>
  );
}

function Toggle({children, onClick, active}) {
  return (
    <button
      onClick={onClick}
      className={\`px-3 py-2 rounded-lg border text-sm \${active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-900 border-gray-200"}\`}
    >
      {children}
    </button>
  );
}
`;

/** -------------------------------------------------------------------------
 * Page: visually organized docs
 * ------------------------------------------------------------------------- */
export default function MasteringDocsPage() {
  const fileTree = useMemo(
    () =>
      `
app/
  mastering-docs/
    page.js                       # ← THIS docs page
  api/
    upload-url/
      route.js                    # (child) proxy to parent upload-url
    mastering/
      route.js                    # (child) submit mastering (POST)
      [jobId]/
        route.js                  # (child) poll mastering job (GET)
    cf-probe/
      route.js                    # (child) probe CloudFront for outputs
  (demo)
  page.js                         # (child) demo UI with CF probe + parent poll
`.trim(),
    []
  );

  const envTable = [
    ["PARENT_BASE_URL", "Child", "https://chosenmasters.com"],
    ["PARTNER_API_KEY", "Child", "Your B2B key (server-side only)"],
    ["CM_API_KEY", "Child (alt)", "Alias supported in proxies"],
    [
      "NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL",
      "Child",
      "e.g. https://d2ojxa09qsr6gy.cloudfront.net",
    ],
    ["MASTERING_BUCKET", "Parent", "S3 bucket where inputs/outputs live"],
    [
      "AWS_ACCESS_KEY_MASTERING / AWS_SECRET_ACCESS_KEY_MASTERING",
      "Parent",
      "S3 credentials",
    ],
    ["BUCKET_REGION_MASTERING", "Parent", "Bucket region (e.g., us-west-2)"],
  ];

  const curlSubmit = `
# 1) Get signed PUT
curl -X POST \${CHILD}/api/upload-url \\
  -H 'Content-Type: application/json' \\
  -d '{"fileName":"mix.wav","fileType":"audio/wav"}'

# → returns { uploadUrl, s3Key, headers }

# 2) Upload the file to signed URL
curl -X PUT "\${uploadUrl}" --data-binary @mix.wav -H "Content-Type: audio/wav"

# 3) Submit mastering (optimistic)
curl -X POST \${CHILD}/api/mastering \\
  -H 'Content-Type: application/json' \\
  -d '{"s3Key":"b2b/mastering/<client>/<uuid>.wav","title":"My Track","ext":"wav","size":"8.52","mode":"process"}'

# 4) (Optional) Poll job if jobId returned
curl \${CHILD}/api/mastering/<jobId>

# 5) (Always) Probe CloudFront by original s3Key until v1..v5 appear
curl "\${CHILD}/api/cf-probe?key=b2b/mastering/<client>/<uuid>.wav&ext=mp3,wav,m4a"
`.trim();

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">
          B2B Mastering — Developer Documentation
        </h1>
        <p className="text-gray-600">
          Drop-in routes and UI for partner integrations. This page shows the
          exact files and how they fit together.
        </p>
      </header>

      <Section title="Overview" defaultOpen>
        <div className="prose max-w-none">
          <p>
            The child app keeps your partner API key server-side and proxies to
            the parent platform. Mastering completion is detected via two paths:
          </p>
          <ul>
            <li>
              <b>Parent poll</b> — if the parent returns a <code>jobId</code>,
              we poll <code>/api/mastering/[jobId]</code>.
            </li>
            <li>
              <b>CloudFront probe</b> — independent check for{" "}
              <code>v1..v5</code> outputs at predictable paths by the original{" "}
              <code>s3Key</code>.
            </li>
          </ul>
          <p>
            The UI will show the first valid mastered URL (preferring{" "}
            <code>mp3</code>, then ascending variant number).
          </p>
        </div>
      </Section>

      <Section title="File tree" defaultOpen>
        <Code>{fileTree}</Code>
      </Section>

      <Section title="Environment variables" defaultOpen>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">App</th>
                <th className="text-left p-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {envTable.map(([name, app, notes]) => (
                <tr key={name} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 font-mono">{name}</td>
                  <td className="p-2">{app}</td>
                  <td className="p-2">{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Tip: Don’t include trailing slash on{" "}
          <code>NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL</code>.
        </p>
      </Section>

      <Section title="Endpoints & cURL">
        <ul className="text-sm list-disc pl-5 space-y-1">
          <li>
            <code>POST /api/upload-url</code> → proxies to parent to mint signed
            S3 PUT
          </li>
          <li>
            <code>POST /api/mastering</code> → proxies to parent to submit
            mastering (may return <code>202</code>)
          </li>
          <li>
            <code>GET /api/mastering/[jobId]</code> → poll parent (only if{" "}
            <code>jobId</code> was issued)
          </li>
          <li>
            <code>GET /api/cf-probe?key=&lt;s3Key&gt;&amp;ext=mp3,wav,m4a</code>{" "}
            → detect mastered outputs via CloudFront
          </li>
        </ul>
        <CodeBlock label="Quick cURL flow" code={curlSubmit} />
      </Section>

      <Section title="Child API — upload-url (proxy)" defaultOpen>
        <CodeBlock
          label="app/api/upload-url/route.js"
          code={SRC_child_upload_url}
        />
      </Section>

      <Section title="Parent API — upload-url (S3 presign)">
        <CodeBlock
          label="pages/api/b2b/mastering/upload-url.js (parent)"
          code={SRC_parent_upload_url}
        />
      </Section>

      <Section title="Child API — submit mastering (proxy)" defaultOpen>
        <CodeBlock
          label="app/api/mastering/route.js"
          code={SRC_child_mastering_submit}
        />
      </Section>

      <Section title="Child API — poll mastering (proxy)">
        <CodeBlock
          label="app/api/mastering/[jobId]/route.js"
          code={SRC_child_mastering_poll}
        />
      </Section>

      <Section title="Child API — CloudFront probe (v1..v5)">
        <CodeBlock
          label="app/api/cf-probe/route.js"
          code={SRC_child_cf_probe}
        />
      </Section>

      <Section title="Demo UI — Drag & Drop, Submit, Poll/Probe" defaultOpen>
        <CodeBlock label="app/page.js (demo)" code={SRC_child_demo_page} />
      </Section>

      <Section title="Troubleshooting">
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>
            <b>202 on submit:</b> normal. UI watches CloudFront until outputs
            exist.
          </li>
          <li>
            <b>No audio in player:</b> verify URLs don’t contain placeholders
            like <code>{`{N}`}</code>; page sanitizes these.
          </li>
          <li>
            <b>Safari range/CORS:</b> ensure CF behavior allows{" "}
            <code>GET/HEAD</code> and returns{" "}
            <code>Access-Control-Allow-Origin: *</code>. Audio tag uses{" "}
            <code>crossOrigin="anonymous"</code>.
          </li>
          <li>
            <b>Trailing slashes:</b> keep{" "}
            <code>NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL</code> without trailing
            slash.
          </li>
          <li>
            <b>Parent jobId never returns:</b> fine — CF probe covers this
            retail-like flow.
          </li>
        </ul>
      </Section>

      <footer className="text-xs text-gray-500 pt-2">
        Last updated: today • Keep parent logic authoritative for auth/credits.
        Child stays stateless.
      </footer>
    </main>
  );
}
