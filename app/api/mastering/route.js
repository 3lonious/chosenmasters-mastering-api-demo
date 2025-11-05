// app/api/mastering/route.js
export const runtime = "nodejs";
export const maxDuration = 60;

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "content-type, x-api-key, authorization, idempotency-key, Idempotency-Key"
  );
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}
export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

function withTimeout(ms = 25000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, clear: () => clearTimeout(t) };
}
function redact(s) {
  try {
    const str = String(s || "");
    if (str.length <= 18) return "***";
    return `${str.slice(0, 6)}…${str.slice(-6)}`;
  } catch {
    return "***";
  }
}

export async function POST(request) {
  const parentBase = (
    process.env.PARENT_BASE_URL || "https://chosenmasters.com"
  ).replace(/\/+$/, "");
  const partnerKey = process.env.CM_API_KEY || "";
  const idem =
    request.headers.get("Idempotency-Key") ||
    request.headers.get("idempotency-key") ||
    undefined;

  if (!partnerKey) {
    const r = new Response(
      JSON.stringify({ error: "Missing CM_API_KEY in server env" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    const r = new Response(
      JSON.stringify({
        error: "Invalid JSON body",
        detail: String(e?.message || e),
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }

  // Normalize minimally: guarantee `key` exists; strip opinionated fields.
  const ext = (body.ext || (body.s3Key && body.s3Key.split(".").pop()) || "")
    .toLowerCase()
    .trim();
  const sizeMB =
    typeof body.sizeMB === "number"
      ? body.sizeMB
      : typeof body.size === "number"
      ? body.size
      : typeof body.sizeBytes === "number"
      ? Number((body.sizeBytes / 1048576).toFixed(2))
      : undefined;

  const { profile, engine, ...rest } = body || {};
  const payload = {
    ...rest,
    key: body.key || body.s3Key || undefined,
    ext: ext || undefined,
    sizeMB: sizeMB ?? undefined,
    size: sizeMB ?? rest.size, // keep `size` in MB if present
  };

  console.log("[/api/mastering] parentBase:", parentBase);
  console.log("[/api/mastering] outgoing payload:", {
    ...payload,
    key: redact(payload.key),
    s3Key: redact(payload.s3Key),
    mode: payload.mode,
    ext: payload.ext,
    sizeMB: payload.sizeMB,
  });

  // Optional connectivity probe — non-fatal
  try {
    const ping = await fetch(`${parentBase}/robots.txt`, {
      method: "HEAD",
      cache: "no-store",
    });
    console.log("[/api/mastering] ping status:", ping.status);
  } catch (e) {
    console.warn("[/api/mastering] ping error:", e?.message || String(e));
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-key": partnerKey,
  };
  if (idem) headers["Idempotency-Key"] = idem;

  const { signal, clear } = withTimeout(25000);
  let upstream;
  try {
    upstream = await fetch(`${parentBase}/api/b2b/mastering`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal,
    });
  } catch (e) {
    clear();
    const r = new Response(
      JSON.stringify({
        error: "Upstream connect error",
        detail: e?.message || String(e),
        parentBase,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }
  clear();

  const text = await upstream.text();
  const reqId =
    upstream.headers.get("x-request-id") ||
    upstream.headers.get("x-amzn-requestid") ||
    upstream.headers.get("x-upstream-request-id") ||
    "";

  console.log("[/api/mastering] upstream status:", upstream.status);
  if (reqId) console.log("[/api/mastering] upstream request-id:", reqId);
  try {
    const pk = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    console.log("[/api/mastering] upstream body (peek):", pk);
  } catch {}

  const r = new Response(text || "{}", {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(reqId ? { "x-upstream-request-id": reqId } : {}),
    },
  });
  setCors(r);
  return r;
}
