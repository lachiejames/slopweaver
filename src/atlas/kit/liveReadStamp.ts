/**
 * When a BOUNDED live read last reached one atlas's provider directly, recorded so the freshness ladder can
 * see it.
 *
 * **Owner ruling**: a bounded live read counts as fresh. That sentence is only enforceable if
 * something writes the read down — a rule whose input nothing ever supplies is a rule that never fires, and
 * `kit/freshnessWindow.ts`'s `live-read` rung would be a verdict no atlas could ever leave. So a verb that
 * reads live stamps this file, and the sweep reads it back.
 *
 * ## Why a file beside the generation rather than a field inside it
 *
 * A generation's manifest clock is DERIVED from the kind files it vouches for, and deliberately
 * cannot be asserted by anything. A live read publishes no kind file — that is what BOUNDED means — so
 * writing one into the manifest would either be a clock the manifest asserts, which the derivation makes structurally
 * impossible on purpose, or a generation vouching for records nobody wrote. The two facts are genuinely
 * different: one says when the whole atlas was rebuilt, the other says when a slice of it was last checked
 * against the provider. Keeping them in separate files is what stops a reader conflating them.
 *
 * ## The stamp is a floor, never a ceiling
 *
 * A live read against ONE control does not make the whole atlas current, and this module does not claim it
 * does. What the freshness ladder does with it is narrower: an answer that RESTS on the live read may be
 * quoted, and `kit/freshness.ts` says so in the note it attaches. A caller quoting a different slice of the
 * same atlas is quoting the generation, and the generation's own age is what governs there. That limit is
 * stated here rather than discovered later, because a freshness signal that hides its own scope is the thing
 * this contract exists to prevent.
 */
import { join } from "node:path";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { readFileIfPresent } from "../atlasFile.js";

import { type AtlasSidecarError, AtlasSidecarErrors } from "./sidecarErrors.js";

/** The schema version new code writes. A reader accepts only this one — nothing older has existed. */
export const ATLAS_LIVE_READ_SCHEMA_VERSION = 1;

/** The file name, under an atlas's own directory beside its manifest.
 *
 * @internal
 */
export const ATLAS_LIVE_READ_FILE = "live-read.json";

/** One atlas's most recent bounded live read. */
export interface AtlasLiveRead {
  readonly schemaVersion: typeof ATLAS_LIVE_READ_SCHEMA_VERSION;
  /** When the read reached the provider. */
  readonly atIso: string;
  /** The verb that made it, so a reader can see what slice was actually checked. */
  readonly verb: string;
  /** What the read covered, in the platform's own words — one control id, one zone, one workspace. */
  readonly scope: string;
}

/**
 * Where one atlas's live-read stamp lives.
 *
 * @param atlasDir the atlas's own directory — the `root` its paths resolver named
 * @returns the absolute path to the stamp
 */
export function atlasLiveReadPath({ atlasDir }: { atlasDir: string }): string {
  return join(atlasDir, ATLAS_LIVE_READ_FILE);
}

/**
 * Read one atlas's live-read stamp.
 *
 * An ABSENT stamp is `null` and never a failure: no atlas has one until a bounded live read has actually
 * run, and refusing there would make the freshness sweep fail on every atlas that has simply not been asked
 * a live question yet. A stamp that is present and unreadable IS a failure, for the reason the store refuses
 * a corrupt generation rather than reading it as an empty one.
 *
 * @param atlasDir the atlas's own directory
 * @returns the stamp, `null` when none has been written, or the reason a present one could not be read
 */
export function readAtlasLiveRead({ atlasDir }: { atlasDir: string }): Result<AtlasLiveRead | null, AtlasSidecarError> {
  const path = atlasLiveReadPath({ atlasDir });
  const raw = readFileIfPresent({ path });
  if (raw.isErr()) {
    return err(AtlasSidecarErrors.stampUnreadable({ reasons: raw.error }));
  }
  if (raw.value === null) {
    return ok(null);
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text: raw.value });
  } catch (cause) {
    return err(AtlasSidecarErrors.stampNotJson({ cause, path }));
  }
  if (!isRecord(decoded)) {
    return err(AtlasSidecarErrors.stampNotRecord({ path }));
  }
  const { schemaVersion, atIso, verb, scope } = decoded;
  if (schemaVersion !== ATLAS_LIVE_READ_SCHEMA_VERSION) {
    return err(
      AtlasSidecarErrors.stampSchemaForeign({ found: schemaVersion, path, writes: ATLAS_LIVE_READ_SCHEMA_VERSION }),
    );
  }
  if (typeof atIso !== "string" || typeof verb !== "string" || typeof scope !== "string") {
    return err(AtlasSidecarErrors.stampFieldsMissing({ path }));
  }
  return ok({ atIso, scope, schemaVersion: ATLAS_LIVE_READ_SCHEMA_VERSION, verb });
}

/**
 * Record that a bounded live read reached this atlas's provider.
 *
 * Overwrites rather than appends: the ladder asks one question — how long ago was the last one — and a log
 * of every live read ever taken is a different artefact with a different owner. The door ledger already
 * records external calls, and duplicating it here would be a second history to keep honest.
 *
 * @param atlasDir the atlas's own directory
 * @param atIso when the read reached the provider
 * @param verb the verb that made the read
 * @param scope what the read covered, in the platform's own words
 * @returns nothing on success, or the reason the stamp could not be written
 */
export function recordAtlasLiveRead({
  atlasDir,
  atIso,
  verb,
  scope,
}: {
  atlasDir: string;
  atIso: string;
  verb: string;
  scope: string;
}): Result<null, AtlasSidecarError> {
  const stamp: AtlasLiveRead = { atIso, scope, schemaVersion: ATLAS_LIVE_READ_SCHEMA_VERSION, verb };
  try {
    writeFileAtomic({ contents: `${JSON.stringify(stamp, null, 2)}\n`, path: atlasLiveReadPath({ atlasDir }) });
  } catch (cause) {
    return err(AtlasSidecarErrors.stampWriteFailed({ atlasDir, cause }));
  }
  return ok(null);
}
