const counters = new Map();

function isEnabled() {
  const flag = String(process.env.LOCAL_TESTING_LIMIT_ENABLED || "").toLowerCase();
  return process.env.NODE_ENV !== "production" && ["1", "true", "yes", "on"].includes(flag);
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bucketKey(window, now = new Date()) {
  if (window === "hour") {
    return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}-${now.getUTCHours()}`;
  }
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}

function consumeCounter(name, limit, window, now = new Date()) {
  const key = `${name}:${bucketKey(window, now)}`;
  const current = (counters.get(key) || 0) + 1;
  counters.set(key, current);
  return current <= limit;
}

export function checkLocalTestingLimits({ isSetupFlow = false } = {}) {
  if (!isEnabled()) return null;

  const maxRequestsPerHour = toPositiveInt(
    process.env.LOCAL_TESTING_MAX_REQUESTS_PER_HOUR,
    60
  );
  const maxSetupsPerDay = toPositiveInt(
    process.env.LOCAL_TESTING_MAX_SETUPS_PER_DAY,
    25
  );

  if (!consumeCounter("requests", maxRequestsPerHour, "hour")) {
    return {
      error:
        "Local testing request limit exceeded. Increase LOCAL_TESTING_MAX_REQUESTS_PER_HOUR or disable LOCAL_TESTING_LIMIT_ENABLED for this environment.",
    };
  }

  if (isSetupFlow && !consumeCounter("setups", maxSetupsPerDay, "day")) {
    return {
      error:
        "Local testing setup limit exceeded. Increase LOCAL_TESTING_MAX_SETUPS_PER_DAY or disable LOCAL_TESTING_LIMIT_ENABLED for this environment.",
    };
  }

  return null;
}

export function __resetLocalTestingLimitsForTests() {
  counters.clear();
}
