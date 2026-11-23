/**
 * The KnowBe4 atlas's registration: its descriptor, its store, and the one verb it answers beyond the kit's.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. `sync` is this door's own: eleven GET
 * paths of the Reporting API under the owner's own token. `reset` is the kit's, reached through `readReset`
 * rather than a verb of its own.
 *
 * Only `import type` sits at the top: every module behind a verb or a reader loads inside its own thunk, so
 * registering this platform costs an unrelated invocation nothing.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The knowbe4 row of the registry. */
export const KNOWBE4_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reaches KnowBe4's Reporting API with GETs only and writes nothing but this atlas's own store under
    // $SLOPWEAVER_HOME. No Slack/GitHub/Linear/Vanta write, no browser: local-state, as SecOps' `fill` is.
    doorRouted: false,
    example: "slopweaver atlas knowbe4 sync",
    summary:
      "The KnowBe4 security-awareness atlas, READ-ONLY: who is in the account, their groups, which training " +
      "campaigns enrol which groups, each person's enrolment and completion status, and each person's result " +
      "on each phishing test — over a GET-only door pinned to us.api.knowbe4.com. `sync` reads the Reporting " +
      "API under the token the owner stores in $SLOPWEAVER_HOME/secrets/knowbe4-api-token and publishes; " +
      "`coverage` says the API surface's 24-GET denominator and how much of it is called",
  },
  platform: "knowbe4",
  readDescriptor: async () => (await import("./descriptor.js")).KNOWBE4_ATLAS_DESCRIPTOR,
  readReset: async () => {
    const { atlasResetFor } = await import("../kit/reset.js");
    const { emptyKnowbe4KindFiles, initialKnowbe4Manifest } = await import("./model.js");
    const { KNOWBE4_STORE_SPEC, knowbe4AtlasPaths } = await import("./store.js");
    return atlasResetFor({
      emptyFiles: emptyKnowbe4KindFiles,
      emptyManifest: initialKnowbe4Manifest,
      paths: knowbe4AtlasPaths,
      spec: KNOWBE4_STORE_SPEC,
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readKnowbe4Snapshot(args),
  verbs: [
    {
      describe:
        "read the account under the stored Reporting API token — eleven GET paths, allowlisted fields only — and publish",
      load: async () => (await import("../../cli/commands/atlas/knowbe4/syncRun.js")).knowbe4SyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
  ],
};
