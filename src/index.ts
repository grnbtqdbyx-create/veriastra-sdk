/**
 * Veriastra SDK — typed, zero-dependency client for the Veriastra
 * data-validation API (https://veriastra.com).
 *
 * Methods map 1:1 onto the public OpenAPI 3.1 document at
 * `https://veriastra.com/api/openapi.json` (40 paths). The live site still
 * overclaims in a few places; this client does not.
 *
 * Receipts: OpenAPI and marketing say `/verify-receipt` is free and keyless.
 * Production currently returns 401 `api_key_required`. Pass an API key.
 *
 * Connected-data (HLR, MNP, CNAM, reverse lookup, registry-check, Moz DA):
 * these are provider-backed. When the instance has no credential they return
 * 503 `not_configured` and charge nothing. Search intent is marketed but is
 * not in OpenAPI and has no working path — it is not a method here.
 */

export type Tone = "ok" | "warn" | "bad" | "neutral";
export type ResultRow = { label: string; value: string; tone: Tone };

export type Receipt = {
  engine: string;
  inputSha256: string;
  resultSha256?: string;
  issuedAt: string;
  id: string;
  sig: string;
  verifyUrl: string;
};

export type Reputation = {
  checks?: number;
  firstSeen?: string;
  lastSeen?: string;
  weight?: number;
  bounced?: number;
  delivered?: number;
  [key: string]: unknown;
};

export type Signals = {
  reputation?: Reputation;
  domain?: string;
  status?: string;
  quality?: number;
  charged?: number;
  [key: string]: unknown;
};

/** Common shape of lookup responses: readable rows + engine-specific fields. */
export type LookupResponse = {
  rows?: ResultRow[];
  signals?: Signals;
  receipt?: Receipt;
  cached?: boolean;
  [key: string]: unknown;
};

export type ErrorCode =
  | "invalid_json"
  | "missing_field"
  | "invalid_field"
  | "api_key_required"
  | "invalid_api_key"
  | "insufficient_credits"
  | "paid_plan_required"
  | "rate_limited"
  | "proof_required"
  | "not_configured"
  | "provider_unavailable"
  | "not_found"
  | "internal_error"
  | (string & {});

export class VeriastraError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly type?: string;
  readonly retryable?: boolean;
  readonly retryAfter?: number;
  readonly recovery?: string;
  readonly isOutOfCredits: boolean;
  readonly isNotConfigured: boolean;

  constructor(
    status: number,
    message: string,
    retryAfter?: number,
    extra: { code?: string; type?: string; retryable?: boolean; recovery?: string } = {},
  ) {
    super(message);
    this.name = "VeriastraError";
    this.status = status;
    this.code = extra.code;
    this.type = extra.type;
    this.retryable = extra.retryable;
    this.retryAfter = retryAfter;
    this.recovery = extra.recovery;
    this.isOutOfCredits = status === 402 || extra.code === "insufficient_credits";
    this.isNotConfigured = status === 503 || extra.code === "not_configured";
  }
}

export type ClientOptions = {
  /** API key (`ol_live_...`). Omit to use the tightly rate-limited guest tier. */
  apiKey?: string;
  /** Override for self-hosted / testing. Default: https://veriastra.com/api/v1 */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30000 (SMTP probes can take a while). */
  timeoutMs?: number;
};

export type RequestOptions = {
  /** Stored for 24h and replayed without a second charge. */
  idempotencyKey?: string;
  /** Skip the cached copy and re-run the engine. Same credit cost. */
  bypassCache?: boolean;
  signal?: AbortSignal;
};

export type ScreenPurpose = "crm-lead" | "signup" | "application";
export type ReversePurpose = "fraud-prevention" | "identity-verification" | "collections-legal" | "own-data";
export type BulkType =
  | "email"
  | "ip"
  | "domain"
  | "phone"
  | "business-verify"
  | "company-firmographics"
  | "screen-crm-lead"
  | "screen-signup"
  | "screen-application";
export type SuppressionReason = "bounced" | "complained" | "unsubscribed" | "manual";

