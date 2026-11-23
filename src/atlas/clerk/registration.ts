/**
 * The Clerk atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These five do: `sync` compiles the
 * four pinned Clerk documents, `walk` fills the dashboard surface in the owner's own Chrome, `refresh` runs
 * both — which is what makes the descriptor's one-command resync claim true — `report` prints the
 * corroboration between the two, and `reset` archives a generation.
 *
 * They sit under `atlas clerk` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The clerk row of the registry. */
export const CLERK_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reads four public, commit-addressed Clerk documents and caches them under $SLOPWEAVER_HOME;
    // `walk` drives the owner's own Chrome. Neither reaches a Clerk account and neither writes anything
    // outside the local atlas, so this is local-state rather than external-write, and it opens no browser
    // of its own (docs/browser-route.md).
    doorRouted: true,
    example: "slopweaver atlas clerk read --kind operation --query instance",
    summary:
      "The Clerk SURFACE MAP: `read` its stored operations, webhook events and dashboard pages, or " +
      "`coverage` for what it knows it does NOT know, plus `sync` to compile the four pinned Clerk " +
      "documents, `walk` to fill the dashboard surface in your own Chrome, `refresh` to run both, " +
      "`report` for where the two surfaces disagree, and `reset` to archive a generation. End-user rows " +
      "are mapped and never held",
    kitDescriptions: {
      read: "the stored operations, webhook events and dashboard pages, filtered by kind, surface, id or query",
    },
  },
  platform: "clerk",
  readDescriptor: async () => (await import("./descriptor.js")).CLERK_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readClerkSnapshot(args),
  verbs: [
    {
      describe: "compile the four pinned Clerk documents; no credential, and no network call once cached",
      load: async () => (await import("../../cli/commands/clerkAtlas/syncRun.js")).clerkAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe:
        "fill the DASHBOARD surface by walking every declared page in your own Chrome, photographing each;\n" +
        "--root /apps/<application>/instances/<instance> seeds the instance root when no probe can find one",
      load: async () => (await import("../../cli/commands/clerkAtlas/walkRun.js")).clerkAtlasWalkCommand,
      usage: ["walk [--root /apps/<application>/instances/<instance>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "sync then walk — the one command that brings both surfaces current",
      load: async () => (await import("../../cli/commands/clerkAtlas/refreshRun.js")).clerkAtlasRefreshCommand,
      usage: ["refresh [--json] [--home <dir>]"],
      verb: "refresh",
    },
    {
      describe: "where the two surfaces disagree, which is an output rather than a build-time check",
      load: async () => (await import("../../cli/commands/clerkAtlas/reportRun.js")).clerkAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () => (await import("../../cli/commands/clerkAtlas/resetRun.js")).clerkAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
