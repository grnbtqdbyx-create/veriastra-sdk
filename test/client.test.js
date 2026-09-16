import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Veriastra, {
  CREDITS,
  OPENAPI_PATH_COUNT,
  VeriastraError,
  verifyWebhookSignature,
} from "../dist/index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("constructor accepts a key string (docs sample) or an options object", () => {
  const a = new Veriastra("ol_live_test");
  const b = new Veriastra({ apiKey: "ol_live_test" });
  assert.ok(a);
  assert.ok(b);
});

test("OPENAPI_PATH_COUNT is 40, not the stale compare-page 30", () => {
  assert.equal(OPENAPI_PATH_COUNT, 40);
});

test("verifyEmail posts /verify-email and sends the bearer key", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, { email: "a@b.c", rows: [], signals: { charged: 1 } });
  };
  const client = new Veriastra("ol_live_test");
  const out = await client.verifyEmail("a@b.c");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://veriastra.com/api/v1/verify-email");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer ol_live_test");
  assert.equal(JSON.parse(calls[0].init.body).email, "a@b.c");
  assert.equal(out.email, "a@b.c");
});

test("docs sample methods exist: dialCheck, hlr, isOutOfCredits", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, { decision: "clear" });
  };
  const client = new Veriastra("ol_live_test");
  const dial = await client.dialCheck("+14155552671");
  assert.equal(dial.decision, "clear");
  assert.match(calls[0].url, /\/dial-check$/);

  await client.hlr("+14155552671");
  assert.match(calls[1].url, /\/hlr$/);
  assert.equal(JSON.parse(calls[1].init.body).msisdn, "+14155552671");

  const err = new VeriastraError(402, "out", undefined, { code: "insufficient_credits" });
  assert.equal(err.isOutOfCredits, true);
  assert.equal(new VeriastraError(503, "off", undefined, { code: "not_configured" }).isNotConfigured, true);
});

test("callerName posts /caller-name and surfaces 503 not_configured", async () => {
  globalThis.fetch = async () =>
    jsonResponse(503, {
      success: false,
      error: "Caller name is not enabled on this instance",
      code: "not_configured",
      retryable: false,
    });
  const client = new Veriastra("ol_live_test");
  await assert.rejects(
    () => client.callerName("+16502530000"),
    (e) => {
      assert.ok(e instanceof VeriastraError);
      assert.equal(e.status, 503);
      assert.equal(e.code, "not_configured");
      assert.equal(e.isNotConfigured, true);
      return true;
    },
  );
});

test("verifyReceipt sends resultSha256 and does not pretend to be keyless", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, { valid: true });
  };
  const client = new Veriastra("ol_live_test");
  const ok = await client.verifyReceipt({
    engine: "lookup-ip",
    inputSha256: "aa",
    resultSha256: "bb",
    issuedAt: "2026-09-16T00:00:00.000Z",
    id: "r_1",
    sig: "cc",
    verifyUrl: "https://veriastra.com/api/verify-receipt",
  });
  assert.equal(ok, true);
  assert.match(calls[0].url, /\/verify-receipt$/);
  assert.equal(calls[0].init.headers.authorization, "Bearer ol_live_test");
  assert.equal(JSON.parse(calls[0].init.body).resultSha256, "bb");
});

test("verifyReceipt throws api_key_required when production asks for a key", async () => {
  globalThis.fetch = async () =>
    jsonResponse(401, {
      success: false,
      error: "This endpoint needs an API key.",
      code: "api_key_required",
    });
  const guest = new Veriastra();
  await assert.rejects(
    () =>
      guest.verifyReceipt({
        engine: "lookup-ip",
        inputSha256: "aa",
        issuedAt: "2026-09-16T00:00:00.000Z",
        id: "r_1",
        sig: "cc",
        verifyUrl: "https://veriastra.com/api/verify-receipt",
      }),
    (e) => e instanceof VeriastraError && e.code === "api_key_required" && e.status === 401,
  );
});

test("HTML 404 (search-intent style) is not parsed as JSON success", async () => {
  globalThis.fetch = async () =>
    new Response("<!DOCTYPE html><html>", {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  const client = new Veriastra();
  await assert.rejects(
    () => client.lookupDomain("stripe.com"),
    (e) => e instanceof VeriastraError && e.status === 404 && e.code === "not_found",
  );
});

test("idempotencyKey and bypassCache are forwarded", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(200, { ok: true });
  };
  const client = new Veriastra("k");
  await client.verifyEmail("a@b.c", { idempotencyKey: "order-1", bypassCache: true });
  assert.equal(calls[0].init.headers["Idempotency-Key"], "order-1");
  assert.equal(JSON.parse(calls[0].init.body).bypass_cache, true);
});

test("GET /account and DELETE /dnc/internal use the right verb and query", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return jsonResponse(200, { ok: true });
  };
  const client = new Veriastra("k");
  await client.getAccount();
  await client.withdrawDnc("+14155552671");
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /\/account$/);
  assert.equal(calls[1].method, "DELETE");
  assert.match(calls[1].url, /\/dnc\/internal\?phone=/);
});

test("sanctions credit cost and every OpenAPI lookup method is present", () => {
  const client = new Veriastra();
  const names = [
    "verifyEmail",
    "lookupPhone",
    "carrierLookup",
    "lookupIp",
    "lookupDomain",
    "domainThreat",
    "spamCheck",
    "dialCheck",
    "company",
    "sanctions",
    "fraudScore",
    "screen",
    "domainSeo",
    "propertyLookup",
    "subdomains",
    "companyOwners",
    "uboScreen",
    "ownershipChain",
    "techStack",
    "businessLookup",
    "emailEnrichment",
    "scrapeWebsite",
    "scrapeContacts",
    "reverseLookup",
    "hlr",
    "mnp",
    "businessVerify",
    "companyFirmographics",
    "callerName",
    "createBulkJob",
    "getBulkJob",
    "recordDnc",
    "listDnc",
    "withdrawDnc",
    "recordDncAccess",
    "listDncAccess",
    "dncScrub",
    "dncRegistryCheck",
    "dncStatus",
    "dncExport",
    "listEmailSuppression",
    "addEmailSuppression",
    "removeEmailSuppression",
    "getAccount",
    "verifyReceipt",
  ];
  for (const name of names) assert.equal(typeof client[name], "function", name);
  assert.equal(typeof client.searchIntent, "undefined");
  assert.equal(CREDITS.sanctions, 1);
  assert.equal(CREDITS.callerName, 3);
  assert.equal(CREDITS.hlr, 10);
});

test("verifyWebhookSignature accepts a matching HMAC and rejects drift", async () => {
  const secret = "whsec_test";
  const rawBody = '{"jobId":"job_1"}';
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const v1 = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyWebhookSignature(rawBody, `t=${t},v1=${v1}`, secret), true);
  assert.equal(await verifyWebhookSignature(rawBody, `t=${t},v1=${"00".repeat(32)}`, secret), false);
});
