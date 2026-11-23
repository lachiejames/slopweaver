/**
 * What this atlas declares about itself, including the two things it cannot yet do.
 *
 * ## Three surfaces, and only one of them is filled
 *
 * A descriptor's `status` is static, which is the trap `jumpcloud/descriptor.ts` names: a surface declared
 * `filled` in source is filled on every install, including one where the acquisition has never run. So each
 * flag below is a claim this build can actually make.
 *
 * - `graph-specification` is `filled`, because `atlas microsoft365 sync` ships in this commit and fills it
 *   from a pinned, publicly published document — it needs no credential and reaches no tenant.
 * - `graph-api` is `declared-unfilled`, and it is the one that matters: this installation holds no Entra
 *   application registration, so nothing has ever read this tenant's directory. That is the whole distance
 *   between a map of Graph and the atlas this platform is supposed to have.
 * - `admin-consoles` is `declared-unfilled` because no page has been visited. 74 pages across seven consoles
 *   are DECLARED (`browserPages.ts`), which is what makes the emptiness measurable rather than invisible.
 *
 * ## Why this atlas holds entities and its Slack and Notion siblings do not
 *
 * `docs/atlas-intent/06-holdings.md` is a test, not a preference: does something better suited already hold this
 * platform's entities? For Slack the corpus does, so its atlas maps the interface alone. Here nothing does —
 * the directory this organisation actually runs on is reachable through no other source in this installation
 * — so the answer is everything reachable for identity and configuration, entities included, minus the
 * highly voluminous. `graph-api` is the surface those entities will land on.
 *
 * ## `excludes` is long because the platform is
 *
 * `kit/contract.ts` requires it and says why: what an atlas deliberately does NOT hold is the fact a reader
 * needs most and the one nobody writes unless a type demands it. Every entry below is a decision with a
 * reason, not a limitation being apologised for.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { MICROSOFT365_ATLAS_PLATFORM, MICROSOFT365_KINDS, MICROSOFT365_VISIBILITY_SCOPE } from "./model.js";

/** This atlas, as it declares itself. */
export const MICROSOFT365_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the ROWS of every voluminous family — mailbox and channel messages, file listings and file bytes, calendar events, the unified audit log (sign-ins, directory audits, provisioning), Intune audit and endpoint-analytics series, risk detections, usage reports, security alerts and incidents, threat intelligence, call records, print jobs, service-health messages, meeting recordings and transcripts, and workbook and OneNote bodies. Each of those operations IS held, with the rule that classified it and the reason in English; what is never held is a row per record. That is a disposition rather than an exclusion, and `dispositions.ts` is where the criterion is applied per operation rather than per product area",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "messages, calendar events, the unified audit log, Intune series, risk detections, usage reports, alerts, call records and print jobs are all per-instant emissions rather than configuration",
        wouldBeMeasuredBy:
          "`POST /auditLogs/signIns` over a fixed window through a live Graph channel, counting rows returned",
      },
    },
    {
      because:
        "every mutation. 8,311 of Graph's 17,777 operations change something, and this atlas will call none of them: no user is provisioned, no policy or group membership is edited, no device action is taken, no mail is sent. Each is still recorded as a row, because an atlas that omitted them would answer `Graph offers no way to do that`, which is false — recording that a mutation exists is not the same as being able to perform one",
      ground: "never-acted",
    },
    {
      because:
        "Microsoft Graph's `beta` surface. It is larger than `v1.0`, changes without notice, and is what several Entra console pages actually call, so its absence is carried as a permanent open gap (`beta-surface-not-compiled`) rather than as a silence",
      ground: "not-fetched",
      wouldBeClosedBy:
        "compiling Graph's `beta` surface, carried as the permanent open `beta-surface-not-compiled` gap",
    },
    {
      because:
        "any response VALUE, on any surface. The compiled channel calls nothing at all, so every field it holds is a NAME — a method, a path shape, a parameter, a response field. When a live Graph channel lands it will need the field-denial boundary its JumpCloud and 1Password siblings have, because `passwordCredentials`, `keyCredentials` and the synchronization secret endpoints are all on this surface",
      ground: "names-not-values",
    },
    {
      because:
        "the SharePoint admin console's own origin, which embeds the organisation's name. Its three declared pages resolve their root at run time and the name is written nowhere in this repository — the same mechanism the Notion atlas uses for its workspace slug",
      ground: "names-not-values",
    },
    {
      because:
        "any console page reachable only to a directory role this account does not hold. Each declared page records the role it is BELIEVED to need, so a 403 can be read as a stated ceiling rather than as a broken route — and that belief is a belief until a walk measures it",
      ground: "claim-not-made",
    },
  ],
  kinds: [...MICROSOFT365_KINDS],
  platform: MICROSOFT365_ATLAS_PLATFORM,
  question:
    "what identity and configuration does this Microsoft 365 tenant hold — every Graph operation that can " +
    "ask for it, every admin-console page that governs it, which families are too voluminous to keep, and " +
    "which of it this installation can currently reach at all",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas microsoft365 sync",
  surfaces: [
    {
      denominator: {
        because:
          "Microsoft 365 publishes no catalogue of its `graph-specification` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "graph-specification",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Microsoft 365 publishes no catalogue of its `graph-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "graph-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds no Entra application registration, so nothing has ever called Graph and no " +
        "entity of this tenant's has been read. Creating one needs admin consent on a directory this " +
        "repository's owner does not administer alone, which is a widening of access rather than a piece of " +
        "work — it is the owner's to grant and is recorded as the `graph-credential-absent` gap. This flips " +
        "to filled in the commit that lands a client and proves it against the tenant, never before it",
    },
    {
      denominator: {
        because:
          "Microsoft 365 publishes no catalogue of its `admin-consoles` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "admin-consoles",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "74 pages across seven consoles are declared and NONE has been visited: no browser was connected to " +
        "this machine when the atlas was built, so nothing was reached, photographed or graded. The " +
        "transport exists and is proven elsewhere (`browser/playwrightCli.ts`, the owner's real Chrome " +
        "through the extension relay). A surface is filled by pages actually reached, never by a transport " +
        "that could reach them",
    },
  ],
  visibilityScope: MICROSOFT365_VISIBILITY_SCOPE,
};