export type DncEntry = {
  phone?: string;
  consumer_name?: string;
  seller?: string;
  telemarketer?: string;
  goods_offered?: string;
  requested_at?: string;
};

export type CreditCost = number | "unmetered" | "per-item";

/** Credit cost advertised on the live OpenAPI `x-credits` extension. */
export const CREDITS = {
  verifyEmail: 1,
  lookupPhone: 1,
  carrierLookup: 1,
  lookupIp: 1,
  lookupDomain: 1,
  domainThreat: 1,
  spamCheck: 1,
  dialCheck: 2,
  company: 3,
  sanctions: 1,
  fraudScore: 2,
  screen: 2,
  domainSeo: 1,
  propertyLookup: 2,
  subdomains: 2,
  companyOwners: 5,
  uboScreen: 8,
  ownershipChain: 10,
  techStack: 2,
  businessLookup: 5,
  emailEnrichment: 3,
  scrapeWebsite: 5,
  scrapeContacts: 5,
  reverseLookup: 0,
  hlr: 10,
  mnp: 5,
  businessVerify: 10,
  companyFirmographics: 15,
  callerName: 3,
  dncScrub: 0,
  dncRegistryCheck: 30,
  verifyReceipt: 0,
} as const satisfies Record<string, CreditCost>;

/** Unique path count in the live OpenAPI document (not “30”, and not unique to Veriastra). */
export const OPENAPI_PATH_COUNT = 40;

type CtorArg = string | ClientOptions | undefined;

function asOptions(opts: CtorArg): ClientOptions {
  if (typeof opts === "string") return { apiKey: opts };
  return opts ?? {};
}

function queryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const c of hex) {
    const nibble = Number.parseInt(c, 16);
    if (Number.isNaN(nibble)) return bits;
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    if (nibble < 2) return bits + 3;
    if (nibble < 4) return bits + 2;
    if (nibble < 8) return bits + 1;
    return bits;
  }
  return bits;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function solveProof(challenge: string, difficulty: number): Promise<string> {
  const bits = Number(difficulty);
  if (!Number.isFinite(bits) || bits < 0 || bits > 20) {
    throw new VeriastraError(428, "Unsupported proof-of-work difficulty", undefined, {
      code: "proof_required",
      retryable: true,
    });
  }
  for (let n = 0; n < 2_000_000; n++) {
    const solution = n.toString(36);
    const hex = await sha256Hex(`${challenge}:${solution}`);
    if (leadingZeroBits(hex) >= bits) return solution;
  }
  throw new VeriastraError(428, "Could not solve proof-of-work challenge", undefined, {
    code: "proof_required",
    retryable: true,
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/**
 * Verify a bulk-job webhook (`X-Veriastra-Signature: t=…,v1=…`).
 * Signed value is `${t}.${rawBody}`; reject deliveries older than `maxAgeSec`.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
  maxAgeSec = 300,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - t);
  if (age > maxAgeSec) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, v1);
}

export class Veriastra {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: CtorArg = {}) {
    const o = asOptions(opts);
    this.apiKey = o.apiKey;
    this.baseUrl = (o.baseUrl ?? "https://veriastra.com/api/v1").replace(/\/$/, "");
    this.timeoutMs = o.timeoutMs ?? 30_000;
  }

  private headers(extra?: Record<string, string>, jsonBody = false): Record<string, string> {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    if (jsonBody) headers["content-type"] = headers["content-type"] ?? "application/json";
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      body?: object;
      query?: Record<string, string | number | undefined>;
      request?: RequestOptions;
      proof?: string;
      expectBinary?: boolean;
    } = {},
  ): Promise<T> {
    const headers = this.headers(
      {
        ...(opts.request?.idempotencyKey ? { "Idempotency-Key": opts.request.idempotencyKey } : {}),
        ...(opts.proof ? { "X-Veriastra-Proof": opts.proof } : {}),
      },
      opts.body !== undefined,
    );
    const body =
      opts.body === undefined
        ? undefined
        : JSON.stringify(
            opts.request?.bypassCache ? { ...opts.body, bypass_cache: true } : opts.body,
          );
    const res = await fetch(`${this.baseUrl}${path}${queryString(opts.query)}`, {
      method,
      headers,
      body,
      signal: opts.request?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });

    const retry = Number(res.headers.get("retry-after")) || undefined;
    const contentType = res.headers.get("content-type") ?? "";

    if (opts.expectBinary) {
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw this.errorFrom(res.status, data, retry);
      }
      return (await res.arrayBuffer()) as T;
    }

    if (contentType.includes("text/html")) {
      throw new VeriastraError(res.status, `HTTP ${res.status}`, retry, {
        code: res.status === 404 ? "not_found" : undefined,
      });
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (
      !res.ok &&
      (res.status === 428 || data.code === "proof_required") &&
      typeof data.challenge === "string" &&
      !opts.proof
    ) {
      const solution = await solveProof(data.challenge, Number(data.difficulty ?? 0));
      return this.request<T>(method, path, {
        ...opts,
        proof: `${data.challenge}:${solution}`,
      });
    }
    if (!res.ok) throw this.errorFrom(res.status, data, retry);
    return data as T;
  }

  private errorFrom(status: number, data: Record<string, unknown>, retry?: number): VeriastraError {
    const retryAfter = Number(data.retryAfter ?? data.retry_after) || retry;
    return new VeriastraError(status, String(data.error ?? `HTTP ${status}`), retryAfter, {
      code: typeof data.code === "string" ? data.code : undefined,
      type: typeof data.type === "string" ? data.type : undefined,
      retryable: typeof data.retryable === "boolean" ? data.retryable : undefined,
      recovery: typeof data.recovery === "string" ? data.recovery : undefined,
    });
  }

  private post<T extends LookupResponse>(path: string, body: object, opts?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, { body, request: opts });
  }

  private get<T>(path: string, query?: Record<string, string | number | undefined>, opts?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, { query, request: opts });
  }

  // --- core lookups (guest-tier on most; key still recommended) ---

  /** RFC syntax, MX, live SMTP probe, disposable/role flags. 1 credit. */
  verifyEmail(email: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/verify-email", { email }, opts);
  }

  /**
   * Numbering-plan validity, E.164, derived line type, assigned carrier block.
   * This is allocation, not a live “active/disconnected” dip — use {@link hlr} for that.
   * 1 credit.
   */
  lookupPhone(phone: string, country?: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/lookup-phone", country ? { phone, country } : { phone }, opts);
  }

  /** Assigned carrier, OCN, rate center, derived line type. US/CA. 1 credit. */
  carrierLookup(phone: string, country?: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/carrier-lookup", country ? { phone, country } : { phone }, opts);
  }

  /** Geo, ASN, proxy/VPN/Tor, abuse feeds, risk score. 1 credit. */
  lookupIp(ip: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/lookup-ip", { ip }, opts);
  }

  /**
   * Domain age, rank, live DNS/HTTPS, headers, tech stack.
   *
   * Known engine bug (not fixable in this client): `lookup-domain` currently
   * reports SPF Missing on domains such as stripe.com whose apex TXT *does*
   * contain `v=spf1`. `verifyEmail` on the same domain reports SPF correctly.
   * 1 credit.
   */
  lookupDomain(domain: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/lookup-domain", { domain }, opts);
  }

  /** Phishing/malware feed membership. 1 credit. */
  domainThreat(domain: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/domain-threat", { domain }, opts);
  }

  /** FTC complaint + community spam reputation. Receipts are not always present. 1 credit. */
  spamCheck(phone: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/spam-check", { phone }, opts);
  }

  /**
   * One dial verdict: `clear` | `caution` | `do-not-call`, with `reasons`.
   * Does not buy the federal DNC registry. 2 credits.
   */
  dialCheck(phone: string, country?: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/dial-check", country ? { phone, country } : { phone }, opts);
  }

  /** Name, ticker, or EU VAT → SEC/GLEIF picture. 3 credits. */
  company(query: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/company", { query }, opts);
  }

  /**
   * Sanctions + PEP screening.
   *
   * Live coverage (2026-09-16): **12 lists / 206,273 records** (OFAC, BIS, DDTC,
   * EU FSF, UK OFSI, UN, AU DFAT, CH SESAM). Homepage “4 regimes”, OpenAPI
   * “eleven lists + Canada SEMA”, and `llms.txt` “13 lists” are stale — trust
   * `/coverage`, not any of those. 1 credit.
   */
  sanctions(name: string, extra: { dob?: string; nationality?: string } = {}, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/sanctions", { name, ...extra }, opts);
  }

  /** Combined 0–100 fraud score from any mix of email / ip / phone. 2 credits. */
  fraudScore(input: { email?: string; ip?: string; phone?: string }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/fraud-score", input, opts);
  }

  /** Job-specific decision (`crm-lead` | `signup` | `application`). 2 credits. */
  screen(
    input: { purpose: ScreenPurpose; email?: string; ip?: string; phone?: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/screen", input, opts);
  }

  /**
   * Hosted web-graph rank (Common Crawl + Tranco). Moz DA only for API-key holders.
   * 1 credit.
   */
  domainSeo(domain: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/domain-seo", { domain }, opts);
  }

  /** Parcel behind an address. Coverage is FL, NC, WI, NYC — not nationwide. 2 credits. */
  propertyLookup(address: string, zip?: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/property-lookup", zip ? { address, zip } : { address }, opts);
  }

  /** Hostnames from our Certificate Transparency copy. 2 credits. */
  subdomains(domain: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/subdomains", { domain }, opts);
  }

  /** UK Companies House PSC (beneficial owners). 5 credits. */
  companyOwners(input: { companyNumber?: string; name?: string }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/company-owners", input, opts);
  }

  /** Walk UK PSC owners and screen each against sanctions/PEP. 8 credits. */
  uboScreen(input: { companyNumber?: string; name?: string }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/ubo-screen", input, opts);
  }

  /** Follow UK corporate owners up to natural persons. 10 credits. */
  ownershipChain(input: { companyNumber?: string; name?: string }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/ownership-chain", input, opts);
  }

  /** Homepage fingerprint match (5k+ hosted rules). Requires an API key. 2 credits. */
  techStack(domain: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/tech-stack", { domain }, opts);
  }

  /** Name + city + state → directory listings. Requires an API key. 5 credits. */
  businessLookup(input: { name: string; city: string; state: string }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/business-lookup", input, opts);
  }

  /** First + last + company domain → SMTP-verified work email where possible. 3 credits. */
  emailEnrichment(
    input: { first_name: string; last_name?: string; company_domain: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/email-enrichment", input, opts);
  }

  /** Fetch a URL to Markdown. SSRF-guarded. 5 credits. */
  scrapeWebsite(url: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/scrape-website", { url }, opts);
  }

  /** Emails, phones, socials on a domain. 5 credits. */
  scrapeContacts(url: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/scrape-contacts", { url }, opts);
  }

  /**
   * Directory + phone + domain + GLEIF composition. North America directory.
   * 10 credits.
   */
  businessVerify(
    input: { name: string; city?: string; region?: string; country?: string; phone?: string; website?: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/business-verify", input, opts);
  }

  /**
   * Firmographics from hosted registers. US coverage is NY, CO, CT — not nationwide.
   * 15 credits.
   */
  companyFirmographics(
    input: { domain?: string; name?: string; city?: string; region?: string; country?: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/company-firmographics", input, opts);
  }

  // --- provider-backed (may 503 not_configured) ---

  /**
   * Reverse phone/email people data. Requires a key, a declared purpose, and a
   * connected provider (`503 not_configured` when none). Free while beta.
   */
  reverseLookup(
    input: { purpose: ReversePurpose; phone?: string; email?: string; name?: string; address?: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/reverse-lookup", input, opts);
  }

  /**
   * Live HLR network dip. `msisdn` on the wire; `phone` is also accepted by the API.
   * 10 credits. 503 if no provider is configured; 401 without a paid-plan key.
   */
  hlr(msisdn: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/hlr", { msisdn }, opts);
  }

  /** Portability database (not reachability). 5 credits. 503 if no provider. */
  mnp(msisdn: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/mnp", { msisdn }, opts);
  }

  /**
   * Carrier-published caller name (CNAM). 3 credits.
   * Production currently returns **503 `not_configured`** — no carrier-data
   * provider is connected on the instance. This method is gated, not faked.
   */
  callerName(phone: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/caller-name", { phone }, opts);
  }

  /**
   * Bought state-DNC + litigator check. 30 credits. 503 if no provider.
   * Not a lawful-call verdict; federal safe harbour still needs your own SAN pull.
   */
  dncRegistryCheck(phone: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/dnc/registry-check", { phone }, opts);
  }

  // --- bulk, account, compliance ---

  createBulkJob(
    input: { type: BulkType; items?: string[]; csv?: string; webhook?: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/bulk", input, opts);
  }

  getBulkJob(
    jobId: string,
    query: { limit?: number; offset?: number; format?: "json" | "ndjson" | "csv" } = {},
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.get(`/bulk/${encodeURIComponent(jobId)}`, query, opts);
  }

  recordDnc(input: DncEntry & { entries?: DncEntry[] }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/dnc/internal", input, opts);
  }

  listDnc(opts?: RequestOptions): Promise<LookupResponse> {
    return this.get("/dnc/internal", undefined, opts);
  }

  withdrawDnc(phone: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.request("DELETE", "/dnc/internal", { query: { phone }, request: opts });
  }

  recordDncAccess(
    input: { entity_name: string; san: string; campaign: string; accessed_at?: string; area_codes?: string },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/dnc/access", input, opts);
  }

  listDncAccess(opts?: RequestOptions): Promise<LookupResponse> {
    return this.get("/dnc/access", undefined, opts);
  }

  dncScrub(input: { phone?: string; phones?: string[] }, opts?: RequestOptions): Promise<LookupResponse> {
    return this.post("/dnc/scrub", input, opts);
  }

  dncStatus(opts?: RequestOptions): Promise<LookupResponse> {
    return this.get("/dnc/status", undefined, opts);
  }

  /** PDF (default) or CSV exhibit. Returns the raw body. */
  async dncExport(
    query: { format?: "pdf" | "csv"; entity_name?: string } = {},
    opts?: RequestOptions,
  ): Promise<{ contentType: string; body: ArrayBuffer }> {
    const headers = this.headers(undefined, false);
    const res = await fetch(`${this.baseUrl}/dnc/export${queryString(query)}`, {
      method: "GET",
      headers,
      signal: opts?.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw this.errorFrom(res.status, data, Number(res.headers.get("retry-after")) || undefined);
    }
    return { contentType: res.headers.get("content-type") ?? "", body: await res.arrayBuffer() };
  }

  listEmailSuppression(query: { limit?: number; offset?: number } = {}, opts?: RequestOptions): Promise<LookupResponse> {
    return this.get("/email-suppression", query, opts);
  }

  addEmailSuppression(
    input: { email?: string; emails?: string[]; reason?: SuppressionReason },
    opts?: RequestOptions,
  ): Promise<LookupResponse> {
    return this.post("/email-suppression", input, opts);
  }

  removeEmailSuppression(email: string, opts?: RequestOptions): Promise<LookupResponse> {
    return this.request("DELETE", "/email-suppression", { body: { email }, request: opts });
  }

  /** Usage, credit balance, webhook secret. Requires a key. Unmetered. */
  getAccount(opts?: RequestOptions): Promise<LookupResponse> {
    return this.get("/account", undefined, opts);
  }

  /**
   * Verify a signed result receipt.
   *
   * OpenAPI: “free, no API key, no credits.” Live production: **401
   * `api_key_required`**. This method sends the key when you constructed the
   * client with one. It does not pretend the endpoint is public.
   */
  async verifyReceipt(receipt: Receipt, opts?: RequestOptions): Promise<boolean> {
    const { valid } = await this.post<{ valid: boolean } & LookupResponse>("/verify-receipt", receipt, opts);
    return valid === true;
  }
}

export default Veriastra;
