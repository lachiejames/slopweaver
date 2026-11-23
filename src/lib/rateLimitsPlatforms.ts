/**
 * The provider rate limits of code hosting, Google Workspace and admin surfaces, and automation platforms.
 *
 * One category of the provider rate-limit registry: `./rateLimits.ts` spreads it into `PROVIDER_RATE_LIMITS`, which
 * stays the one table every consumer reads. A new provider goes in the category whose theme it belongs to, and a
 * category file nearing 300 code lines splits again.
 */

import type { ProviderRateLimits } from "#lib/rateLimitQuota.js";
import { perMinute, RECORDED_ON, SAFETY } from "#lib/rateLimitQuota.js";

/** The rate limits of code hosting, Google Workspace and admin surfaces, and automation platforms, keyed by provider. */
export const PLATFORM_RATE_LIMITS = {
  github: {
    endpointClasses: {
      read: {
        documentedLimit: 5_000,
        intervalMs: 3_600_000,
        safetyFactor: SAFETY,
        verification: {
          method: "GitHub REST documented authenticated hourly quota; Octokit's own throttling plugin is the enforcer",
          onIso: RECORDED_ON,
          status: "documented",
        },
      },
      // A separate class for MUTATIONS, and unlike Linear's it carries a genuinely DIFFERENT number. GitHub
      // meters content-creating requests under a secondary limit — 80 per minute and 500 per hour — against
      // a 5,000/hour primary. So mapping `pulls.create` to a class called `read` would not merely mislabel
      // it, it would pace it ten times too fast and walk into the secondary limit.
      //
      // The 500/hour figure is the tighter SUSTAINED ceiling and is what this row encodes. It is
      // `documented`, not `measured`: nothing here has observed a live 429 at either boundary, and GitHub
      // states the content limit spans web, REST and GraphQL activity and may change without notice.
      write: {
        documentedLimit: 500,
        intervalMs: 3_600_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "GitHub documents secondary content-generation limits of 80 requests per minute and 500 per " +
            "hour; this row encodes the tighter sustained 500/hour ceiling and has NOT been measured " +
            "against a live 429. The docs do not assign that secondary bucket a token scope, so the " +
            "provider-wide per-token scope here is the schema's contract rather than a measurement",
          onIso: "2026-08-03",
          status: "documented",
        },
      },
    },
    // The fallback must be the TIGHTEST class — an existing ratchet asserts it, and the reason is that an
    // unmapped operation is one nobody has classified, so it must be assumed to be the expensive kind.
    // Safe to flip today because every GitHub operation in the tree is explicitly mapped (verified: 18 used,
    // 18 mapped, none falling through), and `operation-labels` refuses to let a new unmapped one appear.
    fallbackClass: "write",
    scope: "per-token",
  },
  calendar: {
    endpointClasses: {
      // Google publishes the Calendar API's ceiling as a PROJECT-wide daily figure (1,000,000 queries/day)
      // rather than the per-user per-minute shape most rows here use, so the number below is a translation
      // of it: 1,000,000/day sustained is ~694/minute, rounded down to 600 and then derated by the shared
      // safety factor on top. Deliberately ONE class: Google meters reads and writes on the same project
      // quota, so the three `events.*` mutations (`src/live/calendar/writeApi.ts`) share it rather than
      // inventing a tighter class no document names.
      read: perMinute({
        limit: 600,
        method:
          "Google documents a Calendar API project quota of 1,000,000 queries/day (~694/minute sustained), " +
          "rounded down to 600/minute here. NOT measured against a live 429",
      }),
    },
    // The two `oauth.*` labels are Google's identity endpoints rather than the Calendar API, and they are
    // metered by nothing this registry can cite. There is only one class to fall back to, which is the
    // conservative direction by construction.
    fallbackClass: "read",
    // Google's per-user Calendar quota is scoped to the authenticated ACCOUNT. The shared 429 block keys on
    // a hash of the credential and this repo binds exactly one grant per state home, so the two agree.
    scope: "per-user",
  },
  drive: {
    endpointClasses: {
      // Drive publishes a per-USER ceiling of 12,000 queries per minute against a per-project 20,000, and
      // does NOT meter in the quota units Gmail does — a `files.list` and a `files.get` cost one query each.
      // The per-user number is the binding one here because this repo holds exactly one grant per state
      // home. It is a TRANSCRIPTION of a documented figure, not a measurement against a live 429.
      read: perMinute({
        limit: 12_000,
        method:
          "Google documents a Drive API per-user limit of 12,000 queries/minute (per-project 20,000). NOT " +
          "measured against a live 429",
      }),
      // No write class, because this door has none: every Drive scope it asks for is read-only, so the
      // tightest class it can fall back to is the read one. A write verb added later would have to widen
      // the consent screen first, and would add its own row here at the same time.
      write: perMinute({
        limit: 12_000,
        method:
          "the same documented per-user ceiling as `read`; this door issues no writes at all, so there is no " +
          "separate documented figure to record and none is invented",
      }),
    },
    // The two `oauth.*` labels publish no per-user request quota at all, so rather than invent one their
    // labels take the tightest class this provider has — which here is the same number as `read`, stated
    // rather than left to be inferred from the two rows looking alike.
    fallbackClass: "write",
    // Google scopes the Drive quota to the authenticated USER, and this repo binds exactly one Drive grant
    // per state home, so the two agree here.
    scope: "per-user",
  },
  "google-admin": {
    endpointClasses: {
      // SELF-IMPOSED, and the arm is the honest one rather than a modest one. This door spans FIVE Google
      // services — admin, chromemanagement, chromepolicy, cloudidentity and vault — and they do not publish
      // one shared per-user request ceiling between them; the atlas fill enumerates across all five in a
      // single run, so no one vendor figure would govern it even if each were transcribed. 300/minute is a
      // floor chosen to be slower than any per-user ceiling Google is likely to publish for an
      // administrative read, not a transcription of an allowance. Measure it and this row changes arm.
      read: {
        documentedLimit: 300,
        intervalMs: 60_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "no single vendor ceiling governs the five Admin-console APIs this door spans, so this is a " +
            "conservative pacing floor rather than a documented allowance. NOT measured against a live 429",
          onIso: "2026-09-06",
          status: "self-imposed",
        },
      },
    },
    // One class, because this door has none but reads: every scope it can request is a `.readonly` one
    // (`src/live/googleAdmin/scopes.ts`), so the tightest class it can fall back to is the read one. The
    // two `oauth.*` labels publish no per-user quota at all and take it for the same reason.
    fallbackClass: "read",
    // Google scopes an administrative read to the authenticated ACCOUNT, and this repo binds exactly one
    // Google Admin grant per state home, so the two agree here.
    scope: "per-user",
  },
  "google-secops": {
    endpointClasses: {
      // SELF-IMPOSED. Chronicle meters each method against its own per-project quota in the instance's Cloud
      // project, and this door has not read those figures off a live 429; one request a second is a floor
      // slower than any per-method read quota Google is likely to set, not a transcription of one.
      read: {
        documentedLimit: 60,
        intervalMs: 60_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Chronicle's per-method quotas live in the instance's own Cloud project and were not read for " +
            "this row, so this is a conservative pacing floor rather than a documented allowance. NOT measured " +
            "against a live 429",
          onIso: "2026-10-02",
          status: "self-imposed",
        },
      },
    },
    // One class, because this door has none but reads: its transport can only send a GET
    // (`src/live/googleSecops/transport.ts`) and its one scope is `chronicle.readonly`. The two `oauth.*`
    // labels publish no per-user quota and take the read class for the same reason.
    fallbackClass: "read",
    // One SecOps grant per state home, so the account and the rate scope agree.
    scope: "per-user",
  },
  make: {
    endpointClasses: {
      // DOCUMENTED, at the floor. Make meters API requests per ORGANISATION per minute by plan — Core 60,
      // Pro 120, Teams 240, Enterprise 1,000 — and which plan this organisation is on is not readable before
      // the first fill. The lowest plan's figure is the one that cannot be too fast for any of them.
      read: {
        documentedLimit: 60,
        intervalMs: 60_000,
        safetyFactor: SAFETY,
        verification: {
          method:
            "Make's API documentation (developers.make.com, Rate limiting) states per-organisation per-minute " +
            "limits by plan; this row takes Core's 60, the lowest. NOT measured against a live 429",
          onIso: "2026-10-15",
          status: "documented",
        },
      },
    },
    // One class, because this door has none but reads: its rail refuses every method but GET
    // (`src/atlas/make/client.ts`). It is PACED, not merely registered — `providerCall.ts`'s `PACED_CLASSES`.
    fallbackClass: "read",
    // One token per state home, and the token belongs to one organisation's member, so the token and the
    // organisation's quota agree.
    scope: "per-token",
  },
} satisfies Readonly<Record<string, ProviderRateLimits>>;
