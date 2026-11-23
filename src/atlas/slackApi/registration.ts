/**
 * The Slack atlas's registration: its descriptor, its store, its reset, no own verbs, and the one FALLBACK in
 * the fleet.
 *
 * `reset` is the generation `atlas slack-drive` publishes, and `atlas slack reset --confirm archive` is the
 * remedy `atlasStore.ts` prints when it refuses one — so the command printed at the moment of failure is one
 * this row really answers. It is a kit verb rather than a `slack-drive` one because `restore`, its undo, is a
 * kit verb too: the reset prints `atlas slack restore --archive <id>`, and the two have to address the same row.
 *
 * The row's platform is `slack`, not `slack-api`, even though this module lives in `slackApi/`:
 * `kit/contract.ts` makes one PLATFORM per atlas a type, and the workspace, the Web API and the web client
 * are surfaces of one Slack atlas. Keying the registry on the directory name would put the same platform in
 * the catalogue twice, which is the exact failure that type exists to prevent.
 *
 * Slack's three rows predate the kit and stay hand-written in `cli/manifests/atlasSlack.ts`: `atlas
 * slack-api` and `atlas slack-drive` are verbs of their own, and `atlas slack` with no verb IS the map —
 * `--never-read`, `--unreadable` — which is why this row alone carries a `fallback` rather than own verbs.
 * The kit's four still dispatch through the registry exactly as they do for every other platform.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The slack row of the registry. */
export const SLACK_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // The catalogue row for `atlas slack` is the hand-written one in `cli/manifests/atlasSlack.ts`, because
    // the map's own flags are what it advertises; the generic row is never built from this entry. What is
    // here is what `atlas slack --help` for a kit verb reads.
    doorRouted: false,
    example: "slopweaver atlas slack --never-read",
    summary:
      "The Slack map: every conversation known, which ones this account can actually read, and which have " +
      "never been looked at — read from local state, no network call",
  },
  fallback: async () => (await import("../../cli/commands/atlas/slackRun.js")).atlasSlackCommand,
  platform: "slack",
  readDescriptor: async () => (await import("./descriptor.js")).SLACK_ATLAS_DESCRIPTOR,
  // The version is read by the same reader `slack-drive sync` and `refresh` use, so the empty manifest the
  // reset installs carries exactly what their next publish compares against — see `./atlasReset.ts`.
  readReset: async () => {
    const { slackAtlasResetFor } = await import("./atlasReset.js");
    const { readInstalledTypings } = await import("../../cli/commands/atlas/slackApiRun.js");
    const { atlasCommandErrorLines } = await import("../../cli/commands/atlas/errors.js");
    return slackAtlasResetFor({
      readSdkVersion: () =>
        readInstalledTypings()
          .map((source) => source.version)
          .mapErr((error) => atlasCommandErrorLines({ error })),
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readSlackApiSnapshot(args),
  verbs: [],
};
