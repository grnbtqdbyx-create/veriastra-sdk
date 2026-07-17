# veriastra

Typed, zero-dependency client for the [Veriastra](https://veriastra.com) data-validation API: email, phone, IP, domain, sanctions and company lookups through one endpoint, one credit system.

Every response can carry a **signed receipt**. Verify any result later, free, against the public verification endpoint: screenshots can lie, signatures can't.

## Install

```bash
npm install veriastra
```

Node 18+ (uses global `fetch`). ESM.

## Quick start

```ts
import Veriastra from "veriastra";

const client = new Veriastra({ apiKey: "ol_live_..." }); // omit for the guest tier

const email = await client.verifyEmail("name@company.com");
console.log(email.rows);        // human-readable result rows
console.log(email.signals);     // structured verdict

// Prove the result came from Veriastra, unmodified:
if (email.receipt) {
  const ok = await client.verifyReceipt(email.receipt); // true
}
```

## Methods

| Method | What it does | Credits |
|---|---|---|
| `verifyEmail(email)` | Syntax, MX, live SMTP mailbox probe, disposable/role flags | 1 |
| `lookupPhone(phone, country?)` | Validity, E.164, line type, carrier (best-effort), US geo | 1 |
| `lookupIp(ip)` | Geo, ASN, proxy/VPN/Tor, abuse feeds, risk score | 1 |
| `lookupDomain(domain)` | Age, rank, threat status, live DNS/HTTPS checks | 1 |
| `sanctions(name)` | Screening against the major consolidated sanctions lists | 1 |
| `company(query)` | SEC registry match, filings link, latest annual financials | 1 |
| `spamCheck(phone)` | Spam/robocall reputation from FTC complaint data | 1 |
| `fraudScore({ email?, ip?, phone? })` | Combined 0-100 risk score | 1 |
| `verifyReceipt(receipt)` | Verify a signed result receipt | free |

Without an API key the client uses the guest tier: 5 lookups/minute, 50/day per IP. Grab a key at [veriastra.com](https://veriastra.com).

## Errors

Failed calls throw `VeriastraError` with `status` and, on 429, `retryAfter` (seconds):

```ts
import { VeriastraError } from "veriastra";

try {
  await client.verifyEmail("x@y.z");
} catch (e) {
  if (e instanceof VeriastraError && e.status === 429) {
    console.log(`rate limited, retry in ${e.retryAfter}s`);
  }
}
```

## MCP

Prefer to give the same engines to your AI agents? Veriastra also ships as an MCP server: see [veriastra.com/docs#mcp](https://veriastra.com/docs#mcp).

## License

MIT
