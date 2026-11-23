/**
 * The Datadog atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These three do: `sync` publishes the
 * compiled catalogue — every operation the pinned client declares, from a registry committed to this
 * repository — and with `--live` goes on to ask THIS organisation through the closed acquisition registry;
 * `walk` fills the console surface from the owner's own Chrome against the live left nav the owner accepted
 * as the denominator (`consolePages.ts`); `reset` archives a generation.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The datadog row of the registry. */
export const DATADOG_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` alone reads a registry committed to this repository and writes only the local atlas under
    // $SLOPWEAVER_HOME — no request, no credential, the same shape as `atlas airtable sync`. `--live` is
    // the half that reaches Datadog, and it reaches it through the `slopweaver` transport rather than a
    // hand-rolled one, which is what keeps this row `doorRouted: false` honest for the default invocation
    // while the flag's own effect is external-read.
    doorRouted: false,
    example: "slopweaver atlas datadog read --kind monitor --query downtime",
    summary:
      "The Datadog atlas: every operation the pinned client declares — 1,735 of them across 144 kinds, " +
      "each carrying what this atlas DOES with it (654 entity, 90 shape-index, 3 probe-only, 988 " +
      "inventoried and never called) — published offline with no credential, and `sync --live` to ask " +
      "this organisation the 329 of them that need no identifier, and `walk` to fill the `console` channel " +
      "from the live left nav in the owner's own Chrome. `api` is bounded by four named remainders, and " +
      "every kind's coverage cell says exactly which",
  },
  platform: "datadog",
  readDescriptor: async () => (await import("./descriptor.js")).DATADOG_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readDatadogSnapshot(args),
  verbs: [
    {
      describe:
        "publish the compiled catalogue from the committed operation registry; no network call and\nno credential. `--live` then asks this organisation the 329 admitted operations that need\nno identifier, and fills the `api` channel of the entities the catalogue just made",
      load: async () => (await import("../../cli/commands/datadogAtlas/syncRun.js")).datadogAtlasSyncCommand,
      usage: ["sync [--live] [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe:
        "fill the console surface in the owner's own Chrome: photograph every page the left nav declares and\nrecord what each called, re-read the live nav so the declared list is checked rather than trusted,\nand open the command palette for the calls only it makes",
      load: async () => (await import("../../cli/commands/datadogAtlas/walkRun.js")).datadogAtlasWalkCommand,
      usage: ["walk [--limit <n>] [--skip-nav] [--skip-palette] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/datadogAtlas/resetRun.js")).datadogAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
