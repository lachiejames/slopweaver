/**
 * What the GraphQL Hive atlas declares about itself.
 *
 * ## This atlas holds EVERYTHING REACHABLE, and the criterion is not a preference
 *
 * `docs/atlas-intent/06-holdings.md`: the test is whether something better suited already holds this platform's
 * entities. For Slack the answer is yes — the corpus holds its channels, people and messages — so that
 * atlas maps the interface alone. For Hive the answer is no. Nothing anywhere in this installation holds a
 * schema registry, so the registry's own organisations, projects, targets and composed schemas are kinds
 * here rather than `held-elsewhere` cells pointing at a better store that does not exist.
 *
 * ## Four surfaces, because the API half genuinely splits in two
 *
 * A descriptor's `status` is static, which is the trap the JumpCloud atlas names: a surface declared
 * `filled` in source is filled on every install, including one where nothing has ever run. So only what
 * has actually been proven claims it.
 *
 * `registry-graphql-schema` is `filled`, and the evidence is a live run rather than a belief. MEASURED
 * against `api.graphql-hive.com/graphql` with NO credential: 26 root fields and 257 named types
 * in one introspection. That surface needs no token at all, which is exactly why it is a separate surface
 * from the content it describes — collapsing the two would have forced one status to lie about the other.
 *
 * `registry-content` is `declared-unfilled` and says what it needs. `console-page-map` is `compiled` and
 * `filled`: every console address the registry's slugs reach is published as a `page` entity, which is the
 * half of `docs/atlas-intent/05-browser-proof.md` that needs no browser at all. `console-walk` is the browser surface proper,
 * and it flips only when pages have actually been reached and photographed — never when a transport that
 * could reach them merely exists.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { HIVE_EXCLUSIONS } from "./exclusions.js";
import { HIVE_ATLAS_KINDS, HIVE_ATLAS_PLATFORM } from "./model.js";

/** GraphQL Hive's atlas, as it declares itself. */
export const HIVE_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [...HIVE_EXCLUSIONS],
  kinds: [...HIVE_ATLAS_KINDS],
  platform: HIVE_ATLAS_PLATFORM,
  question:
    "what GraphQL schemas this organisation's registry holds, which organisations, projects and targets " +
    "they hang off, what the registry's own API can be asked, and the exact console URL that proves each",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas graphql-hive refresh",
  surfaces: [
    {
      denominator: {
        because:
          "GraphQL Hive publishes no catalogue of its `registry-graphql-schema` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "registry-graphql-schema",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "GraphQL Hive publishes no catalogue of its `registry-content` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "registry-content",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "the query is written against the schema above and has never been sent, because it needs two " +
        "things this install has neither of: a registry access token, and an organisation slug — Hive's " +
        "public API declares no list field at all, so nothing can be enumerated from the token alone. " +
        "`slopweaver atlas graphql-hive sync --organization <slug>` with a token configured fills it",
    },
    {
      denominator: {
        because:
          "GraphQL Hive publishes no catalogue of its `console-page-map` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: "console-page-map",
      role: "discovery",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "GraphQL Hive publishes no catalogue of its `console-walk` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "console-walk",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no browser has been driven, so not one declared address is witnessed and none carries a " +
        "screenshot. A surface is filled by pages actually reached, never by a page map that says where " +
        "they would be — `slopweaver atlas graphql-hive walk` prints the brief that fills it",
    },
  ],
  visibilityScope:
    "two unrelated ceilings, one per channel: the API channel sees exactly what a registry access token's " +
    "own scopes permit, and the console channel exactly what the signed-in person's organisation role " +
    "opens. Neither implies the other — an SSO assignment opens the console and mints no token at " +
    "all — so a page or an operation missing from one is never evidence about the other",
};
