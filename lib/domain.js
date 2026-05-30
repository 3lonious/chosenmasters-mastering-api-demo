const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function isValidHostname(hostname) {
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  return HOSTNAME_PATTERN.test(hostname);
}

export function normalizeDomain(rawValue) {
  if (rawValue === undefined || rawValue === null) return undefined;

  const value = String(rawValue).trim().toLowerCase();
  if (!value) return undefined;

  let hostname = value;

  if (/^[a-z]+:\/\//i.test(value)) {
    if (!/^https?:\/\//i.test(value)) return null;

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    hostname = (parsed.hostname || "").trim().toLowerCase();
  } else if (/[/?#]/.test(value)) {
    return null;
  }

  if (!isValidHostname(hostname)) return null;
  return hostname;
}

export function extractPreferredDomain(body) {
  const hasDomain = Object.hasOwn(body || {}, "domain");
  const hasWebsite = Object.hasOwn(body || {}, "website");
  const rawDomain = hasDomain ? body.domain : body?.website;

  const normalizedDomain = normalizeDomain(rawDomain);

  if (rawDomain !== undefined && rawDomain !== null && !normalizedDomain) {
    return {
      error: hasDomain
        ? "Invalid domain. Provide a valid domain or https:// URL."
        : "Invalid website. Provide a valid domain or https:// URL.",
    };
  }

  return {
    domain: normalizedDomain,
    hasDomain,
    hasWebsite,
  };
}

export function normalizeDomainFieldsForResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const normalized = { ...payload };

  const preferred = normalizeDomain(normalized.domain ?? normalized.website);
  if (preferred) {
    normalized.domain = preferred;
    normalized.website = preferred;
  }

  return normalized;
}
