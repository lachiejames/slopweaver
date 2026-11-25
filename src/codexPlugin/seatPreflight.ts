/**
 * `cmux spawn`'s check that a Codex seat's routed home carries Slopweaver before anything is provisioned.
 *
 * **Only a MISSING install refuses.** An install behind HEAD boots: the post-merge hook refreshes an installed
 * home on every landing, and refusing a stale one would block every seat for the minutes after each landing.
 * A present stamp that does not parse boots too, because the cache tree it sits in is there; repairing it is
 * `codex plugin-sync`'s business. So this never resolves HEAD and never compares commits.
 *
 * The check reads the home itself and never the personal marketplace file: every marketplace directory under
 * `$CODEX_HOME/plugins/cache` is searched for a Slopweaver stamp, so a marketplace file that is missing or will
 * not parse cannot refuse a home that is installed. A cache that exists and cannot be listed is the one other
 * refusal, because Codex cannot load an install out of it either.
 *
 * There is no hatch: a seat booted on a home with no install is the silent failure this check exists to end.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type PluginInstallState, pluginCacheDir, pluginInstallState } from "./installState.js";
import { SOURCE_STAMP_RELATIVE } from "./plan.js";
import { type CodexPluginSeatError, CodexPluginSeatErrors } from "./seatErrors.js";

/**
 * Whether one home's install states admit a seat: any state but an absent stamp does, so a home with one
 * installed or unreadable stamp in any marketplace directory boots.
 *
 * @param codexHome the home the seat was routed to, named in the refusal
 * @param states what each marketplace directory's install stamp says, empty when the cache holds none
 * @returns nothing when the seat may boot, else the missing-install refusal
 */
export function admitCodexPluginSeat({
  codexHome,
  states,
}: {
  codexHome: string;
  states: readonly PluginInstallState[];
}): Result<void, CodexPluginSeatError> {
  if (states.some((state) => state.kind !== "absent")) {
    return ok(undefined);
  }
  const stampPath = join(pluginCacheDir({ codexHome, marketplace: "*" }), SOURCE_STAMP_RELATIVE);
  return err(CodexPluginSeatErrors.installMissing({ codexHome, stampPath }));
}

/**
 * Read every marketplace directory in the routed home's plugin cache and decide whether the seat may boot.
 *
 * @param codexHome the `$CODEX_HOME` the seat was routed to
 * @returns nothing when the seat may boot, else why it may not
 */
export function preflightCodexPluginSeat({ codexHome }: { codexHome: string }): Result<void, CodexPluginSeatError> {
  const cacheRoot = join(codexHome, "plugins", "cache");
  let marketplaces: readonly string[];
  try {
    marketplaces = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error: unknown) {
    if (!(isRecord(error) && error["code"] === "ENOENT")) {
      return err(CodexPluginSeatErrors.cacheUnreadable({ cacheRoot, codexHome, why: errorMessage({ error }) }));
    }
    // No cache directory at all: nothing was ever installed into this home.
    marketplaces = [];
  }
  const states = marketplaces.map((marketplace) => pluginInstallState({ codexHome, marketplace }));
  return admitCodexPluginSeat({ codexHome, states });
}
