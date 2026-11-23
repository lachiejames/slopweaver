/**
 * What the Hex atlas declares about itself — the row a catalogue shows, and the honest answer to "how much
 * of this platform have you actually looked at".
 *
 * ## This one is the SURFACE MAP, and the reason is a constraint rather than a holder
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? For Slack it does — the corpus — so that atlas maps the interface
 * alone. For Hex nothing does, so §6 read on its own would say "everything reachable, entities included".
 *
 * It does not, and the reason is the owner's own. Hex is in scope as a surface map with the explicit care
 * that this atlas store NO CUSTOMER DATA LOCALLY. A Hex project
 * is a notebook over the organisation's warehouse, so the thing behind a handful of these operations is a
 * result set. The owner's line is the design brief: a surface map holds the existence and shape of projects and
 * pages, never their result sets.
 *
 * `disposition.ts` turns that into a third disposition applied per operation, and `withheld` is what a
 * reader greps for. It is not an exclusion: every withheld operation is mapped in full — method, path,
 * parameters, declared response field names, the credential it needs, the URL to open — and never called for
 * its body.
 *
 * ## Two of the five surfaces are unfilled, and they are blocked on different things
 *
 * `workspace-api` has no token, and the only route to one is a WRITE this installation's own guard refuses
 * (`model.ts`'s {@link HEX_ENTITY_UNBLOCKED_BY}). `web-app` needs a signed-in browser and a walk. They are
 * stated separately rather than as one "not configured", because a surface whose stated blocker has been
 * cleared while the surface stays empty is the exact shape of a cell that has stopped being true.
 *
 * ## No surface's status is a literal a reader ever sees
 *
 * A descriptor's `status` is static, which is the trap this class of file most often falls into: a surface
 * declared `filled` in source is filled on every install, including one where the sync has never run. So
 * `surfaceFill.ts` derives the three fillable surfaces from this install's own manifest and substitutes them
 * before any reader sees this object. The literals below are what a store that has never been synced
 * honestly says.
 *
 * ## Why `excludes` is long
 *
 * `kit/contract.ts` requires it and says why: what an atlas deliberately does NOT hold is the fact a reader
 * needs most and the one nobody writes unless a type demands it.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { HEX_PROBE_CENSUS } from "./apiProbe.js";
import { hexDeclaredPages, hexParameterisedRoutes } from "./browserPages.js";
import { HEX_CLIENT_SURFACE } from "./generated/clientSurface.js";
import { HEX_ATLAS_KINDS, HEX_ATLAS_PLATFORM, HEX_ENTITY_UNBLOCKED_BY, HEX_VISIBILITY_SCOPE } from "./model.js";
import { HEX_FIELD_DEPTH } from "./specSurface.js";

/** Hex's atlas, as it declares itself. */
export const HEX_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every RESULT SET, on every surface, permanently. A cell's computed output, a chart image drawn from " +
        "one, an exported project and an agent thread's messages are mapped in full — method, path, " +
        "parameters, declared response field names, the credential each needs — and never called for their " +
        "body. This is the owner's rule that Hex is in scope with the care that no " +
        "customer data is stored locally, and `disposition.ts` carries the criterion so it decides an " +
        "operation nobody has seen yet. It is a DISPOSITION rather than an exclusion: a reader learns that Hex " +
        "has a way to read a cell's output, where it lives and what it takes",
      ground: "disclosure-bound",
      ruledBy: "owner ruling: Hex is in scope on the condition that no customer data is stored locally",
    },
    {
      because:
        "a response's own field NAMES for those same operations, which no sibling atlas withholds and this one " +
        "must. On an ordinary platform a field name is what the endpoint offers and a value is what the " +
        "account holds; on a data workspace a result's field names ARE the column names of whatever table the " +
        "query ran against, and a pivoted result promotes its values to keys. `webReduction.ts` refuses the " +
        "shape rather than redacting it, and every such row stores the reason in `fieldsWithheldBecause` so " +
        "an empty field list is never mistaken for an empty body",
      ground: "disclosure-bound",
      ruledBy:
        "owner ruling: on a data workspace a result's field names ARE the column names of the customer's own table, so the same ruling reaches them",
    },
    {
      because:
        "every mutation on both surfaces. This atlas only ever reads: no project created or run, no cell " +
        "changed, no user deactivated, no guide published. `exclusions.ts` computes the refusal from the HTTP " +
        "method rather than listing endpoints, so an API Hex publishes next month is refused without this " +
        "repository changing — and every refused operation still gets a `method` row, because an atlas that " +
        "omitted them would answer that Hex has no way to run a project",
      ground: "never-acted",
    },
    {
      because:
        "a row per project RUN. Hex appends one per execution for the life of a project, so the family is " +
        "bounded by the clock rather than by anything a person maintains — `docs/atlas-intent/06-holdings.md`'s own bound, " +
        "applied per operation. The run operations are mapped and shape-indexed; the rows are not stored",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "Hex appends one row per project execution for the life of a project, so the family is bounded by the clock rather than by anything a person maintains",
        wouldBeMeasuredBy: "`GET /api/v1/project/{id}/runs` paged to exhaustion for the busiest project",
      },
    },
    {
      because:
        `a page for any of the ${String(hexParameterisedRoutes().length)} route templates that take a ` +
        "parameter. Visiting one needs a project locator, a collection id or a thread id, and an id would " +
        "have to come from the workspace's own contents — the half of Hex this atlas deliberately does not " +
        "reach. A reader learns that Hex has a project page; what this atlas does not hold is a photograph of " +
        "one particular project, which is `docs/atlas-intent/06-holdings.md`'s screenshot rule in Hex's terms",
      ground: "never-acted",
    },
    {
      because:
        `response fields nested more than ${String(HEX_FIELD_DEPTH)} levels deep, on either surface. The two ` +
        "surfaces are measured at the same depth on purpose — a divergence found between two different depths " +
        "would be an artefact of the measurement rather than a fact about Hex, which is the opposite of what " +
        "`report.ts` exists to find",
      ground: "names-not-values",
    },
    {
      because:
        "which HTTP methods a probed noun accepts. MEASURED in `apiProbe.ts`: the router authenticates a whole " +
        "`/api/v1` subtree before routing within it, so an unauthenticated request discriminates at the first " +
        "segment and nowhere deeper. A mounted noun's row carries `*` as its method rather than a guess, and " +
        "the depth control that establishes the bound is recorded beside the census",
      ground: "claim-not-made",
    },
  ],
  kinds: [...HEX_ATLAS_KINDS],
  platform: HEX_ATLAS_PLATFORM,
  question:
    "what can be asked of Hex and where does it live — every published API operation, parameter and " +
    "response field, which `/api/v1` nouns the router actually mounts, every GraphQL operation the shipped " +
    "web client can send, and every page of the app with the URL that proves it — and, for the operations " +
    "that would hand back warehouse rows, that they exist and what they take without ever holding what they " +
    "return",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas hex refresh",
  surfaces: [
    {
      denominator: {
        because:
          "Hex publishes no catalogue of its `spec-declared` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "spec-declared",
      role: "authoritative",
      // A LITERAL nobody reads: `surfaceFill.ts` derives this surface's status from the install's own
      // manifest and substitutes it before any reader sees the descriptor.
      status: "declared-unfilled",
      unfilledBecause: "`slopweaver atlas hex sync` has not run on this install, so nothing is published",
    },
    {
      denominator: {
        because:
          "Hex publishes no catalogue of its `unauthenticated-probe` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: false,
      name: "unauthenticated-probe",
      role: "discovery",
      status: "declared-unfilled",
      unfilledBecause:
        `the census of ${String(HEX_PROBE_CENSUS.length)} candidate nouns is committed in \`apiProbe.ts\` ` +
        "and is published by `slopweaver atlas hex sync`, which has not run on this install. Re-measure it " +
        "against the live router with `yarn tsx tools/probeHexApiSurface.ts --verify`",
    },
    {
      denominator: {
        because:
          "Hex publishes no catalogue of its `client-bundle` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: "client-bundle",
      role: "discovery",
      status: "declared-unfilled",
      unfilledBecause:
        `the ${String(HEX_CLIENT_SURFACE.routes.length)} route templates and ` +
        `${String(HEX_CLIENT_SURFACE.graphqlOperations.length)} GraphQL operations compiled out of the ` +
        "shipped client are committed in `generated/clientSurface.ts` and published by " +
        "`slopweaver atlas hex sync`, which has not run on this install",
    },
    {
      denominator: {
        because:
          "Hex publishes no catalogue of its `workspace-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "workspace-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause: HEX_ENTITY_UNBLOCKED_BY,
    },
    {
      denominator: {
        because:
          "Hex publishes no catalogue of its `web-app` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "web-app",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        `\`slopweaver atlas hex walk\` has not reached one of the ${String(hexDeclaredPages().length)} ` +
        "compiled static routes on this install. A surface is filled by pages actually reached, never by a " +
        "transport that could reach them, so this literal is what a store that has never walked honestly " +
        "says — `surfaceFill.ts` substitutes the derived status before any reader sees it. A walk that " +
        "finds the session gone grades the route `signed-out` and says so rather than reporting an empty " +
        "surface",
    },
  ],
  visibilityScope: HEX_VISIBILITY_SCOPE,
};
