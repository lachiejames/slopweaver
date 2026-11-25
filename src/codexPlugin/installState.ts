/**
 * Whether one Codex home carries a Slopweaver install, and on which commit — read from the source stamp the
 * export writes and Codex copies into `$CODEX_HOME/plugins/cache/<marketplace>/slopweaver/local`.
 *
 * The stamp is what `codex plugin-sync` reads to decide a home is due, and what marks a home as INSTALLED for
 * the post-merge hook, which updates an installed home but never makes a first install. A spawn's preflight
 * reads the same answer about the home a seat is about to boot on.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";

import { CODEX_PLUGIN_NAME, CODEX_UNVERSIONED_CACHE_KEY, SOURCE_STAMP_RELATIVE, stampCommitOf } from "./plan.js";

/** What one home's install stamp says. */
export type PluginInstallState =
  /** No stamp: nothing installed here, or a tree that predates stamping. */
  | { readonly kind: "absent"; readonly stampPath: string }
  | { readonly kind: "installed"; readonly commit: string; readonly stampPath: string }
  /** A stamp file that is not a stamp — corruption, named apart from an absence. */
  | { readonly kind: "invalid"; readonly stampPath: string; readonly why: string };

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
 * @returns absent, installed on a commit, or a stamp that cannot be read
 */
export function pluginInstallState({
  codexHome,
  marketplace,
}: {
  codexHome: string;
  marketplace: string;
}): PluginInstallState {
  const stampPath = join(pluginCacheDir({ codexHome, marketplace }), SOURCE_STAMP_RELATIVE);
  if (!existsSync(stampPath)) {
    return { kind: "absent", stampPath };
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
