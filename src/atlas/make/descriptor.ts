/**
 * What the Make atlas declares about itself — the row a catalogue shows, and the honest answer to "how much
 * of this platform have you actually looked at".
 *
 * ## One surface, with a census for a denominator
 *
 * `make-api-v2` is Make's public API under the owner's own token. `exists` is the count of tools the pinned
 * `@makehq/sdk` itself annotates `readOnlyHint` — Make's own census of its read surface, not this atlas's
 * list — and `descriptor.test.ts` recomputes it from the installed package. One caveat stated rather than
 * buried: 1.6.20 marks `functions_check` read-only while scoping it `functions:write`, so the census is
 * Make's annotation, not an audit of 92 GETs. `reached` counts the logical tools the fill calls
 * (`fill/plan.ts`).
 *
 * The browser channel is declared in the model and has no surface: no walk fills it, and a declared-unfilled
 * surface with no denominator is debt the `atlas-content-coverage` gate refuses to grow.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { MAKE_FILL_OPERATIONS } from "./fill/plan.js";
import { MAKE_ATLAS_KINDS, MAKE_ATLAS_PLATFORM } from "./model.js";

/** How many tools the pinned SDK annotates `readOnlyHint` — `descriptor.test.ts` recomputes it. */
export const MAKE_READ_ONLY_TOOL_CENSUS = 92;

/** Make's atlas, as it declares itself. */
export const MAKE_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation and every run, by the owner's ask: nothing in make.com is changed or run. The SDK can create, update, delete and run scenarios; the door's rail (`client.ts`) refuses any method but GET, and any URL off the configured zone, before a request leaves the process",
      ground: "never-acted",
    },
    {
      because:
        "a blueprint's configuration — each module's mapper, parameters, metadata and filters, which can hold a hard-coded secret or a person's details. The atlas keeps the ORDER of module identifiers and the apps they belong to, which is what a scenario does, never how each step is configured",
      ground: "names-not-values",
    },
    {
      because:
        "an execution's detail and outputs, which carry the data a scenario moved. The atlas keeps each scenario's newest 20 list rows — when, how long, how it ended — and never calls the execution-detail read",
      ground: "secret-material",
    },
    {
      because:
        "a connection's metadata and uid, which can name the connected account and identify its credential. The atlas keeps which app and account type each connection is and which scenarios use it",
      ground: "secret-material",
    },
    {
      because:
        "a hook's URL, udid and data. The URL IS the capability: anyone holding it can start the scenario. The atlas keeps what the hook is, whether it is enabled and which scenario it starts",
      ground: "secret-material",
    },
    {
      because:
        "private spaces — per-user personal workspaces — which `teams.list` returns only on request. They are not asked for, so a scenario someone built in their own private space is not in the atlas",
      ground: "not-fetched",
      wouldBeClosedBy: "asking `teams.list` for private spaces once a live fill shows the token may read them",
    },
  ],
  kinds: [...MAKE_ATLAS_KINDS],
  platform: MAKE_ATLAS_PLATFORM,
  question:
    "what this organisation automates in Make — its teams, every scenario with its schedule, the apps and module outline that say what it does, who made and last edited it, how its recent runs ended, and the connections and webhooks it runs on — read only, never changed or run",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas make fill",
  surfaces: [
    {
      denominator: {
        exists: MAKE_READ_ONLY_TOOL_CENSUS,
        known: true,
        reached: new Set(Object.values(MAKE_FILL_OPERATIONS)).size,
        source:
          "@makehq/sdk@1.6.20's own tool census (`@makehq/sdk/tools` MakeTools): 203 tools, 92 annotated readOnlyHint",
      },
      acquisition: "api",
      documented: true,
      name: "make-api-v2",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope:
    "the API channel sees what the owner's token's ticked scopes AND the owner's roles on each team both open; 'complete' is complete for that pair, and the descriptor's excludes say what is deliberately never kept",
};
