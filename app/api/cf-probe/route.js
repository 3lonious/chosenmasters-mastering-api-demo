// /api/cf-probe  (Next.js App Router example)
export const runtime = "nodejs";

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "content-type");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}
export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

function splitPathAndExt(key) {
  const i = key.lastIndexOf(".");
  return i === -1
    ? { base: key, ext: "" }
    : { base: key.slice(0, i), ext: key.slice(i + 1) };
}
function joinUrl(host, path) {
  const h = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const p = String(path).replace(/^\/+/, "");
  return `https://${h}/${encodeURIComponent(p).replace(/%2F/g, "/")}`;
}

function buildCandidates({ s3Key, exts }) {
  const { base } = splitPathAndExt(s3Key);
  const lastSlash = base.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : base.slice(0, lastSlash);
  const name = lastSlash === -1 ? base : base.slice(lastSlash + 1);

  // likely output folders
  const folders = [
    "",
    "mastered",
    "master",
    "outputs",
    "render",
    "out",
    "final",
    "export",
  ].map((f) => (dir ? (f ? `${dir}/${f}` : dir) : f).replace(/^\/+|\/+$/g, ""));

  // patterns we try in order
  const pat = [
    "{F}/{N}_v1.{E}",
    "{F}/{N}_v2.{E}",
    "{F}/{N}_v3.{E}",
    "{F}/{N}_v4.{E}",
    "{F}/{N}_v5.{E}",
    "{F}/{N}.{E}", // no variant suffix
    "{F}/v1.{E}",
    "{F}/v2.{E}",
    "{F}/{N}/v1.{E}",
    "{F}/{N}/v2.{E}",
    "{F}/{N}/{N}_v1.{E}",
    "{F}/{N}/{N}.{E}",
  ];

  const rels = [];
  for (const F of folders)
    for (const E of exts)
      for (const p of pat) {
        const rel = p
          .replace("{F}", F ? F : "")
          .replace(/\/{2,}/g, "/")
          .replace("{N}", name)
          .replace("{E}", E)
          .replace(/^\/+/, "");
        if (rel) rels.push(rel);
      }
  return [...new Set(rels)];
}

function withTimeout(ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort("timeout"), ms);
  return { signal: c.signal, clear: () => clearTimeout(t) };
}
async function exists(u) {
  const { signal, clear } = withTimeout(8000);
  try {
    const r = await fetch(u, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      cache: "no-store",
      signal,
    });
    clear();
    return r.ok || r.status === 206;
  } catch {
    clear();
    return false;
  }
}

export async function GET(req) {
  const url = new URL(req.url);
  const s3Key = url.searchParams.get("key");
  const extList = (url.searchParams.get("ext") || "mp3,wav,m4a,flac")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const cf = process.env.NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL;
  if (!cf) {
    const r = new Response(
      JSON.stringify({ error: "Missing NEXT_PUBLIC_MASTERING_CLOUDFRONT_URL" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }
  if (!s3Key) {
    const r = new Response(JSON.stringify({ error: "Missing key" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  }

  const candidates = buildCandidates({ s3Key, exts: extList });

  const found = [];
  for (const rel of candidates) {
    const full = joinUrl(cf, rel);
    if (await exists(full)) {
      found.push(full);
      if (found.length >= 3) break;
    }
  }

  // sort by variant number if present
  const sorted = found.sort((a, b) => {
    const ma = a.match(/_v(\d+)\.(mp3|wav|m4a|flac)$/i);
    const mb = b.match(/_v(\d+)\.(mp3|wav|m4a|flac)$/i);
    const va = ma ? parseInt(ma[1], 10) : 999,
      vb = mb ? parseInt(mb[1], 10) : 999;
    return va - vb;
  });

  const r = new Response(
    JSON.stringify({
      success: true,
      mastered: sorted.length > 0,
      urls: sorted,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
  setCors(r);
  return r;
}
