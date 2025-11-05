// app/api/mastering/route.js
export const runtime = "nodejs";
export const maxDuration = 60;

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "content-type, x-api-key, authorization, idempotency-key"
  );
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}

export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

function withTimeout(ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
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
  const partnerKey =
    process.env.PARTNER_API_KEY || process.env.CM_API_KEY || "";
  const idem =
    request.headers.get("idempotency-key") ||
    request.headers.get("Idempotency-Key") ||
    undefined;

  if (!partnerKey) {
    const r = new Response(
      JSON.stringify({ error: "Missing PARTNER_API_KEY or CM_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }

  let body;
  try {
    body = await request.json(); // { s3Key, title, ext, size, mode }
  } catch (e) {
    const r = new Response(
      JSON.stringify({ error: "Invalid JSON body", detail: e?.message }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }

  // Normalize: size must be a number
  if (body && typeof body.size === "string") {
    const n = Number(body.size);
    if (!Number.isNaN(n)) body.size = n;
  }

  // Minimal server log (won't leak secrets)
  console.log("[/api/mastering] parentBase:", parentBase);
  console.log("[/api/mastering] body:", {
    ...body,
    s3Key: redact(body?.s3Key),
    title: body?.title,
    ext: body?.ext,
    size: body?.size,
    mode: body?.mode,
  });

  const hdrs = {
    "Content-Type": "application/json",
    "x-api-key": partnerKey,
  };
  if (idem) hdrs["idempotency-key"] = idem;

  const { signal, clear } = withTimeout(12000);
  let upstream;
  try {
    upstream = await fetch(`${parentBase}/api/b2b/mastering`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (e) {
    clear();
    // Treat true timeouts as accepted so CF probe can continue working
    if (String(e?.message || e) === "timeout") {
      const r = new Response(
        JSON.stringify({ accepted: true, reason: "submit-timeout" }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
      setCors(r);
      return r;
    }
    const r = new Response(
      JSON.stringify({
        error: "Upstream connect error",
        detail: e?.message || String(e),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }
  clear();

  // Pass through upstream response exactly (status + json)
  const text = await upstream.text();
  // Log the *status* and a shortened body for debugging 502s
  console.log("[/api/mastering] upstream status:", upstream.status);
  try {
    const peek = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    console.log("[/api/mastering] upstream body (peek):", peek);
  } catch {}

  const r = new Response(text || "{}", {
    status: upstream.status || 502,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
  setCors(r);
  return r;
}
