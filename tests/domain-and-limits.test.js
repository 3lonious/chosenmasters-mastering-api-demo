import test from "node:test";
import assert from "node:assert/strict";

import {
  extractPreferredDomain,
  normalizeDomain,
  normalizeDomainFieldsForResponse,
} from "../lib/domain.js";
import {
  __resetLocalTestingLimitsForTests,
  checkLocalTestingLimits,
} from "../lib/local-testing-limits.js";

test("valid domain accepted and normalized", () => {
  assert.equal(normalizeDomain("  WWW.Example.COM  "), "www.example.com");

  const result = extractPreferredDomain({ domain: " https://EXAMPLE.com/path " });
  assert.equal(result.error, undefined);
  assert.equal(result.domain, "example.com");
});

test("invalid domain rejected", () => {
  const result = extractPreferredDomain({ domain: "nota domain" });
  assert.equal(result.domain, undefined);
  assert.match(result.error, /Invalid domain/);
});

test("legacy website compatibility", () => {
  const result = extractPreferredDomain({ website: "Blog.Example.com " });
  assert.equal(result.error, undefined);
  assert.equal(result.domain, "blog.example.com");

  const payload = normalizeDomainFieldsForResponse({ website: "Blog.Example.com" });
  assert.equal(payload.domain, "blog.example.com");
  assert.equal(payload.website, "blog.example.com");
});

test("domain takes precedence over website", () => {
  const result = extractPreferredDomain({
    domain: "preferred.example.com",
    website: "legacy.example.com",
  });
  assert.equal(result.error, undefined);
  assert.equal(result.domain, "preferred.example.com");
});

test("local testing limits are enforced", () => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    LOCAL_TESTING_LIMIT_ENABLED: process.env.LOCAL_TESTING_LIMIT_ENABLED,
    LOCAL_TESTING_MAX_REQUESTS_PER_HOUR:
      process.env.LOCAL_TESTING_MAX_REQUESTS_PER_HOUR,
    LOCAL_TESTING_MAX_SETUPS_PER_DAY: process.env.LOCAL_TESTING_MAX_SETUPS_PER_DAY,
  };

  process.env.NODE_ENV = "development";
  process.env.LOCAL_TESTING_LIMIT_ENABLED = "true";
  process.env.LOCAL_TESTING_MAX_REQUESTS_PER_HOUR = "2";
  process.env.LOCAL_TESTING_MAX_SETUPS_PER_DAY = "1";

  __resetLocalTestingLimitsForTests();
  assert.equal(checkLocalTestingLimits({ isSetupFlow: true }), null);

  const setupError = checkLocalTestingLimits({ isSetupFlow: true });
  assert.match(setupError.error, /setup limit exceeded/i);

  const requestError = checkLocalTestingLimits({ isSetupFlow: false });
  assert.match(requestError.error, /request limit exceeded/i);

  __resetLocalTestingLimitsForTests();
  process.env.NODE_ENV = previousEnv.NODE_ENV;
  process.env.LOCAL_TESTING_LIMIT_ENABLED = previousEnv.LOCAL_TESTING_LIMIT_ENABLED;
  process.env.LOCAL_TESTING_MAX_REQUESTS_PER_HOUR =
    previousEnv.LOCAL_TESTING_MAX_REQUESTS_PER_HOUR;
  process.env.LOCAL_TESTING_MAX_SETUPS_PER_DAY =
    previousEnv.LOCAL_TESTING_MAX_SETUPS_PER_DAY;
});
