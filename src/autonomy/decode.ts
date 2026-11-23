/**
 * Decoding one line of the autonomy ledger back into whichever record it is — the pure half of the register's
 * read path, beside `./row.ts`'s builders, which it re-runs over every decoded value.
 *
 * No filesystem, no clock, no network: every instant is passed in, exactly like `../knowledge/row.ts` and
 * `../reflect/finding.ts`, so every check here is testable without a seam.
 *
 * ## How the two row shapes are told apart, and why it is not "has a steer key"
 *
 * The register carries acts and the owner's steers in ONE file, in the order they happened, because that
 * order is what a ledger is for — an act, then the owner's word about it. A second file would parse more simply and
 * lose the property: a copy of `autonomy.jsonl` alone would carry no reactions.
 *
 * They are told apart by the presence of `steeredIso`, and then VALIDATED COMPLETELY as whichever arm was
 * picked. Key presence on `steer` alone would be wrong: the owner's own ruling put a `steer` field on the
 * ACTION, so an act recorded with a word the owner had already given carries `steer` and is not a steer row.
 * `steeredIso` belongs to the steer arm and to nothing else, a steer row is REFUSED if it carries any
 * action-only field, and each arm requires every one of its own — so the two shapes are disjoint and a
 * hybrid line fails as corrupt rather than decoding as the wrong kind.
 *
 * A THIRD shape rides inside the steer arm: the owner's standing word on a whole class of act (`./types.ts`'s
 * `AutonomyClassSteerRow`, built and decoded in `./classSteer.ts`). It is a steer whose `actionId` carries
 * the `class.` prefix — or `class-scoped.`, when it also holds a `subjectPrefix` — and which also holds `kinds` and
 * `anchor`. The prefix decides, and no act may take either, so an older build reads it as a steer on an unknown
 * act and drops it, rather than refusing the register.
 *
 * No `record: "action" | "steer"` discriminator, and the reason is adoption rather than taste: the action
 * shape was already being written to this exact path by running
 * sessions before this module existed. A mandatory discriminator would refuse those rows; an optional one
 * defaulting to `"action"` is a mixed wire contract that buys nothing the disjoint validation above does not
 * already give.
 */
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { parseClassSteer } from "./classSteer.js";
import { duplicateTopLevelKey } from "./duplicateKey.js";
import { type AutonomyError, AutonomyErrors, type CorruptRowError } from "./errors.js";
import { buildAutonomyAction, buildAutonomySteer } from "./row.js";
import { type AutonomyRecord, classIdPrefixOf } from "./types.js";

/** Every field only an act may carry, so the steer arm can refuse one that strayed in. */
const ACTION_ONLY_FIELDS: readonly string[] = ["kind", "subject", "doneIso", "why", "said", "witness", "run"];

/** Every field an act must carry, in the order a refusal names them. */
const ACTION_REQUIRED_FIELDS: readonly string[] = [
  "actionId",
  "kind",
  "subject",
  "doneIso",
  "bySession",
  "why",
  "witness",
];

/** Decode the action arm completely, or say what it was missing. */
function parseAction({
  decoded,
}: {
  decoded: Readonly<Record<string, unknown>>;
}): Result<AutonomyRecord, AutonomyError> {
  const missing = ACTION_REQUIRED_FIELDS.find((field) => typeof ownField({ decoded, field }) !== "string");
  if (missing !== undefined) {
    return err(
      AutonomyErrors.invalidField({
        field: missing,
        why:
          `is not a string — an act must carry ${ACTION_REQUIRED_FIELDS.join(", ")} as strings ` +
          "(a steer carries steeredIso instead)",
      }),
    );
  }
  const run = ownField({ decoded, field: "run" });
  const steer = ownField({ decoded, field: "steer" });
  const said = ownField({ decoded, field: "said" });
  const optionalsBad =
    (run !== undefined && typeof run !== "string") ||
    (steer !== undefined && typeof steer !== "string") ||
    (said !== undefined && typeof said !== "string");
  if (optionalsBad) {
    return err(
      AutonomyErrors.invalidField({ field: "run/said/steer", why: "must be strings when an act carries them" }),
    );
  }
  return buildAutonomyAction({
    actionId: String(ownField({ decoded, field: "actionId" })),
    bySession: String(ownField({ decoded, field: "bySession" })),
    doneIso: String(ownField({ decoded, field: "doneIso" })),
    kind: String(ownField({ decoded, field: "kind" })),
    run: typeof run === "string" ? run : undefined,
    said: typeof said === "string" ? said : undefined,
    steer: typeof steer === "string" ? steer : undefined,
    subject: String(ownField({ decoded, field: "subject" })),
    why: String(ownField({ decoded, field: "why" })),
    witness: String(ownField({ decoded, field: "witness" })),
  });
}

