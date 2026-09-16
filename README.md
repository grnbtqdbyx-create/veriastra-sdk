# veriastra

Typed, zero-dependency client for the [Veriastra](https://veriastra.com) data-validation API.

The live OpenAPI 3.1 document at [`/api/openapi.json`](https://veriastra.com/api/openapi.json) describes **40 paths**. This client exposes those paths. It does **not** claim uniqueness (1LookUp also publishes OpenAPI), a “no resold vendors” engine, or a working search-intent product.

Signed receipts are issued on most core lookups. **Verifying them currently requires an API key** — OpenAPI still says the endpoint is public and free; production returns `401 api_key_required`.

## Install

The package is **not published to npm** (`veriastra` is not on the registry). Install from GitHub:

```bash
npm install github:grnbtqdbyx-create/veriastra-sdk
```

Node 18+ (uses global `fetch`). ESM.

## Quick start

```ts
import { Veriastra, VeriastraError } from "veriastra";

const veriastra = new Veriastra(process.env.VERIASTRA_API_KEY);

const email = await veriastra.verifyEmail("name@company.com");
console.log(email.rows);
console.log(email.signals);

const result = await veriastra.dialCheck("+14155552671");
console.log(result.decision); // "clear" | "caution" | "do-not-call"

try {
  await veriastra.hlr("+14155552671");
} catch (e) {
  if (e instanceof VeriastraError && e.isOutOfCredits) {
    // 402 — top up
  }
  if (e instanceof VeriastraError && e.isNotConfigured) {
    // 503 — provider not connected on this instance (CNAM, HLR, MNP, …)
  }
}

if (email.receipt) {
  const ok = await veriastra.verifyReceipt(email.receipt); // needs the same API key
}
```

`new Veriastra()` with no key uses the guest tier (5/minute, 50/day per IP). Guest calls may be challenged with a proof-of-work header; the client solves that automatically. Most enrichment and all connected-data paths require a key.

## Methods

Credit costs come from the live OpenAPI `x-credits` field.

### Core (self-hosted engines)

| Method | Path | Credits |
|---|---|---|
| `verifyEmail(email)` | `POST /verify-email` | 1 |
| `lookupPhone(phone, country?)` | `POST /lookup-phone` | 1 |
| `carrierLookup(phone, country?)` | `POST /carrier-lookup` | 1 |
| `lookupIp(ip)` | `POST /lookup-ip` | 1 |
| `lookupDomain(domain)` | `POST /lookup-domain` | 1 |
| `domainThreat(domain)` | `POST /domain-threat` | 1 |
| `spamCheck(phone)` | `POST /spam-check` | 1 |
| `dialCheck(phone, country?)` | `POST /dial-check` | 2 |
| `company(query)` | `POST /company` | 3 |
| `sanctions(name, { dob, nationality }?)` | `POST /sanctions` | 1 |
| `fraudScore({ email?, ip?, phone? })` | `POST /fraud-score` | 2 |
| `screen({ purpose, email?, ip?, phone? })` | `POST /screen` | 2 |
| `domainSeo(domain)` | `POST /domain-seo` | 1 |
| `propertyLookup(address, zip?)` | `POST /property-lookup` | 2 |
| `subdomains(domain)` | `POST /subdomains` | 2 |
| `companyOwners({ companyNumber?, name? })` | `POST /company-owners` | 5 |
| `uboScreen({ companyNumber?, name? })` | `POST /ubo-screen` | 8 |
| `ownershipChain({ companyNumber?, name? })` | `POST /ownership-chain` | 10 |
| `techStack(domain)` | `POST /tech-stack` | 2 |
| `businessLookup({ name, city, state })` | `POST /business-lookup` | 5 |
| `emailEnrichment({ first_name, last_name?, company_domain })` | `POST /email-enrichment` | 3 |
| `scrapeWebsite(url)` | `POST /scrape-website` | 5 |
| `scrapeContacts(url)` | `POST /scrape-contacts` | 5 |
| `businessVerify({ name, city?, region?, … })` | `POST /business-verify` | 10 |
| `companyFirmographics({ domain?, name?, … })` | `POST /company-firmographics` | 15 |

`lookupPhone` is **allocation**, not a live in-service check. “Valid” ≠ active. Use `hlr` for a live network dip.

`lookupDomain` currently **false-negatives SPF** on some domains (confirmed `stripe.com`: apex TXT has `v=spf1 … ~all`, domain engine row says “SPF Missing”; `verifyEmail` on `@stripe.com` reports SPF correctly). That is an engine bug, not a client bug.

Sanctions coverage to trust: **12 lists, 206,273 records** on [`/coverage`](https://veriastra.com/coverage) (2026-09-16). Not “4 regimes”, not “eleven + Canada SEMA” (Canada is not on the coverage table; Switzerland SESAM and Australia DFAT are).

### Provider-backed (may return 503 `not_configured`)

These are bought or credential-gated. The client sends the documented request; it does not invent results.

| Method | Path | Credits | Live (guest, 2026-09-16) |
|---|---|---|---|
| `reverseLookup({ purpose, phone?, email? })` | `POST /reverse-lookup` | 0 (beta) | 401 without a key |
| `hlr(msisdn)` | `POST /hlr` | 10 | 401 without a paid-plan key |
| `mnp(msisdn)` | `POST /mnp` | 5 | same class as HLR |
| `callerName(phone)` | `POST /caller-name` | 3 | **503 `not_configured`** — no CNAM provider on this instance |
| `dncRegistryCheck(phone)` | `POST /dnc/registry-check` | 30 | key + provider required |

**Search intent** is marketed at `/products/search-intent-lookup` and mentioned in MCP footnotes. It is **not in OpenAPI**. `POST /api/v1/search-intent` returns **404 HTML**. There is no SDK method for it — a paid SERP provider is required, and faking the product would be worse than omitting it.

Homepage “6 own engines · no resold vendor calls” is also false for this group (LeakCheck, Moz, HLR/MNP/CNAM, reverse lookup, registry-check). Connected-data is real; it is resold.

### Account, bulk, DNC, receipts

| Method | Path | Credits |
|---|---|---|
| `createBulkJob({ type, items?, csv?, webhook? })` | `POST /bulk` | per item |
| `getBulkJob(jobId)` | `GET /bulk/{jobId}` | 0 |
| `getAccount()` | `GET /account` | 0 |
| `recordDnc` / `listDnc` / `withdrawDnc` | `/dnc/internal` | unmetered |
| `recordDncAccess` / `listDncAccess` | `/dnc/access` | unmetered |
| `dncScrub({ phone?, phones? })` | `POST /dnc/scrub` | 0 on Compliance plan |
| `dncStatus()` / `dncExport({ format? })` | `/dnc/status`, `/dnc/export` | unmetered |
| `listEmailSuppression` / `addEmailSuppression` / `removeEmailSuppression` | `/email-suppression` | 0 |
| `verifyReceipt(receipt)` | `POST /verify-receipt` | 0, **but a key is required in production** |

Pass `idempotencyKey` on any mutating call to replay the first success for 24 hours without a second charge. `bypassCache: true` re-runs the engine at the same credit cost.

## Errors

Failed calls throw `VeriastraError`. Branch on `code` (stable) or `status`, not on the message.

```ts
import { VeriastraError } from "veriastra";

try {
  await veriastra.hlr("+14155552671");
} catch (e) {
  if (e instanceof VeriastraError && e.status === 429) {
    console.log(`rate limited, retry in ${e.retryAfter}s`);
  }
  if (e instanceof VeriastraError && e.isOutOfCredits) {
    // 402
  }
}
```

`isOutOfCredits` is true for HTTP 402 / `insufficient_credits`. `isNotConfigured` is true for HTTP 503 / `not_configured`.

## What this client will not do

- Publish to npm until the package is actually on the registry with publish rights.
- Ship audio transcription or nationwide US registry coverage — those are product gaps, not SDK gaps.
- Call a search-intent path that does not exist.

## MCP

The same engines are also an MCP server: [veriastra.com/docs#mcp](https://veriastra.com/docs#mcp). Tool lists on `/docs`, `/mcp`, and the docs footnote still disagree; treat the live MCP session as source of truth.

## License

MIT
