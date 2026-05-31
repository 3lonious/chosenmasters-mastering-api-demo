export function resolveParentBase() {
  return (process.env.PARENT_BASE_URL || "https://chosenmasters.com").replace(
    /\/+$/,
    ""
  );
}

export function resolvePartnerKey() {
  return process.env.CM_API_KEY || "";
}

function firstHeaderValue(value) {
  if (!value) return "";
  return String(value).split(",")[0].trim();
}

function inferApiDomain(request) {
  const configured = process.env.CM_API_DOMAIN;
  if (configured && configured.trim()) {
    return configured.trim();
  }

  const origin = request.headers.get("origin");
  if (origin && origin.trim()) {
    return origin.trim();
  }

  const referer = request.headers.get("referer");
  if (referer && referer.trim()) {
    return referer.trim();
  }

  const host = firstHeaderValue(
    request.headers.get("x-forwarded-host") || request.headers.get("host")
  );
  if (!host) return "";

  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");

  return `${proto}://${host}`;
}

export function buildMasteringHeaders(
  request,
  { contentType = false, idempotencyKey } = {}
) {
  const apiKey = resolvePartnerKey();
  const apiDomain = inferApiDomain(request);
  const headers = {
    Accept: "application/json",
    "x-api-key": apiKey,
  };

  if (contentType) {
    headers["Content-Type"] = "application/json";
  }

  if (apiDomain) {
    headers["x-api-domain"] = apiDomain;
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return headers;
}