/** Decode the steer arm completely, refusing any field only an act may carry. */
function parseSteer({
  decoded,
}: {
  decoded: Readonly<Record<string, unknown>>;
}): Result<AutonomyRecord, AutonomyError> {
  const strayed = ACTION_ONLY_FIELDS.filter((field) => ownField({ decoded, field }) !== undefined);
  if (strayed.length > 0) {
    return err(
      AutonomyErrors.invalidField({
        field: strayed.join(", "),
        why:
          "may not sit beside steeredIso — that is a hybrid of the two shapes, so it is not clear whether " +
          "it records an act or judges one",
      }),
    );
  }
  const actionId = ownField({ decoded, field: "actionId" });
  const steer = ownField({ decoded, field: "steer" });
  const steeredIso = ownField({ decoded, field: "steeredIso" });
  const bySession = ownField({ decoded, field: "bySession" });
  // The PREFIX alone decides, never the presence of `kinds` or `anchor`: a steer an older build accepted with a
  // stray field of either name must still read as the steer it always was, not refuse the register.
  // No act may take the prefix, so a steer carrying it can only be a class steer.
  if (typeof actionId === "string" && classIdPrefixOf({ actionId }) !== undefined) {
    // `kinds` before `anchor`, the order this read has always taken.
    const kinds = ownField({ decoded, field: "kinds" });
    const anchor = ownField({ decoded, field: "anchor" });
    const subjectPrefix = ownField({ decoded, field: "subjectPrefix" });
    return parseClassSteer({ actionId, anchor, bySession, kinds, steer, steeredIso, subjectPrefix });
  }
  const shaped =
    typeof actionId === "string" &&
    typeof steer === "string" &&
    typeof steeredIso === "string" &&
    typeof bySession === "string";
  if (!shaped) {
    return err(
      AutonomyErrors.invalidField({
        field: "steer",
        why: "must carry actionId, steer, steeredIso and bySession as strings",
      }),
    );
  }
  return buildAutonomySteer({ actionId, bySession, steer, steeredIso });
}

/**
 * One field of a decoded record, read ONLY if the record owns it.
 *
 * Every read below goes through this rather than indexing directly, and the reason is the field that would
 * otherwise be fabricated. A polluted `Object.prototype.steer` makes every act ever read carry a word the owner
 * never said — `../briefing/autonomy.ts` renders it as their steer, and `./query.ts`'s `unsteered` filter then
 * reports that nothing is waiting on them, which is the exact opposite of what this register is for.
 *
 * A helper rather than a null-prototype copy of the whole record: `Object.create(null)` types as `any` and
 * the assertion back is what `no-unsafe-type-assertion` refuses, while `Object.fromEntries` hands back an
 * ordinary object whose own prototype is the polluted one again. Asking per field is the shape that has
 * neither problem.
 *
 * @param decoded the record being validated
 * @param field the field to read
 * @returns the value when the record owns that field, otherwise undefined
 */
function ownField({ decoded, field }: { decoded: Readonly<Record<string, unknown>>; field: string }): unknown {
  return Object.hasOwn(decoded, field) ? decoded[field] : undefined;
}

/**
 * Validate one value as a record, re-running every `./row.ts` builder rule over it.
 *
 * Line-free on purpose, so the two callers that are not reading a file get an error about the FIELD rather
 * than about a line number they do not have. `../store.ts`'s append is the one that matters: an
 * `AutonomyRecord` is a TYPE, and a type cannot say that `why` is non-empty or that `subject` is a URL the
 * owner can open, so a caller that built a record literal rather than going through the builders in `./row.ts` could put
 * a line into the register that {@link parseAutonomyLine} then refuses as corrupt — an act every reader skips
 * and reports rather than shows.
 *
 * @param value the value to validate
 * @returns the record, or the first rule that refused it
 */
export function validateAutonomyRecord({ value }: { value: unknown }): Result<AutonomyRecord, AutonomyError> {
  if (!isRecord(value)) {
    return err(AutonomyErrors.invalidField({ field: "record", why: "is not an object" }));
  }
  if (ownField({ decoded: value, field: "steeredIso" }) !== undefined) {
    return parseSteer({ decoded: value });
  }
  return parseAction({ decoded: value });
}

/**
 * Decode one stored line back into whichever record it is.
 *
 * Re-validated rather than trusted, because the register is a plain append-only file a human is expected to
 * be able to read and, one day, will be tempted to edit — and because its first rows were written by hand
 * before any code could check them.
 *
 * @param line one line of the register
 * @param lineNumber the 1-based line number, carried into a corruption error so the file can be inspected
 * @returns the record, or a corruption error naming the line — the only way one line fails, so a reader can skip
 *   it and carry the error out rather than refuse the file
 */
export function parseAutonomyLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<AutonomyRecord, CorruptRowError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(AutonomyErrors.corruptRow({ lineNumber, why: "the line is not valid JSON" }));
  }
  const duplicate = duplicateTopLevelKey({ text: line });
  if (duplicate !== undefined) {
    return err(
      AutonomyErrors.corruptRow({
        lineNumber,
        why: `the field \`${duplicate}\` is written twice, and only the second spelling would survive the decode`,
      }),
    );
  }
  const validated = validateAutonomyRecord({ value: decoded });
  if (validated.isErr()) {
    return err(AutonomyErrors.corruptRow({ lineNumber, why: validated.error.message }));
  }
  return ok(validated.value);
}
