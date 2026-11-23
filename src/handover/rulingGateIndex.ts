/**
 * The read path for standing ruling gates — one small file, because the register they come from is far too
 * expensive to read on every verb.
 *
 * MEASURED on one install:
 *
 * ```bash
 * time slopweaver catalog >/dev/null                 # 4.1s  — bare CLI start, no board
 * time slopweaver handover list --json >/dev/null     # 10.6s — +6.4s for 2678 row DOCUMENTS (52 MB)
 * du -sh "$SLOPWEAVER_HOME/runs"                      # 11 MB, 2144 journals
 * ```
 *
 * Reading every journal and filtering for `"kind":"ruling"` — no document parsing at all — takes **728 ms**
 * and finds 170 ruling lines. Repro: a `readdirSync` of `$SLOPWEAVER_HOME/runs` reading each `.jsonl` and
 * counting the matching lines. That is still far too much to add to every `slopweaver` invocation, and it
 * grows monotonically because journals are append-only and nothing prunes them. A guardrail that taxes the
 * whole CLI is one that gets ripped out, which would leave it worse than absent — it would have been tried.
 *
 * So the journal stays the SOURCE OF TRUTH (derive from the one register) and this
 * file is its projection: `handover rule --gates` writes both in one invocation, `handover gate rebuild`
 * reconstructs it from journals in the measured 728 ms, and `handover gate check` reports a divergence.
 *
 * **It fails OPEN, and that is stated rather than discovered.** A missing, truncated or unparseable index
 * yields no gates. Refusing every verb on an unreadable 2 KB file would wedge the entire CLI, which is a
 * worse failure than the one this closes — and unlike the failure this closes, nobody could fix it. What
 * makes that acceptable is that the rebuild is cheap, idempotent and checkable, not that it is unlikely.
 *
 * Pure: text in, an index or every reason it is not one out. The effectful half is `./rulingGateStore.ts`.
 */

import { z } from "zod";
import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import { isCanonicalInstant } from "./ruling.js";
import type { StandingGate } from "./rulingGate.js";
import { type RulingGateError, RulingGateErrors } from "./rulingGateErrors.js";

/** The schema version new code writes. A reader accepts only this one — nothing older has ever existed. */
export const RULING_GATE_INDEX_SCHEMA_VERSION = 1;

/** Every standing gate on the board, as the dispatch boundary reads them. */
export interface RulingGateIndex {
  readonly schemaVersion: typeof RULING_GATE_INDEX_SCHEMA_VERSION;
  /** When this projection was last built, so `gate list` can say how old it is. */
  readonly builtAtIso: string;
  /** The gates, oldest first. Expiry is applied by the READER, never baked in here. */
  readonly gates: readonly StandingGate[];
}

/** Present and not blank. */
const nonBlank = z.string().refine((value) => value.trim().length > 0, { message: "must not be blank" });

const gateSchema = z
  .object({
    anchor: nonBlank,
    id: nonBlank,
    placedIso: z.string().refine((iso) => isCanonicalInstant({ iso }), {
      message: "is not a canonical toISOString() instant, so no release could ever name this gate",
    }),
    slug: nonBlank,
    subjects: z.array(nonBlank).readonly(),
    untilIso: nonBlank.optional(),
    verbs: z
      .array(z.object({ noun: nonBlank, verb: nonBlank }).strict())
      .min(1)
      .readonly(),
    words: nonBlank,
  })
  .strict();

const indexSchema = z
  .object({
    builtAtIso: nonBlank,
    gates: z.array(gateSchema).readonly(),
    schemaVersion: z.literal(RULING_GATE_INDEX_SCHEMA_VERSION),
  })
  .strict();

/**
 * Parse the index, or say why it is not one.
 *
 * Strict and whole, exactly as `./rulingManifest.ts` is: one bad entry rejects the file rather than being
 * dropped, because an index that silently lost a gate would report the owner's rulings as a subset of themselves —
 * and a dropped gate is a verb that quietly stops refusing.
 *
 * @param text the file's contents
 * @param path where it came from, so the refusal names the file a reader has to fix
 * @returns the index, or the one typed reason it is not one
 */
export function parseRulingGateIndex({
  text,
  path,
}: {
  text: string;
  path: string;
}): Result<RulingGateIndex, RulingGateError> {
  const decoded = parseJson({ text });
  if (decoded.isErr()) {
    return err(RulingGateErrors.indexUnreadable({ detail: decoded.error.message, path }));
  }
  const parsed = indexSchema.safeParse(decoded.value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ");
    return err(RulingGateErrors.indexUnreadable({ detail, path }));
  }
  return ok({
    builtAtIso: parsed.data.builtAtIso,
    gates: parsed.data.gates.map((gate): StandingGate => ({
      anchor: gate.anchor,
      id: gate.id,
      placedIso: gate.placedIso,
      slug: gate.slug,
      subjects: gate.subjects,
      ...(gate.untilIso === undefined ? {} : { untilIso: gate.untilIso }),
      verbs: gate.verbs,
      words: gate.words,
    })),
    schemaVersion: RULING_GATE_INDEX_SCHEMA_VERSION,
  });
}

/**
 * Render an index for writing.
 *
 * @param gates the standing gates, oldest first
 * @param builtAtIso when this projection was taken
 * @returns the file's contents, newline-terminated
 */
export function renderRulingGateIndex({
  gates,
  builtAtIso,
}: {
  gates: readonly StandingGate[];
  builtAtIso: string;
}): string {
  const index: RulingGateIndex = { builtAtIso, gates, schemaVersion: RULING_GATE_INDEX_SCHEMA_VERSION };
  return `${JSON.stringify(index, null, 2)}\n`;
}
