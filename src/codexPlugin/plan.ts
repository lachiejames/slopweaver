/**
 * The pure half of `codex plugin-sync`: which marketplace entry is Slopweaver's, what commit a tree carries,
 * whether a Codex home's install is behind, and the lines every run prints — one per Codex home it looked at.
 *
 * Why the verb exists, measured on codex 0.157.1 (a throwaway `HOME` + `CODEX_HOME`): Codex copies
 * a local-marketplace plugin into `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>` ONLY on
 * `codex plugin add`, never at a session start or a `plugin list`; the copy takes the source tree whole
 * (`.git` and `node_modules` included); a symlinked cache dir reads as "not installed"; and a symlink inside
 * the source is dropped from the copy. So nothing live can stand in for the copy, and the main checkout itself
 * (worktrees, node_modules) is far too large to be the source. The route is an export of HEAD, re-added.
 */
import { resolve } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";

/** The plugin's name in every Codex marketplace, and the directory Codex caches it under. */
export const CODEX_PLUGIN_NAME = "slopweaver";

/**
 * The cache key Codex uses for a plugin whose manifest carries no `version`. `.codex-plugin/plugin.json`
 * carries none, so every refresh replaces the same directory in place, and a RUNNING Codex session's
 * `…/local/bin/slopweaver` keeps resolving — a per-commit version made Codex delete the previous directory on
 * each add, measured on the same probe.
 */
export const CODEX_UNVERSIONED_CACHE_KEY = "local";

/**
 * Where the personal Codex marketplace lives, relative to the user's home — fixed by Codex. Read by the sync and
 * by `github repoint-plan`, which reports whether its local source sits inside a re-cut checkout.
 */
export const PERSONAL_MARKETPLACE_RELATIVE = ".agents/plugins/marketplace.json";

/** Where the export records the commit it was cut from, relative to the plugin root. */
export const SOURCE_STAMP_RELATIVE = ".codex-plugin/source.json";

const marketplaceSchema = z.object({
  name: z.string().min(1),
  plugins: z.array(
    z.object({
      name: z.string(),
      source: z.object({ path: z.string().optional(), source: z.string() }),
    }),
  ),
});

/** Where Slopweaver's entry in the personal Codex marketplace says its source lives, or why there is none. */
export type MarketplaceEntry =
  | { readonly kind: "found"; readonly marketplace: string; readonly sourcePath: string }
  | { readonly kind: "absent"; readonly why: string };

/**
 * Find Slopweaver's LOCAL entry in a parsed personal marketplace document.
 *
 * The personal marketplace lives at `$HOME/.agents/plugins/marketplace.json` and Codex reports its root as
 * `$HOME` (`codex plugin marketplace list`), so a relative `path` resolves against `home`.
 *
 * @param document the parsed marketplace JSON
 * @param home the directory Codex treats as this marketplace's root
 * @param path the file it came from, for the error
 * @returns the entry, an absence with its reason, or why the document could not be read
 */
export function marketplaceEntryOf({
  document,
  home,
  path,
}: {
  document: unknown;
  home: string;
  path: string;
}): Result<MarketplaceEntry, CodexPluginSyncError> {
  const parsed = marketplaceSchema.safeParse(document);
  if (!parsed.success) {
    return err(CodexPluginSyncErrors.marketplaceUnreadable({ detail: parsed.error.issues[0]!.message, path }));
  }
  const entry = parsed.data.plugins.find((plugin) => plugin.name === CODEX_PLUGIN_NAME);
  if (entry === undefined) {
    return ok({ kind: "absent", why: `marketplace ${parsed.data.name} lists no ${CODEX_PLUGIN_NAME} plugin` });
  }
  if (entry.source.source !== "local" || entry.source.path === undefined) {
    return ok({
      kind: "absent",
      why: `marketplace ${parsed.data.name}'s ${CODEX_PLUGIN_NAME} is a ${entry.source.source} source, not a local path`,
    });
  }
  return ok({ kind: "found", marketplace: parsed.data.name, sourcePath: resolve(home, entry.source.path) });
}

const stampSchema = z.object({ commit: z.string().regex(/^[0-9a-f]{40}$/u) });

/**
 * The commit a source stamp names, or undefined when the document is not a stamp.
 *
 * @param document the parsed `.codex-plugin/source.json`, or undefined when the file is absent
 * @returns the full commit SHA the tree was exported from
 */
export function stampCommitOf({ document }: { document: unknown }): string | undefined {
  const parsed = stampSchema.safeParse(document);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data.commit;
}

/** Whether the Codex install has to be refreshed, and the sentence that says why either way. */
export interface SyncDecision {
  readonly refresh: boolean;
  readonly why: string;
}

/**
 * Decide from three commits whether to export and re-add.
 *
 * BOTH stamps have to match: an export that is current while the cache is not is a run that died between
 * the export and the add, and the add is what a Codex session actually reads.
 *
 * @param head the commit the checkout is on
 * @param exported the commit the export directory was cut from, if it has one
 * @param installed the commit the Codex cache holds, if it has one
 * @returns whether to refresh, and why
 */
