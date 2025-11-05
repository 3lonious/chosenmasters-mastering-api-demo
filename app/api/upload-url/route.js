export const runtime = "nodejs";

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

export async function POST(request) {
  try {
    const { fileName, fileType } = await request.json();

    const parentBase = (
      process.env.PARENT_BASE_URL || "https://chosenmasters.com"
    ).replace(/\/+$/, "");
    const apiKey = process.env.CM_API_KEY;

    if (!apiKey) {
      const r = new Response("Missing CM_API_KEY", { status: 500 });
      setCors(r);
      return r;
    }

    const upstream = await fetch(`${parentBase}/api/b2b/mastering/upload-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ fileName, fileType }),
    });

    const text = await upstream.text();
    const r = new Response(text || "Upstream error", {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
    setCors(r);
    return r;
  } catch (e) {
    const r = new Response(`Upload URL error: ${e.message}`, {
      status: 500,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
    setCors(r);
    return r;
  }
}
