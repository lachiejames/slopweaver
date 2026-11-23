/**
 * The provider rate limits of documents and chat.
 *
 * One category of the provider rate-limit registry: `./rateLimits.ts` spreads it into `PROVIDER_RATE_LIMITS`, which
 * stays the one table every consumer reads. A new provider goes in the category whose theme it belongs to, and a
 * category file nearing 300 code lines splits again.
 */

import type { ProviderRateLimits } from "#lib/rateLimitQuota.js";
import { perMinute, RECORDED_ON, SAFETY } from "#lib/rateLimitQuota.js";

/** The rate limits of documents and chat, keyed by provider. */
export const CHAT_AND_DOCS_RATE_LIMITS = {
  notion: {
    endpointClasses: {
      read: {
        documentedLimit: 3,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method: "Notion documented average of three requests per second per integration",
          onIso: RECORDED_ON,
          status: "documented",
        },
      },
      // The SAME documented allowance as `read`, not a second budget. Notion publishes one average of three
      // requests per second per integration across every endpoint, so a write is not cheaper or dearer than
      // a read — the class exists so a mutation is LABELLED as one rather than filed under a read label,
      // which is what the operation-label gate is for. Neither class is in `PACED_CLASSES`, so neither
      // spends a scheduler of its own here; each lane paces itself and both share the 429 block.
      write: {
        documentedLimit: 3,
        intervalMs: 1_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Notion documented average of three requests per second per integration, shared across read and write",
          onIso: RECORDED_ON,
          status: "documented",
        },
      },
    },
    fallbackClass: "read",
    scope: "per-token",
  },
  slack: {
    endpointClasses: {
      // The native thinking indicator's OWN class, not `chat-post`'s and not a generic tier. Slack's
      // `assistant.threads.setStatus` reference page documents a SPECIAL limit of 600 requests per minute —
      // distinct from the message-post allowance and from every published tier.
      "assistant-status": perMinute({
        limit: 600,
        method:
          "Slack's assistant.threads.setStatus reference page documents a special limit of 600 requests per minute",
      }),
      "chat-post": perMinute({
        limit: 60,
        method: "Slack documents chat.postMessage as roughly one message per second per channel",
      }),
      tier1: perMinute({ limit: 1, method: "Slack published method-tier table, Tier 1" }),
      tier2: perMinute({ limit: 20, method: "Slack published method-tier table, Tier 2" }),
      tier3: perMinute({ limit: 50, method: "Slack published method-tier table, Tier 3" }),
      tier4: perMinute({ limit: 100, method: "Slack published method-tier table, Tier 4" }),
    },
    // Tier 1 is the tightest Slack has, so an operation nobody classified is paced as if it were the
    // slowest method in the API. Guessing generously is how a new call site discovers a 429 in production.
    fallbackClass: "tier1",
    scope: "per-workspace",
  },
} satisfies Readonly<Record<string, ProviderRateLimits>>;