export function syncDecision({
  head,
  exported,
  installed,
}: {
  head: string;
  exported: string | undefined;
  installed: string | undefined;
}): SyncDecision {
  const short = head.slice(0, 12);
  if (installed === head && exported === head) {
    return { refresh: false, why: `the Codex install is already ${short}` };
  }
  if (installed === undefined) {
    return { refresh: true, why: `the Codex install carries no source stamp; HEAD is ${short}` };
  }
  return { refresh: true, why: `the Codex install is ${installed.slice(0, 12)}; HEAD is ${short}` };
}

/** The command that makes a FIRST install, which the post-merge hook never does — printed wherever it stood down. */
export const FOREGROUND_SYNC_COMMAND = "slopweaver codex plugin-sync";

/** What one Codex home ended up as. */
export type HomeSyncOutcome =
  /** Already on HEAD; `trusted` is the hooks a foreground re-check trusted, undefined when none ran. */
  | { readonly codexHome: string; readonly did: "current"; readonly why: string; readonly trusted: number | undefined }
  /** Re-added, the stamp read back from the tree Codex installed, and every hook trusted. */
  | {
      readonly codexHome: string;
      readonly did: "refreshed";
      readonly why: string;
      readonly installedPath: string;
      readonly trusted: number;
    }
  /** Not written, by design: no home here, or the hook's scope never makes a first install. */
  | { readonly codexHome: string; readonly did: "untouched"; readonly why: string }
  /** Tried and failed; this home is NOT on HEAD, or not all its hooks run. */
  | { readonly codexHome: string; readonly did: "failed"; readonly error: CodexPluginSyncError };

/** What one run ended up doing, across the fleet. */
export type SyncOutcome =
  /** Nothing to do here: not a checkout that may publish, or no marketplace entry this scope may use. */
  | { readonly did: "skipped"; readonly why: string }
  /** Another run holds the lock; it will leave every home on a commit at least as new. */
  | { readonly did: "busy"; readonly why: string }
  /** Handed to a background run; its lines land in the log. */
  | { readonly did: "backgrounded"; readonly why: string; readonly log: string }
  /** Failed before any home was touched — the register, the marketplace, the export or the lock. */
  | { readonly did: "failed"; readonly error: CodexPluginSyncError }
  /** Looked at every home: one outcome each, in order. */
  | { readonly did: "synced"; readonly homes: readonly HomeSyncOutcome[] };

const LINE_PREFIX = "codex plugin-sync:";

/** One home's line — "did not look" and "looked, and it was fine" differ, and the home is always named. */
function renderHomeOutcome({ outcome }: { outcome: HomeSyncOutcome }): string {
  const lead = `${LINE_PREFIX} ${outcome.codexHome}`;
  if (outcome.did === "failed") {
    return `${lead} FAILED [${outcome.error.code}] — ${outcome.error.message}`;
  }
  if (outcome.did === "refreshed") {
    return `${lead} refreshed — ${outcome.why}; installed at ${outcome.installedPath}; trusted ${String(outcome.trusted)} hook(s)`;
  }
  if (outcome.did === "current" && outcome.trusted !== undefined) {
    return `${lead} current — ${outcome.why}; trusted ${String(outcome.trusted)} hook(s)`;
  }
  return `${lead} ${outcome.did} — ${outcome.why}`;
}

/**
 * Render one run as its lines: one per home when it looked at the fleet, one otherwise.
 *
 * @param outcome what the run did
 * @returns the lines, each prefixed so a hook's output names its source
 */
export function renderSyncOutcome({ outcome }: { outcome: SyncOutcome }): readonly string[] {
  if (outcome.did === "synced") {
    return outcome.homes.map((home) => renderHomeOutcome({ outcome: home }));
  }
  if (outcome.did === "failed") {
    return [`${LINE_PREFIX} FAILED [${outcome.error.code}] — ${outcome.error.message}`];
  }
  if (outcome.did === "backgrounded") {
    return [`${LINE_PREFIX} refreshing in the background — ${outcome.why}; log ${outcome.log}`];
  }
  return [`${LINE_PREFIX} ${outcome.did} — ${outcome.why}`];
}

/**
 * Whether a run failed anywhere — before any home, or at any one of them.
 *
 * @param outcome what the run did
 * @returns true when the verb must exit non-zero
 */
export function syncFailed({ outcome }: { outcome: SyncOutcome }): boolean {
  if (outcome.did === "failed") {
    return true;
  }
  return outcome.did === "synced" && outcome.homes.some((home) => home.did === "failed");
}

/**
 * Every failure the LAST background run left in its log — so the next run's foreground output, which a landing
 * session reads in its hook output, says so. The background run writes all its lines at once, atomically, one
 * per home, and records a throw as a `CRASHED` failure, so the log is the whole of one run; a home that failed
 * is reported even when a later home succeeded.
 *
 * @param log the whole of the previous background run's log
 * @returns one line per failure, empty when the last run failed nowhere or wrote nothing yet
 */
export function backgroundFailures({ log }: { log: string }): readonly string[] {
  const prefix = `${LINE_PREFIX} `;
  return log
    .split("\n")
    .filter((line) => line.startsWith(prefix) && line.includes("FAILED ["))
    .map((line) => `the last background run: ${line.slice(prefix.length)}`);
}
