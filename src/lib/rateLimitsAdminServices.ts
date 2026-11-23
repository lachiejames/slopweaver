/**
 * The provider rate limits of identity, security training and message-delivery services.
 *
 * One category of the provider rate-limit registry: `./rateLimits.ts` spreads it into `PROVIDER_RATE_LIMITS`, which
 * stays the one table every consumer reads. A new provider goes in the category whose theme it belongs to, and a
 * category file nearing 300 code lines splits again.
 */

import type { ProviderRateLimits } from "#lib/rateLimitQuota.js";
import { RECORDED_ON, SAFETY } from "#lib/rateLimitQuota.js";

/** The rate limits of identity, security training and message-delivery services, keyed by provider. */
export const ADMIN_SERVICE_RATE_LIMITS = {
  // JumpCloud publishes no numeric rate limit for the Directory API. What it DOES publish is guidance:
  // back off on 429 and 5xx, and pace requests, because insufficient pacing can get a caller flagged for
  // suspected abuse — it specifically documents 503s on large command-results reads. So this row is
  // `undocumented`, and the number is a deliberately conservative ceiling rather than a published one.
  //
  // The pacing is not optional caution here. A full JumpCloud atlas sync is at least 20,730 requests
  // (274 systems x 75 per-system operations, plus 180 Directory Insights day partitions), before parent
  // pagination or any retry. An unregistered provider gets `endpointClass: "unknown"` and no scheduler at
  // all, which is what this entry exists to prevent.
  //
  // ONE class, deliberately: this atlas issues no writes, so a `write` class would be a label with nothing
  // to wear it.
  jumpcloud: {
    endpointClasses: {
      read: {
        documentedLimit: 10,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "JumpCloud publishes no numeric limit; its API best-practices page directs callers to back off on 429/5xx and to pace to avoid suspected-abuse blocking. Ten per second is a conservative self-imposed ceiling, not a published allowance",
          onIso: RECORDED_ON,
          status: "self-imposed",
        },
      },
    },
    fallbackClass: "read",
    // The key IS the unit: a JumpCloud API key belongs to one administrator and carries that
    // administrator's permissions, so pacing is per-token rather than per-tenant.
    scope: "per-token",
  },
  // ONE class: the KnowBe4 door's transport can only send a GET (`src/live/knowbe4/transport.ts`).
  knowbe4: {
    endpointClasses: {
      read: {
        documentedLimit: 50,
        intervalMs: 60_000,
        // The allowance is the whole ACCOUNT's and Vanta's connector draws on it from another process this door
        // cannot see, so the pace is cut to 30%: 15 of the 50 a minute, leaving Vanta 35 where 80% left it 10 (p3).
        // The run's own request ceiling (`src/atlas/knowbe4/fill/run.ts`) bounds the day.
        safetyFactor: 0.3,
        verification: {
          method:
            "KnowBe4's Fair Usage Policy (support.knowbe4.com/hc/en-us/articles/45870261990035): the Reporting API allows 4 requests a second, 50 a minute (exceeding it is a five-minute penalty) and 2,000 plus the licensed-user count a day, per account. NOT measured against a live 429",
          onIso: "2026-10-15",
          status: "documented",
        },
      },
    },
    fallbackClass: "read",
    // KnowBe4 meters the account, whichever token calls; one token per state home makes the token's hash the
    // account's.
    scope: "per-tenant",
  },
  // The Knock door's two classes are Knock's own published tiers (`src/live/knock/transport.ts` sends only GETs).
  knock: {
    endpointClasses: {
      tier3: {
        documentedLimit: 60,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Knock's API reference (docs.knock.app/api-reference/overview): Tier 3 is 60 requests a second, and the OpenAPI document at api.knock.app/v1/openapi puts message events and delivery logs on it. NOT measured against a live 429",
          onIso: "2026-10-18",
          status: "documented",
        },
      },
      tier4: {
        documentedLimit: 200,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Knock's API reference (docs.knock.app/api-reference/overview): Tier 4 is 200 requests a second, and the OpenAPI document at api.knock.app/v1/openapi puts the message lists and a single-message read on it. NOT measured against a live 429",
          onIso: "2026-10-18",
          status: "documented",
        },
      },
    },
    fallbackClass: "tier3",
    // Knock meters per environment, and a secret key belongs to exactly one environment, so the key's hash is the
    // environment's.
    scope: "per-token",
  },
  // ONE class: the Twilio door's transport can only send a GET (`src/live/twilio/transport.ts`).
  twilio: {
    endpointClasses: {
      read: {
        documentedLimit: 10,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Twilio publishes a concurrency limit for its REST API and answers 429 past it, not a request rate for reading Messages. Ten a second is a conservative self-imposed ceiling over an investigator's handful of list pages, not a published allowance",
          onIso: "2026-10-18",
          status: "self-imposed",
        },
      },
    },
    fallbackClass: "read",
    // An API key belongs to one account, and the door reads under exactly one key, so the key IS the unit.
    scope: "per-token",
  },
  // Not one provider but whichever sender published a message's RFC 8058 one-click target
  // (`src/live/gmail/unsubscribe.ts`). No sender publishes a limit for it, and none needs one here: each POST is
  // one message a person chose, sent once with no retry. ONE class, because the only call is that write.
  "mail-sender": {
    endpointClasses: {
      write: {
        documentedLimit: 1,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "RFC 8058 defines the one-click POST and no rate; each target belongs to a different sender. One per second is a self-imposed ceiling over a call made once per chosen message",
          onIso: RECORDED_ON,
          status: "self-imposed",
        },
      },
    },
    fallbackClass: "write",
    // The target URL carries the token that names the subscriber, so the unit a sender could count is that token.
    scope: "per-token",
  },
} satisfies Readonly<Record<string, ProviderRateLimits>>;
