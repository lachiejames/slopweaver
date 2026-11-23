/**
 * What the Google SecOps atlas declares about itself — the row a catalogue shows, and the honest answer to
 * "how much of this platform have you actually looked at".
 *
 * ## One surface, with a denominator from day one
 *
 * `chronicle-api-v1` is the Chronicle REST API under the SecOps door's own grant. Its denominator is the GET
 * count of the pinned v1 inventory — googleapis' own protos and service config, pinned by commit in
 * `generated/protoLock.ts` — so `exists` is a census rather than this atlas's own list, and `reached`
 * counts CALLS: zero until the fill lands. `descriptor.test.ts` holds `exists` to the census.
 *
 * The compiled inventory is deliberately NOT a surface of its own, unlike Google Admin's `discovery`: a
 * compiled surface either has no denominator, which the `atlas-content-coverage` gate refuses as new debt,
 * or claims `reached` for methods it never called. It is the denominator, not a channel.
 *
 * ## The status is static, so nothing here claims `filled` before it is
 *
 * `declared-unfilled` until the commit that lands the fill — and even then only once `reached` is above
 * zero, which the same gate enforces.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { GOOGLE_SECOPS_PROTO_COMMIT } from "./generated/protoLock.js";
import { GOOGLE_SECOPS_ATLAS_KINDS, GOOGLE_SECOPS_ATLAS_PLATFORM } from "./model.js";

/** Google SecOps's atlas, as it declares itself. */
export const GOOGLE_SECOPS_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation, on every surface, by the owner's ruling that nothing ever writes onto SecOps, neither via API nor the browser. All 48 mutating v1 methods are INVENTORIED with an exclusion reason on each row rather than omitted, the door's transport can only express a GET to the configured instance's own regional host, and its grant carries `chronicle.readonly` and nothing wider",
      ground: "never-acted",
    },
    {
      because:
        "the five POST methods Chronicle itself classes as reads — searches, queries, batch gets and text verifications whose request carries a body. A POST read is still not a GET, and the door sends GETs only, so each is inventoried with reason `query` and never called",
      ground: "never-acted",
    },
    {
      because:
        "any credential a log feed carries. A feed's configuration can hold the secret its source authenticates with; the fill records that the field exists and never stores what it held",
      ground: "secret-material",
    },
    {
      because:
        "the ENTRIES of a reference list or a data table. These are detection allowlists and indicator lists, so the atlas holds each one's name, size and row count rather than its contents until the owner rules otherwise",
      ground: "names-not-values",
    },
    {
      because:
        "the v1alpha and v1beta APIs, where curated rule sets, cases, parsers, legacy detections and UDM search live. googleapis publishes no protos for them, and the regional discovery document answered 403 to an unauthenticated read",
      ground: "not-fetched",
      wouldBeClosedBy:
        "fetching the regional v1alpha discovery document under the SecOps grant, pinning its bytes, and declaring it as a surface of its own with a GET denominator",
    },
  ],
  kinds: [...GOOGLE_SECOPS_ATLAS_KINDS],
  platform: GOOGLE_SECOPS_ATLAS_PLATFORM,
  question:
    "what this organisation's Google Security Operations (Chronicle) instance is configured to detect and ingest — its rules and their deployments, reference lists, data tables, watchlists, log feeds, dashboards, findings refinements and data-access controls — read only, never changed",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas google-secops fill",
  surfaces: [
    {
      // `reached` counts the GETs the fill CALLS, six, not the 21 the grant opens: fifteen of those are left
      // uncalled on purpose, each with its reason in `fill/plan.ts`, and the 18 cloud-platform-only GETs are
      // published as permission-blocked kinds rather than reached.
      denominator: {
        exists: 39,
        known: true,
        reached: 6,
        source: `generated/protoLock.ts — googleapis' own google/cloud/chronicle/v1 protos and chronicle_v1.yaml, pinned at ${GOOGLE_SECOPS_PROTO_COMMIT}: 39 GET methods, 21 reachable under chronicle.readonly and 18 only under cloud-platform`,
      },
      acquisition: "api",
      documented: true,
      name: "chronicle-api-v1",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope:
    "the API channel sees what the `chronicle.readonly` grant AND the consenting account's IAM role on the instance's Cloud project both open, on the one configured instance and no other; 'complete' is complete for that pair, and a method the scope or the role refuses is a declared permission gap rather than a silence",
};
