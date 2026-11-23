/**
 * The OPT-IN lock an atlas takes across a whole expensive read-and-publish, and why it is not the one that
 * makes publication correct.
 *
 * ## This is a cost control. `./mutationLock.ts` is the correctness boundary
 *
 * Publication correctness is no longer anything a platform chooses: `store.ts`'s `publishAtlas` takes the
 * mutation lock and performs a compare-and-swap against the whole manifest a candidate was derived from, on
 * every publish, with no way to opt out. So an atlas that calls nothing in this file still cannot lose an
 * update — it only finds out at the END of its pass rather than the start.
 *
 * That is exactly what this lock buys, and it is worth buying where the pass is expensive. An atlas whose
 * two channels each spend minutes with a provider before publishing would otherwise have the second one do
 * all of that work and then lose the compare-and-swap. Wrapping the whole read-and-publish here serialises
 * the expensive half, so the loser waits instead of working. `admit/operationLock.ts` is an atomic
 * directory rename with stale-holder takeover, the same primitive `github stack push` uses.
 *
 * ## Its key is NOT the mutation lock's, and that is deliberate
 *
 * `acquireOperationLock` refuses a second acquisition of a held key inside its stale threshold, even from the
 * process holding it. If this took `atlas:<platform>:mutate`, every pass holding it across a read-and-publish
 * would be refused the moment `publishAtlas` reached for the same key. So this lock
 * keeps `atlas:<platform>:publish` and the two compose rather than collide — see `./mutationLock.ts`.
 *
 * ## Which atlases take it, stated rather than assumed
 *
 * Any atlas whose passes write the SAME kind AND pay a real cost to get there. Vanta gives its browser walk
 * its own kinds, so its two writers never touch one file. Notion's and Trelica's both write `method`,
 * because the corroboration between the channels is the output. Count the callers rather than believing a
 * number written here: `grep -rln withAtlasPublishLock src | grep -v __tests__`.
 *
 * The lock protects processes sharing one `$SLOPWEAVER_HOME` on one machine, which is the whole population
 * that can write an atlas.
 */
import { acquireOperationLock } from "../../admit/operationLock.js";
import { err, type Result } from "../../lib/result.js";

import { AtlasPublishErrors, atlasPublishErrorLines } from "./publishErrors.js";

/**
 * Hold the publish lock across one read-and-publish, so two channels cannot lose each other's rows.
 *
 * @param home the state home the lock lives under
 * @param key the lock key both of this atlas's publishers take
 * @param platform the atlas's own platform name, so a refusal says which atlas is busy
 * @param nowIso the instant of the attempt
 * @param publish what to do while the lock is held — read the generation and write the next one
 * @returns whatever `publish` returned, or the reason the lock could not be taken
 */
export function withAtlasPublishLock<T>({
  home,
  key,
  platform,
  nowIso,
  publish,
}: {
  home: string;
  key: string;
  platform: string;
  nowIso: string;
  publish: () => Result<T>;
}): Result<T> {
  const held = acquireOperationLock({ home, key, nowIso });
  if (held.isErr()) {
    return err(atlasPublishErrorLines({ error: AtlasPublishErrors.publishLockHeld({ holder: held.error, platform }) }));
  }
  try {
    return publish();
  } finally {
    held.value.release();
  }
}
