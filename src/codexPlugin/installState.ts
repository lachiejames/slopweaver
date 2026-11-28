/**
 * Whether one Codex home carries a Slopweaver install, and on which commit — read from the source stamp the
 * export writes and Codex copies into `$CODEX_HOME/plugins/cache/<marketplace>/slopweaver/local`.
 *
 * The stamp is what `codex plugin-sync` reads to decide a home is due, and what marks a home as INSTALLED for
 * the post-merge hook, which updates an installed home but never makes a first install. A spawn's preflight
 * reads the same answer about the home a seat is about to boot on.
 *
 * **Only a lookup that says the stamp is not there reads as absent.** `ENOENT` and `ENOTDIR` do; any other lookup
 * failure — a directory on the path that cannot be searched (`EACCES`), a path that does not resolve (`ELOOP`) —
 * reads as unreadable, because nothing established that no install is there. A stamp the lookup FOUND and then
 * could not read or parse is invalid.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";

import { CODEX_PLUGIN_NAME, CODEX_UNVERSIONED_CACHE_KEY, SOURCE_STAMP_RELATIVE, stampCommitOf } from "./plan.js";

/** What one home's install stamp says. */
export type PluginInstallState =
  /** No stamp: nothing installed here, or a tree that predates stamping. */
  | { readonly kind: "absent"; readonly stampPath: string }
  | { readonly kind: "installed"; readonly commit: string; readonly stampPath: string }
  /** A stamp file that is not a stamp — corruption, named apart from an absence. */
  | { readonly kind: "invalid"; readonly stampPath: string; readonly why: string }
  /** A stamp path whose lookup failed for a reason other than the stamp not being there. */
  | { readonly kind: "unreadable"; readonly stampPath: string; readonly why: string };

/** The lookup errors that establish nothing is at the path: it, or a directory above it, is not there. */
const ABSENT_LOOKUP_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

/**
 * The directory Codex installs Slopweaver into for one home and marketplace.
 *
 * @param codexHome the `$CODEX_HOME` the install belongs to
 * @param marketplace the marketplace the plugin was added from
 * @returns the cache directory, whether or not it exists
 */
export function pluginCacheDir({ codexHome, marketplace }: { codexHome: string; marketplace: string }): string {
  return join(codexHome, "plugins", "cache", marketplace, CODEX_PLUGIN_NAME, CODEX_UNVERSIONED_CACHE_KEY);
}

/**
 * Read one home's install stamp.
 *
 * @param codexHome the `$CODEX_HOME` to read
 * @param marketplace the marketplace the plugin is added from
 * @returns absent, installed on a commit, a stamp that is not a stamp, or a lookup that could not decide
 */
export function pluginInstallState({
  codexHome,
  marketplace,
}: {
  codexHome: string;
  marketplace: string;
}): PluginInstallState {
  const stampPath = join(pluginCacheDir({ codexHome, marketplace }), SOURCE_STAMP_RELATIVE);
  try {
    statSync(stampPath);
  } catch (error: unknown) {
    const code = isRecord(error) ? error["code"] : undefined;
    if (typeof code === "string" && ABSENT_LOOKUP_CODES.has(code)) {
      return { kind: "absent", stampPath };
    }
    return { kind: "unreadable", stampPath, why: errorMessage({ error }) };
  }
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(stampPath, "utf8"));
  } catch (error: unknown) {
    return { kind: "invalid", stampPath, why: errorMessage({ error }) };
  }
  const commit = stampCommitOf({ document });
  if (commit === undefined) {
    return { kind: "invalid", stampPath, why: "it names no full commit" };
  }
  return { commit, kind: "installed", stampPath };
}
