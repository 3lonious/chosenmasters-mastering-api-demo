// app/api/upload-url/route.js
export const runtime = "nodejs";
export const maxDuration = 60;

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "content-type, x-api-key, authorization"
  );
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Cache-Control", "no-store");
}

export async function OPTIONS() {
  const r = new Response(null, { status: 200 });
  setCors(r);
  return r;
}

function withTimeout(ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function POST(request) {
  // 1) Parse and validate body
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

  const fileName = String(body?.fileName || "").trim();
  const fileType = String(body?.fileType || "audio/wav").trim();

  if (!fileName) {
    const r = new Response(JSON.stringify({ error: "Missing fileName" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  }

  // 2) Read env
  const parentBase = (
    process.env.PARENT_BASE_URL || "https://chosenmasters.com"
  ).replace(/\/+$/, "");
  const apiKey = process.env.CM_API_KEY || "";

  if (!apiKey) {
    const r = new Response(JSON.stringify({ error: "Missing CM_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  }

  // 3) Call upstream with timeout
  const { signal, clear } = withTimeout(15000);
  let upstream;
  try {
    upstream = await fetch(`${parentBase}/api/b2b/mastering/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ fileName, fileType }),
      cache: "no-store",
      signal,
    });
  } catch (e) {
    clear();
    const r = new Response(
      JSON.stringify({
        error: "Upstream connect error",
        detail: String(e?.message || e),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }
  clear();

  // 4) Pass upstream through exactly (status, body, content-type, request id)
  const text = await upstream.text();
  const contentType =
    upstream.headers.get("content-type") || "application/json";
  const reqId =
    upstream.headers.get("x-request-id") ||
    upstream.headers.get("x-amzn-requestid") ||
    upstream.headers.get("x-upstream-request-id") ||
    "";

  // Optional logging (helpful while stabilizing)
  console.log("[/api/upload-url] upstream status:", upstream.status);
  if (reqId) console.log("[/api/upload-url] upstream request-id:", reqId);
  try {
    const peek = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    console.log("[/api/upload-url] upstream body (peek):", peek);
  } catch {}

  const r = new Response(text || "{}", {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      ...(reqId ? { "x-upstream-request-id": reqId } : {}),
    },
  });
  setCors(r);
  return r;
}
