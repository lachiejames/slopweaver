/**
 * The provider rate limits of mail, recorded calls and issue tracking.
 *
 * One category of the provider rate-limit registry: `./rateLimits.ts` spreads it into `PROVIDER_RATE_LIMITS`, which
 * stays the one table every consumer reads. A new provider goes in the category whose theme it belongs to, and a
 * category file nearing 300 code lines splits again.
 */

import type { ProviderRateLimits } from "#lib/rateLimitQuota.js";
import { perMinute, SAFETY } from "#lib/rateLimitQuota.js";

/** The rate limits of mail, recorded calls and issue tracking, keyed by provider. */
export const MAIL_AND_WORK_RATE_LIMITS = {
  gmail: {
    endpointClasses: {
      // Gmail meters QUOTA UNITS, not requests: 250 units per user per second, with a read costing 5 units
      // (`messages.list`, `messages.get`) and a thread read 10. Fifty reads a second is that ceiling
      // expressed in the unit this registry actually paces in — requests — taking the 5-unit read as the
      // representative cost. It is a TRANSLATION of a documented number, not a measurement, and the cheaper
      // calls (`labels.list`, 1 unit) are deliberately paced as if they cost a read.
      read: perMinute({
        limit: 3_000,
        method:
          "Google documents a Gmail per-user rate limit of 250 quota units/second; a 5-unit read (messages.list/get) " +
          "translates to 50 requests/second, i.e. 3,000/minute. NOT measured against a live 429",
      }),
      // The dearest write Gmail publishes is `messages.send` at 100 units, so the same 250 units/second
      // becomes two and a half requests a second. Every write shares this class rather than being split by
      // unit cost, because pacing the cheapest mutation at the dearest one's rate is the conservative
      // direction and the write volume here is tiny. `messages.modify` is the worked example: Google prices
      // it at 5 units, the same as a read, and it is paced here at the send rate anyway — a label change is
      // something a person triggers one at a time, so 2.5/second costs nothing, and the class a call sits in
      // should track what it DOES rather than what it costs.
      write: perMinute({
        limit: 150,
        method:
          "Google documents messages.send at 100 quota units against a 250 unit/second per-user limit, i.e. " +
          "2.5 requests/second. NOT measured against a live 429",
      }),
    },
    // The OAuth token and userinfo endpoints publish no per-user request quota at all, so rather than
    // invent one their labels take the tightest class this provider has — the same conservative direction
    // the fallback itself encodes.
    fallbackClass: "write",
    // Google scopes the Gmail quota to the authenticated MAILBOX. The shared 429 block keys on a hash of the
    // credential, and this repo binds exactly one grant per state home, so the two agree here.
    scope: "per-user",
  },
  outlook: {
    endpointClasses: {
      // Microsoft documents the Outlook service limit for Graph as 10,000 requests per 10 minutes per app per
      // mailbox (with at most four concurrent requests), i.e. 1,000 a minute. Reads take that ceiling whole.
      read: perMinute({
        limit: 1_000,
        method:
          "Microsoft documents the Outlook Graph service limit as 10,000 requests per 10 minutes per app per " +
          "mailbox, i.e. 1,000/minute. NOT measured against a live 429",
      }),
      // Writes share that same documented budget; they are paced well under it because each one is a person
      // acting one message at a time, and the class a call sits in tracks what it DOES (Gmail's reasoning).
      write: perMinute({
        limit: 150,
        method:
          "a conservative fraction of the documented 1,000/minute Outlook Graph budget, matching the Gmail " +
          "door's write pacing. NOT measured against a live 429",
      }),
    },
    // The token endpoint MSAL calls publishes no per-user quota; its label takes the tightest class.
    fallbackClass: "write",
    // Microsoft scopes the limit to the app and the MAILBOX; one grant per state home binds one mailbox.
    scope: "per-user",
  },
  // Fathom publishes THREE numbers, and the middle one is why this entry is not a single class: an
  // ordinary call is 60/min, a request that carries a transcript or a summary is a "heavy" 30/min "and
  // during periods of elevated activity this limit may be adjusted down to 5 every 60 seconds", and a
  // recording download is its own 30/min. This lane's ONLY call is `/meetings` with `include_transcript`,
  // which is heavy by the provider's own definition — so the heavy class is what it must be paced at, and
  // pacing it at the global 60 would earn a 429 on every page of a real crawl.
  //
  // The heavy row encodes 30 rather than the degraded 5: the degradation is conditional on Fathom's load
  // and is not observable from here, and a 429 that does arrive records a block every caller then waits on,
  // which is the mechanism that handles the degraded case without pacing every ordinary run five times too
  // slowly. Source: https://developers.fathom.ai/api-overview.
  fathom: {
    endpointClasses: {
      heavy: perMinute({
        limit: 30,
        method:
          "Fathom's published heavy-request limit (30 per 60 seconds) for /recordings summary and " +
          "transcript endpoints and for /meetings with include_summary or include_transcript, read from " +
          "https://developers.fathom.ai/api-overview on 2026-09-10. NOT measured against a live 429. The " +
          "same page states the limit may be adjusted down to 5 per 60 seconds under elevated activity",
      }),
      read: perMinute({
        limit: 60,
        method:
          "Fathom's published global authenticated limit (60 calls per 60 seconds), read from " +
          "https://developers.fathom.ai/api-overview on 2026-09-10. NOT measured against a live 429",
      }),
    },
    // The TIGHTEST class this provider has, per the field's own contract — so a Fathom call added later
    // without a label entry is paced as heavy rather than as an ordinary read.
    fallbackClass: "heavy",
    scope: "per-token",
  },
  linear: {
    endpointClasses: {
      read: {
        documentedLimit: 2_500,
        intervalMs: 3_600_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "MEASURED against the live API on 2026-08-03: `rateLimitStatus` reported allowedAmount 2500 " +
            "requests/hour for this API key, corroborated by the x-ratelimit-requests-limit response header. " +
            "Linear also enforces a SEPARATE 3,000,000 complexity/hour budget and a 10,000-point per-query " +
            "ceiling, neither of which this registry models — complexity tracks the size of NESTED " +
            "connections and is independent of the outer page size, so a request's cost is not derivable " +
            "from a request count. Superseded a documented 1,500 that predated any measurement.",
          onIso: "2026-08-03",
          status: "measured",
        },
      },
      // A separate class for MUTATIONS, carrying the same documented hourly quota because Linear counts them
      // against the same per-key budget. It is not redundant with `read`: an irreversible write needs its own
      // pacing knob and its own retry posture, and mapping `linear.issueCreate` to a class literally named
      // "read" would make the registry lie about what the call does. Linear now also publishes endpoint-
      // specific limits which nobody here has transcribed, so this number is the conservative overall one.
      write: {
        documentedLimit: 2_500,
        intervalMs: 3_600_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Shares the read class's MEASURED 2,500/hour (2026-08-03) because Linear counts mutations " +
            "against the same budget. Linear's per-endpoint mutation limits are still NOT transcribed and " +
            "NOT measured against a live 429",
          onIso: "2026-08-03",
          status: "documented",
        },
      },
    },
    fallbackClass: "read",
    // Linear scopes the quota to the authenticated USER, and says so explicitly: several API keys belonging
    // to one person share one budget. Worth stating precisely, because the shared 429 block is keyed by a
    // hash of the TOKEN (`scopeIdForToken`), so two keys for the same user would get independent block
    // scopes and could each keep spending a budget the other had already exhausted. Latent rather than live
    // — this repo resolves a single Linear key — but the registry should describe the provider truthfully
    // rather than describe our own key-derivation.
    scope: "per-user",
  },
} satisfies Readonly<Record<string, ProviderRateLimits>>;
