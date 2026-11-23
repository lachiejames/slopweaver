/**
 * The pure half of `codex plugin-sync`: which marketplace entry is Slopweaver's, what commit a tree carries,
 * whether the Codex install is behind, and the one line every run prints.
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

/** What one run ended up doing, ready to render as its single line. */
export type SyncOutcome =
  /** Nothing to do here: no Codex install to keep, or not a checkout that may publish one. */
  | { readonly did: "skipped"; readonly why: string }
  /** Looked, and the Codex install already carries HEAD. */
  | { readonly did: "current"; readonly why: string }
  /** Exported, re-added, and read the stamp back from the tree Codex installed. */
  | { readonly did: "refreshed"; readonly why: string; readonly installedPath: string }
  /** Another run holds the lock; it will leave the install on a commit at least as new. */
  | { readonly did: "busy"; readonly why: string }
  /** Handed to a background run; its line lands in the log. */
  | { readonly did: "backgrounded"; readonly why: string; readonly log: string }
  /** Tried and failed; the Codex install is NOT on HEAD. */
  | { readonly did: "failed"; readonly error: CodexPluginSyncError };

/**
 * Render one run as the ONE line it always prints — "did not look" and "looked, and it was fine" differ.
 *
 * @param outcome what the run did
 * @returns the line, prefixed so a hook's output names its source
 */
export function renderSyncOutcome({ outcome }: { outcome: SyncOutcome }): string {
  const prefix = "codex plugin-sync:";
  if (outcome.did === "failed") {
    return `${prefix} FAILED [${outcome.error.code}] — ${outcome.error.message}`;
  }
  if (outcome.did === "refreshed") {
    return `${prefix} refreshed — ${outcome.why}; installed at ${outcome.installedPath}`;
  }
  if (outcome.did === "backgrounded") {
    return `${prefix} refreshing in the background — ${outcome.why}; log ${outcome.log}`;
  }
  return `${prefix} ${outcome.did} — ${outcome.why}`;
}

/**
 * What the LAST background run left in its log, when that was a failure — so the next run's foreground line,
 * which a landing session reads in its hook output, says so. The background run writes exactly one outcome
 * line, atomically, and records a throw as a `CRASHED` failure, so the log's last outcome line is the whole
 * story.
 *
 * @param log the whole of the previous background run's log
 * @returns one line naming the failure, or undefined when the last run succeeded or wrote nothing yet
 */
export function lastBackgroundFailure({ log }: { log: string }): string | undefined {
  const prefix = "codex plugin-sync: ";
  const last = log.split("\n").findLast((line) => line.startsWith(prefix));
  if (last === undefined || !last.startsWith(`${prefix}FAILED`)) {
    return undefined;
  }
  return `the last background run ${last.slice(prefix.length)}`;
}
