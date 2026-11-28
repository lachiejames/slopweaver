/**
 * `cmux spawn`'s check that a Codex seat's routed home carries Slopweaver before anything is provisioned.
 *
 * **Only a MISSING or UNSEARCHABLE install refuses**, each under its own name: a stamp lookup that failed for a
 * reason other than the stamp not being there (`./installState.ts`) is refused as unreadable, never as missing,
 * so whoever repairs it is told what is actually wrong. An install behind HEAD boots: the post-merge hook
 * refreshes an installed home on every landing, and refusing a stale one would block every seat for the minutes
 * after each landing. A present stamp that does not parse boots too, because the cache tree it sits in is there;
 * repairing it is `codex plugin-sync`'s business. So this never resolves HEAD and never compares commits.
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
 * Whether one state admits a seat on its own: an installed or an invalid stamp does; an absent one or a lookup
 * that could not decide does not.
 *
 * @param state what one marketplace directory's install stamp says
 * @returns whether that stamp alone lets the seat boot
 */
function admitsSeat({ state }: { state: PluginInstallState }): boolean {
  switch (state.kind) {
    case "installed":
    case "invalid":
      return true;
    case "absent":
    case "unreadable":
      return false;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/**
 * Whether one home's install states admit a seat: an installed or invalid stamp in any marketplace directory
 * boots. With none, a lookup that could not decide refuses as unreadable, naming the first such path; only when
 * every stamp is absent, or there are none, does the home refuse as missing.
 *
 * @param codexHome the home the seat was routed to, named in the refusal
 * @param states what each marketplace directory's install stamp says, empty when the cache holds none
 * @returns nothing when the seat may boot, else the unreadable-install or missing-install refusal
 */
export function admitCodexPluginSeat({
  codexHome,
  states,
}: {
  codexHome: string;
  states: readonly PluginInstallState[];
}): Result<void, CodexPluginSeatError> {
  if (states.some((state) => admitsSeat({ state }))) {
    return ok(undefined);
  }
  const unreadable = states.find(
    (state): state is Extract<PluginInstallState, { kind: "unreadable" }> => state.kind === "unreadable",
  );
  if (unreadable !== undefined) {
    return err(
      CodexPluginSeatErrors.installUnreadable({ codexHome, stampPath: unreadable.stampPath, why: unreadable.why }),
    );
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
