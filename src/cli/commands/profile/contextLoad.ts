/**
 * Load the always-loaded context against this install's home — the one read `profile context` and the
 * `SessionStart` hook share.
 *
 * It sits in its own module because the hook must reach it WITHOUT reaching a flag spec. `help-flag-opt-out`
 * judges a verb's flag set readable when the loader module the manifest names, or anything it reaches by
 * relative import inside `src/cli/commands/`, calls `parseFlagTail`/`parseFlags`/`tokenizeFlags` — and the
 * remedy it prescribes, guarding the verb, is the one thing `profile hook` must not do: a guarded verb has to
 * refuse an unknown flag, and this hook has to exit zero on every path. So the hook's own loader
 * ({@link ./hookRun}) imports this and nothing that parses, and the gate reads the truth rather than an
 * exemption.
 */
import { settleOwnerMarks } from "../../../admit/ownerProfileWrite.js";
import { machineDefaultHomes } from "../../../admit/profileFirstBoot.js";
import { slopweaverHome } from "../../../config.js";
import { type LoadedContext, loadAlwaysLoadedContext } from "../../../context/load.js";
import { accountDefaultHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * Read the always-loaded block, refreshing the last-known-good cache beside it.
 *
 * @param boundMs how long the live read is allowed before the cache answers instead
 * @param home the state home whose context cache is refreshed; production resolves this install's own
 * @param nowIso the instant the read is stamped at; production samples the real clock
 * @param load the store-and-cache loader; a test passes a plain recording fake so no store is opened
 * @returns the lines, and where they came from
 */
export async function loadContextIntoCache({
  boundMs,
  home = slopweaverHome(),
  nowIso = new Date().toISOString(),
  load = loadAlwaysLoadedContext,
}: {
  boundMs: number;
  home?: string;
  nowIso?: string;
  load?: typeof loadAlwaysLoadedContext;
}): Promise<Awaited<ReturnType<typeof loadAlwaysLoadedContext>>> {
  return load({
    boundMs,
    cachePath: stateHomePaths({ home }).profileContextJson,
    nowIso,
  });
}

/**
 * {@link loadContextIntoCache}, which also takes back an owner-written mark the store it reads disproves — one a
 * `profile set` killed between its mark and its row left (`settleOwnerMarks`). Every live load does this, not only
 * `profile context`: a hook that loaded first, with the stale mark still standing, judged the machine configured and
 * recorded a `live` load of nothing, itself a trace no later reload could clear. The store
 * withdrawn is the one the live read itself answered from. With default homes that cannot be named it is the plain load.
 *
 * @param boundMs how long the live read is allowed before the cache answers instead
 * @param home the state home whose context cache is refreshed and whose mark is settled with the default homes'
 * @param nowIso the instant the read and the lock are stamped at
 * @returns the lines, and where they came from
 */
export async function loadContextSettlingMarks({
  boundMs,
  home = slopweaverHome(),
  nowIso = new Date().toISOString(),
}: {
  boundMs: number;
  home?: string;
  nowIso?: string;
}): Promise<LoadedContext> {
  const load = (): Promise<LoadedContext> => loadContextIntoCache({ boundMs, home, nowIso });
  const defaults = machineDefaultHomes();
  if (defaults.isErr()) {
    return load();
  }
  const settled = await settleOwnerMarks({
    disproved: (loaded) => loaded.ownerAbsentIn,
    homes: [home, ...defaults.value],
    load,
    lockHome: accountDefaultHome(),
    nowIso,
  });
  for (const path of settled.retracted) {
    logger.error({ msg: `profile: the store holds no owner row, so the mark claiming one is retracted: ${path}` });
  }
  for (const path of settled.kept) {
    logger.error({
      msg: `profile: the store holds no owner row, but this mark claiming one could not be removed: ${path}`,
    });
  }
  return settled.loaded;
}
