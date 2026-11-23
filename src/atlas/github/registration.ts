/**
 * The GitHub atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These four do: `sync` reads the
 * configuration surface through the closed inventory, `walk` fills the browser surface from the owner's own
 * Chrome, `reset` archives a generation, and `report` prints where the surfaces disagree.
 *
 * They sit under `atlas github` rather than a noun of their own. A platform is addressed, not passed, and
 * one platform must appear in the catalogue exactly once — a second top-level spelling would put GitHub in
 * it twice, which is the failure `kit/contract.ts` makes one-platform-per-atlas a type to prevent. It also
 * keeps this noun clearly separate from `slopweaver github`, which is the DOOR for reading and writing
 * GitHub objects; the atlas only ever reads, and only ever configuration.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The github row of the registry. */
export const GITHUB_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // GitHub answers four verbs of its own beyond the two every platform has, so its row cannot take the
    // generic summary and usage without under-advertising what it does.
    // `sync` and `walk` read GitHub and write only the local atlas under $SLOPWEAVER_HOME — no GitHub
    // write of any kind, so this is local-state rather than external-write, exactly like `vanta sync`.
    // The walk drives the owner's real Chrome through the Playwright relay and clicks nothing.
    doorRouted: false,
    example: "slopweaver atlas github read --kind organization-settings --json",
    summary:
      "The GitHub atlas — the SURFACE MAP, not the entities the corpus holds: `read` its stored " +
      "settings, operations and admin pages or `coverage` for what it knows it does NOT know, plus " +
      "`sync` to read every organisation and repository setting through a closed read-only inventory, " +
      "`walk` to photograph the admin pages in your own Chrome, `report` for where the surfaces " +
      "disagree, and `reset` to archive a generation",
  },
  platform: "github",
  readDescriptor: async () => (await import("./descriptor.js")).GITHUB_ATLAS_DESCRIPTOR,
  readReset: async () => {
    const { atlasResetFor } = await import("../kit/reset.js");
    const { emptyGithubKindFiles, initialGithubManifest } = await import("./kindFiles.js");
    const { GITHUB_STORE_SPEC, githubAtlasPaths } = await import("./store.js");
    return atlasResetFor({
      emptyFiles: emptyGithubKindFiles,
      emptyManifest: initialGithubManifest,
      paths: githubAtlasPaths,
      spec: GITHUB_STORE_SPEC,
    });
  },
  readSnapshot: async (args) => (await import("./readAdapter.js")).readGithubSnapshot(args),
  verbs: [
    {
      describe: "read the configuration surface through the closed inventory and publish a generation",
      load: async () => (await import("../../cli/commands/githubAtlas/syncRun.js")).githubAtlasSyncCommand,
      usage: ["sync [--orgs <login,...>] [--repos <owner/repo,...>] [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "fill the BROWSER surface by walking GitHub's admin pages in your own Chrome",
      load: async () => (await import("../../cli/commands/githubAtlas/walkRun.js")).githubAtlasWalkCommand,
      usage: ["walk [--orgs <login,...>] [--repos <owner/repo,...>] [--rounds <n>] [--json] [--home <dir>]"],
      verb: "walk",
    },
    {
      describe: "where the surfaces disagree — it resolves none of them",
      load: async () => (await import("../../cli/commands/githubAtlas/reportRun.js")).githubAtlasReportCommand,
      usage: ["report [--json] [--home <dir>]"],
      verb: "report",
    },
  ],
};
