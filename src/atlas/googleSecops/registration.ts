/**
 * The Google SecOps atlas's registration: its descriptor, its store, and the verbs it answers beyond the
 * kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. `connect` is this door's own: the
 * consent round trip for `chronicle.readonly`, through the THIRD Google OAuth client. `reset` is the kit's,
 * reached through `readReset` rather than a verb of its own.
 *
 * Only `import type` sits at the top: every module behind a verb or a reader loads inside its own thunk, so
 * registering this platform costs an unrelated invocation nothing.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The google-secops row of the registry. */
export const GOOGLE_SECOPS_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `connect` reaches Google — the shared consent flow, writing an owner-only grant under
    // $SLOPWEAVER_HOME — and reads nothing from the SecOps instance itself. No Slack/GitHub/Linear/Vanta
    // write, no browser of its own: local-state, exactly as Google Admin's `connect` is.
    doorRouted: false,
    example: "slopweaver atlas google-secops connect --status",
    summary:
      "The Google Security Operations (Chronicle) atlas, READ-ONLY forever by the owner's ruling: what the " +
      "instance is configured to detect and ingest — rules, reference lists, data tables, watchlists, feeds, " +
      "dashboards and data-access controls — over a GET-only, host-pinned door. `connect` authorises this " +
      "install for `chronicle.readonly` and nothing wider, through a Google OAuth client of its own; " +
      "`fill` reads the instance under that grant and publishes; " +
      "`coverage` says the API surface's 39-GET denominator and how much of it has been called",
  },
  platform: "google-secops",
  readDescriptor: async () => (await import("./descriptor.js")).GOOGLE_SECOPS_ATLAS_DESCRIPTOR,
  readReset: async () => {
    const { atlasResetFor } = await import("../kit/reset.js");
    const { emptyGoogleSecopsKindFiles, initialGoogleSecopsManifest } = await import("./model.js");
    const { GOOGLE_SECOPS_STORE_SPEC, googleSecopsAtlasPaths } = await import("./store.js");
    return atlasResetFor({
      emptyFiles: emptyGoogleSecopsKindFiles,
      emptyManifest: initialGoogleSecopsManifest,
      paths: googleSecopsAtlasPaths,
      spec: GOOGLE_SECOPS_STORE_SPEC,
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readGoogleSecopsSnapshot(args),
  verbs: [
    {
      describe: "authorise this install to READ SecOps — chronicle.readonly only, its own client, browser consent",
      load: async () =>
        (await import("../../cli/commands/atlas/googleSecops/connectRun.js")).googleSecopsConnectCommand,
      usage: ["connect [--status] [--revoke] [--json] [--home <dir>]"],
      verb: "connect",
    },
    {
      describe: "read the instance under the grant — six GET lists, allowlisted fields only — and publish",
      load: async () => (await import("../../cli/commands/atlas/googleSecops/fillRun.js")).googleSecopsFillCommand,
      usage: ["fill [--json] [--home <dir>]"],
      verb: "fill",
    },
  ],
};
