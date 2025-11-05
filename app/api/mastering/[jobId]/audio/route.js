// app/api/mastering/[jobId]/audio/route.js
export const runtime = "nodejs";

function setCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
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

export async function GET(req, context) {
  let params = context?.params;
  if (params && typeof params.then === "function") params = await params;

  const jobId = params?.jobId;
  const parentBase = (
    process.env.PARENT_BASE_URL || "https://chosenmasters.com"
  ).replace(/\/+$/, "");
  const partnerKey = process.env.CM_API_KEY || "";

  if (!jobId) {
    const r = new Response(JSON.stringify({ error: "Missing jobId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  }
  if (!partnerKey) {
    const r = new Response(JSON.stringify({ error: "Missing CM_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    setCors(r);
    return r;
  }

  try {
    const u = new URL(req.url);
    const qs = u.search || ""; // preserve e.g. ?intensity=all

    const upstream = await fetch(
      `${parentBase}/api/b2b/mastering/${encodeURIComponent(jobId)}/audio${qs}`,
      {
        method: "GET",
        headers: { "x-api-key": partnerKey, Accept: "application/json" },
        cache: "no-store",
      }
    );

    const text = await upstream.text();
    const r = new Response(text || "{}", {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
    setCors(r);
    return r;
  } catch (e) {
    const r = new Response(
      JSON.stringify({ error: `Proxy intensities error: ${e.message}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
    setCors(r);
    return r;
  }
}
