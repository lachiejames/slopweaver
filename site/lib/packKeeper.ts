/**
 * Keeps the console voice's context pack fresh from the console server itself, so a call carries it whether or not a
 * supervisor sweep ran lately.
 *
 * `talk offer` leaves out a pack older than an hour (`src/talk/storedPack.ts`'s `PACK_MAX_AGE_MINUTES`). Without the
 * keeper the only writer is the chair's sweep, so a pack built hours earlier stays the stored one. MEASURED: a pack was still the stored one
 * 2h28m after it was built, so the two calls minted in that time both rode with no pack, and across 62 calls no first
 * delegated step carried more than 30.1k input tokens, the no-pack baseline. Repro:
 * `jq -r .builtIso ~/.slopweaver/talk/pack.json`.
 *
 * Every {@link PACK_KEEPER_TICK_MS} it runs `talk pack --write --if-older-than` {@link PACK_KEEPER_REFRESH_MINUTES},
 * half the mint's bound, so a mint finds a pack at most about forty minutes old. The verb decides freshness, so this
 * never parses the pack, and a fresh one costs a stat and a read. A rebuild measured 18.9s wall, 5.3s CPU.
 *
 * One run at a time, and one timer per server process: the state hangs off `globalThis` under a symbol, as
 * `talkCallRegistry.ts`'s does, so a `next dev` recompile finds the running timer instead of starting a second. The
 * timer is `unref`'d, so it never holds the server open. The sweep's refresh can race it; `talk pack --write` writes
 * atomically, so two writers leave one whole file and the later one wins.
 *
 * Rule 2 is untouched: the verb runs no model. A run that fails throws nothing into a route; the next mint names the
 * stale pack as `leftOut` with its age, exactly as before.
 */
import { spawnVerb } from "./spawnVerb";

/** How often the keeper asks the verb whether the pack is due. */
export const PACK_KEEPER_TICK_MS = 10 * 60_000;

/** The age past which the keeper rebuilds: half the mint's 60-minute bound. */
export const PACK_KEEPER_REFRESH_MINUTES = 30;

/** How long one run may take; a rebuild measured 18.9s, and the board scan inside it is bounded at 60s. */
const PACK_KEEPER_TIMEOUT_MS = 120_000;

/** The process-global state. */
interface KeeperState {
  timer: ReturnType<typeof setInterval> | undefined;
  inFlight: boolean;
}

const KEY = Symbol.for("slopweaver.talk.packKeeper");

/**
 * The argv one keeper run spawns.
 *
 * @returns the verb's arguments after `slopweaver`
 */
export function packKeeperArgv(): readonly string[] {
  return ["talk", "pack", "--write", "--if-older-than", String(PACK_KEEPER_REFRESH_MINUTES)];
}

/**
 * The one keeper state, made on first use.
 *
 * @returns the process-global state
 */
function state(): KeeperState {
  const holder = globalThis as typeof globalThis & { [KEY]?: KeeperState };
  let found = holder[KEY];
  if (found === undefined) {
    found = { inFlight: false, timer: undefined };
    holder[KEY] = found;
  }
  return found;
}

/** Run the verb once, unless a run is already in flight. */
async function runOnce(): Promise<void> {
  const held = state();
  if (held.inFlight) {
    return;
  }
  held.inFlight = true;
  try {
    await spawnVerb({
      argv: packKeeperArgv(),
      timeoutMs: PACK_KEEPER_TIMEOUT_MS,
      title: "slopweaver talk pack --write --if-older-than <minutes>",
    });
  } catch {
    // spawnVerb resolves every failure it can name; a synchronous throw inside it (spawn's EINVAL, say) lands here,
    // so a run nobody awaits never becomes an unhandled rejection that ends the console server. The next mint names
    // the stale pack as leftOut, which is where a failed run surfaces.
  } finally {
    held.inFlight = false;
  }
}

/**
 * Start the keeper if this server process has not yet, and run it once now. Called from the routes a console page
 * hits, so it starts with the first page open and needs no boot hook.
 */
export function startPackKeeper(): void {
  const held = state();
  if (held.timer !== undefined) {
    return;
  }
  held.timer = setInterval(() => {
    void runOnce();
  }, PACK_KEEPER_TICK_MS);
  held.timer.unref();
  void runOnce();
}

/** Ask for a run now, as a mint that left the pack out does, so the reconnect or the next call carries it. */
export function refreshPackNow(): void {
  void runOnce();
}
