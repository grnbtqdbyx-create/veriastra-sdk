/**
 * Veriastra SDK — typed, zero-dependency client for the Veriastra
 * data-validation API (https://veriastra.com).
 *
 * Every response can carry a signed receipt; verify it any time with
 * `client.verifyReceipt(receipt)` — no credits, no key required.
 */

export type Tone = "ok" | "warn" | "bad" | "neutral";
export type ResultRow = { label: string; value: string; tone: Tone };

export type Receipt = {
  engine: string;
  inputSha256: string;
  issuedAt: string;
  id: string;
  sig: string;
  verifyUrl: string;
};

/** Common shape of every lookup response: readable rows + engine-specific fields. */
export type LookupResponse = {
  rows?: ResultRow[];
  receipt?: Receipt;
  [key: string]: unknown;
};

export class VeriastraError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = "VeriastraError";
    this.status = status;
    this.retryAfter = retryAfter;
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

export class Veriastra {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://veriastra.com/api/v1").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async post<T extends LookupResponse>(path: string, body: object): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const retry = Number(res.headers.get("retry-after")) || undefined;
      throw new VeriastraError(res.status, String(data.error ?? `HTTP ${res.status}`), retry);
    }
    return data as T;
  }

  /** Real-time email verification: syntax, MX, SMTP mailbox, disposable/role flags. */
  verifyEmail(email: string): Promise<LookupResponse> {
    return this.post("/verify-email", { email });
  }

  /** Phone validation: validity, E.164, line type, carrier (best-effort), US geo. */
  lookupPhone(phone: string, country?: string): Promise<LookupResponse> {
    return this.post("/lookup-phone", country ? { phone, country } : { phone });
  }

  /** IP intelligence: geo, ASN, proxy/VPN/Tor, abuse feeds, risk score. */
  lookupIp(ip: string): Promise<LookupResponse> {
    return this.post("/lookup-ip", { ip });
  }

  /** Domain intelligence: age, rank, threat status, live DNS/HTTPS checks. */
  lookupDomain(domain: string): Promise<LookupResponse> {
    return this.post("/lookup-domain", { domain });
  }

  /** Sanctions screening against the major consolidated lists. */
  sanctions(name: string): Promise<LookupResponse> {
    return this.post("/sanctions", { name });
  }

  /** US public company lookup: SEC registry, filings, latest annual financials. */
  company(query: string): Promise<LookupResponse> {
    return this.post("/company", { query });
  }

  /** Phone spam & robocall reputation (FTC complaint data + community reports). */
  spamCheck(phone: string): Promise<LookupResponse> {
    return this.post("/spam-check", { phone });
  }

  /** Combined 0-100 fraud score from any mix of email / ip / phone. */
  fraudScore(input: { email?: string; ip?: string; phone?: string }): Promise<LookupResponse> {
    return this.post("/fraud-score", input);
  }

  /** Verify a signed result receipt. Free: no credits, no key. */
  async verifyReceipt(receipt: Receipt): Promise<boolean> {
    const { valid } = await this.post<{ valid: boolean } & LookupResponse>("/verify-receipt", receipt);
    return valid === true;
  }
}

export default Veriastra;
