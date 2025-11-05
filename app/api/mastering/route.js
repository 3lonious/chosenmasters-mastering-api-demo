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

function withTimeout(ms = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
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
      JSON.stringify({
        error: "Missing PARTNER_API_KEY/CM_API_KEY in server env",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
    setCors(r);
    return r;
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    const r = new Response(
      JSON.stringify({ error: "Invalid JSON body", detail: e?.message }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
    setCors(r);
    return r;
  }

  // Normalize size
  if (typeof body.size === "string") {
    const n = Number(body.size);
    if (!Number.isNaN(n)) body.size = n;
  }

  console.log("[/api/mastering] parentBase:", parentBase);
  console.log("[/api/mastering] body:", {
    ...body,
    s3Key: redact(body?.s3Key),
    ext: body?.ext,
    size: body?.size,
    mode: body?.mode,
  });

  // ---- quick connectivity probe (HEAD robots.txt) ----
  try {
    const ping = await fetch(`${parentBase}/robots.txt`, {
      method: "HEAD",
      cache: "no-store",
    });
    console.log("[/api/mastering] ping status:", ping.status);
  } catch (e) {
    const r = new Response(
      JSON.stringify({
        error: "Cannot reach parent host",
        detail: e?.message || String(e),
        parentBase,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }

  // ---- forward to upstream ----
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": partnerKey,
  };
  if (idem) headers["idempotency-key"] = idem;

  const { signal, clear } = withTimeout(25000);
  let upstream;
  try {
    upstream = await fetch(`${parentBase}/api/b2b/mastering`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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
    "";

  console.log("[/api/mastering] upstream status:", upstream.status);
  if (reqId) console.log("[/api/mastering] upstream request-id:", reqId);
  console.log("[/api/mastering] upstream body (peek):", text.slice(0, 300));

  // Pass through upstream status EXACTLY (no 502 rewrite)
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
