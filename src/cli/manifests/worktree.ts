/**
 * Lazy manifest for the `worktree` noun — the one door for creating, inspecting and retiring a git worktree
 * of a main checkout, with its dependencies installed as part of creation rather than as a thing to remember.
 *
 * `effect: "local-state"` on `create` and `remove`: they write a directory inside the caller's own checkout
 * and run a local `yarn install`, exactly like `checkout sync`. Neither touches Slack, GitHub or Linear, so
 * neither is the admit door's concern. `list` and `status` read git and stat a lockfile and are
 * `diagnostic: true` for the same reason `checkout status` is — a non-zero exit REPORTS a worktree that is
 * missing or wrongly installed, which is a finding, not a broken tool.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/**
 * Shared metadata: nothing here reaches a provider, and every verb's flag-parse reject is I/O-free. `dryParseSafe`
 * is per verb, because only `create` refuses a bare run before it reads or writes anything.
 */
const sharedMeta = {
  createsWorkItem: false,
  doorRouted: false,
  parseRejectIsIoFree: true,
} as const;

/** The `worktree` noun's verbs as lazy manifest entries. */
export const worktreeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  prune: lazy({
    load: () => import("../commands/worktree/pruneRun.js").then((m) => m.worktreePruneCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // Every flag is optional: a bare `runWorktreePrune` reads the live registers and scans every declared checkout (`--apply` removes).
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver worktree prune --older-than 24h",
      summary:
        "Plan — and with --apply, carry out — the removal of worktrees that are clean, unreferenced, fully backed up and cold",
      usage:
        "usage: slopweaver worktree prune [--apply] [--budget <value>] [--if-idle] [--json] [--merged-only] " +
        "[--no-salvage] [--nuke-after <value>] [--older-than <value>] [--repo <value>] [--scan-budget <value>]",
    },
  }),
  "mirror-prune": lazy({
    load: () => import("../commands/worktree/mirrorPruneRun.js").then((m) => m.worktreeMirrorPruneCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // Every flag is optional: a bare `runWorktreeMirrorPrune` reads the live registers and plans over the plugin mirrors (`--apply` frees).
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver worktree mirror-prune --apply --budget 60m",
      summary:
        "Plan — and with --apply, free — the plugin hook mirrors of worktrees that are gone and that no live session stands in",
      usage: "usage: slopweaver worktree mirror-prune [--apply] [--budget <value>] [--json]",
    },
  }),
  create: lazy({
    load: () => import("../commands/worktree/createRun.js").then((m) => m.worktreeCreateCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // `runWorktreeCreate` refuses a missing slug and an unknown flag before it resolves the repository or provisions anything.
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver worktree create my-branch --base origin/main",
      summary: "Create (or reuse) a worktree and install its OWN dependencies — never a shared node_modules",
      usage:
        "usage: slopweaver worktree create <slug> [--base <value>] [--branch <value>] [--build] " +
        "[--deps <value>] [--dev-build] [--install] [--json] [--no-build] [--no-dev-build] " +
        "[--no-install] [--repo <value>]",
    },
  }),
  list: lazy({
    load: () => import("../commands/worktree/inventoryRun.js").then((m) => m.worktreeListCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      // Every flag is optional: a bare `runWorktreeList` runs git and prints every worktree.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver worktree list --json",
      summary: "Every worktree of a main checkout, with the branch each one holds",
      usage: "usage: slopweaver worktree list [--json] [--repo <value>]",
    },
  }),
  remove: lazy({
    load: () => import("../commands/worktree/inventoryRun.js").then((m) => m.worktreeRemoveCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // `resolve` in inventoryRun.ts spawns git for the repository root BEFORE `runWorktreeRemove` checks the slug,
      // so a bare run is not a dry parse and the missing-slug reject is not I/O-free (an unknown flag still is).
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver worktree remove my-branch --force",
      parseRejectIsIoFree: false,
      summary: "Retire one worktree and its directory, leaving git's own dirty-tree refusal in place",
      usage: "usage: slopweaver worktree remove <slug> [--force] [--json] [--repo <value>]",
    },
  }),
  noindex: lazy({
    load: () => import("../commands/worktree/noindexRun.js").then((m) => m.worktreeNoindexCommand),
    meta: {
      ...sharedMeta,
      diagnostic: false,
      // Every flag is optional: a bare `runWorktreeNoindex` resolves the checkout and has `ensureNoindexWorktreesDir` rename or create the directory.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver worktree noindex --repo ~/dev/some-checkout",
      summary:
        "Make the worktrees directory one Spotlight never indexes — a `.noindex` directory behind the `worktrees` alias",
      usage: "usage: slopweaver worktree noindex [--json] [--repo <value>]",
    },
  }),
  here: lazy({
    load: () => import("../commands/worktree/hereRun.js").then((m) => m.worktreeHereCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      // Its only flag is `--json`: a bare `runWorktreeHere` reads git and the declared checkouts and reports where it stands.
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver worktree here",
      summary: "Where THIS session is standing — its own worktree, or a main checkout nothing may be written in",
      usage: "usage: slopweaver worktree here [--json]",
    },
  }),
  unshare: lazy({
    load: () => import("../commands/worktree/unshareRun.js").then((m) => m.worktreeUnshareCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      // Without `--report` a bare `runWorktreeUnshare` ACTS: it relinks the checkout's native binaries under the deps lock.
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver worktree unshare --all",
      summary:
        "Take a checkout's native binaries off the inode yarn shares with every other checkout — one in-place write there condemns them all",
      usage: "usage: slopweaver worktree unshare [--all] [--json] [--repo <value>] [--report]",
    },
  }),
  status: lazy({
    load: () => import("../commands/worktree/inventoryRun.js").then((m) => m.worktreeStatusCommand),
    meta: {
      ...sharedMeta,
      diagnostic: true,
      // `resolve` in inventoryRun.ts spawns git for the repository root BEFORE `runWorktreeStatus` checks the slug,
      // so a bare run is not a dry parse and the missing-slug reject is not I/O-free (an unknown flag still is).
      dryParseSafe: false,
      effect: "external-read",
      example: "slopweaver worktree status my-branch",
      parseRejectIsIoFree: false,
      summary: "One worktree's branch, drift from its base, and whether node_modules matches its own lockfile",
      usage: "usage: slopweaver worktree status <slug> [--base <value>] [--json] [--repo <value>]",
    },
  }),
};
