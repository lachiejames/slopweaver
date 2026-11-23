/**
 * The Airtable atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` publishes both
 * compiled surface maps — the operation registry generated from Airtable's own OpenAPI document and the
 * browser route inventory measured without an account — and `reset` archives a generation.
 *
 * There is deliberately no `walk` here yet, and its absence is a statement rather than an oversight. A walk
 * needs a signed-in Airtable session, which only a member of the organisation's Airtable enterprise holds —
 * `src/atlas/airtable/descriptor.ts` carries the reasoning. Shipping a verb that could only
 * ever photograph the sign-in page would be worse than the declared-unfilled surface that says so.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The airtable row of the registry. */
export const AIRTABLE_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reads a committed registry and a committed route inventory and writes only the local atlas
    // under $SLOPWEAVER_HOME. No Airtable request is made and no credential is presented, so this is
    // local-state rather than external-read — the same shape as `atlas notion sync`.
    doorRouted: false,
    example: "slopweaver atlas airtable read --kind method --query automations",
    summary:
      "The Airtable atlas: EVERYTHING REACHABLE, because nothing else here holds an Airtable base. " +
      "Without a member account that is both surface maps — 103 Web API operations from Airtable's own " +
      "pinned OpenAPI document, each carrying a disposition, and 22 browser routes with 11 confirmed to " +
      "exist — while the entity kinds report not-configured naming the missing organisation invite",
  },
  platform: "airtable",
  readDescriptor: async () => (await import("./descriptor.js")).AIRTABLE_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readAirtableSnapshot(args),
  verbs: [
    {
      describe:
        "publish both surface maps from the pinned OpenAPI document and the measured route inventory;\n" +
        "no network call and no credential",
      load: async () => (await import("../../cli/commands/airtableAtlas/syncRun.js")).airtableAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/airtableAtlas/resetRun.js")).airtableAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
