// app/api/mastering/[jobId]/route.js
export const runtime = "nodejs";
export const maxDuration = 60;

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
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

export async function GET(request, context) {
  let params = context?.params;
  if (params && typeof params.then === "function") params = await params;

  const jobId = params?.jobId;
  const parentBase = (
    process.env.PARENT_BASE_URL || "https://chosenmasters.com"
  ).replace(/\/+$/, "");
  const partnerKey =
    process.env.PARTNER_API_KEY || process.env.CM_API_KEY || "";

  if (!jobId) {
    const r = new Response(JSON.stringify({ error: "Missing jobId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  }
  if (!partnerKey) {
    const r = new Response(
      JSON.stringify({ error: "Missing PARTNER_API_KEY or CM_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }

  console.log("[/api/mastering/[jobId]] parentBase:", parentBase);
  console.log("[/api/mastering/[jobId]] jobId:", jobId);

  const hdrs = {
    Accept: "application/json",
    "x-api-key": partnerKey,
  };

  const url = new URL(request.url);
  const qs = url.search || "";
  const upstreamUrl = `${parentBase}/api/b2b/mastering/${encodeURIComponent(
    jobId
  )}${qs}`;

  const { signal, clear } = withTimeout(12000);
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: hdrs,
      cache: "no-store",
      signal,
    });
  } catch (e) {
    clear();
    const isTimeout = String(e?.message || e) === "timeout";
    const r = new Response(
      JSON.stringify({
        error: isTimeout ? "Upstream timeout" : "Upstream connect error",
        ...(isTimeout ? {} : { detail: e?.message || String(e) }),
      }),
      {
        status: isTimeout ? 504 : 502,
        headers: { "Content-Type": "application/json" },
      }
    );
    setCors(r);
    return r;
  }
  clear();

  // Pass through upstream response exactly (status + json)
  const text = await upstream.text();
  // Log the *status* and a shortened body for debugging 502s
  console.log("[/api/mastering/[jobId]] upstream status:", upstream.status);
  try {
    const peek = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    console.log("[/api/mastering/[jobId]] upstream body (peek):", peek);
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
