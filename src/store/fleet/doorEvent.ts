/**
 * Projecting one door record into one `door_event` row — a line of the legacy `$SLOPWEAVER_HOME/ledgers/door.jsonl`
 * at its one-time import, or a record the door writes live — and deciding whether the row can be shown NOT to be
 * a unit-test write.
 *
 * Pure: a line, its number, its path and the separator instant in; a row or a typed failure out. No clock
 * and no filesystem, so the separator is a PARAMETER rather than a constant this module reads — which is
 * what lets a test drive both sides of it with two lines and no fixture.
 *
 * ## The separator is the LAST PROVEN TEST WRITE, not the guard commit
 *
 * `../schema/ledgers.ts`'s header carries the full measurement. In one sentence: the unit-test suite wrote
 * door records into the ambient home on every lap until `src/__tests__/setup-ambient-home.ts` landed.
 *
 * **The guard commit's instant is not the separator, because it admits real test writes.** A commit's date is
 * when the guard became AVAILABLE, not when every checkout stopped writing: a worktree on an older commit keeps
 * running the suite against the ambient home until it rebases, and measured, one did for nearly four more
 * hours. Seven minutes after the commit, one second of the ledger holds 37 door rows, 20 of them sharing one
 * `duplicateKey` — one of the three keys that account for 137,217 rows across the whole file. A second burst
 * sits hours later, and eight post-commit rows name channel `C1`, a two-character fixture id no real Slack
 * channel has.
 *
 * So {@link LAST_PROVEN_TEST_WRITE_ISO} is the separator, and it is DERIVED from the data rather than from
 * the repository's history. Two independent markers agree on it, which is what makes it a measurement:
 *
 * ```bash
 * # the last row naming the C1 fixture channel
 * grep 'to C1 under this identity' ~/.slopweaver/ledgers/door.jsonl \
 *   | grep -oE '"tsIso":"[^"]+"' | sort | tail -1
 * # the last row on the dominant fixture key, in the same burst
 * grep <dominant-fixture-duplicateKey> ~/.slopweaver/ledgers/door.jsonl \
 *   | grep -oE '"tsIso":"[^"]+"' | sort | tail -1
 * ```
 *
 * A row STRICTLY AFTER that instant is `attributed`; every other row is `unattributable`. Strictly after,
 * and not at-or-after, because the instant itself IS a test write. The guard commit still explains WHY the
 * writes stop there rather than somewhere arbitrary — the last pre-guard worktree rebased — but it is the
 * explanation, not the criterion, and conflating the two admits real test writes.
 *
 * The direction that over-counts `unattributable` remains the safe one: this column exists so that "what
 * has this install actually done" can be asked without being lied to, and a real row miscalled
 * unattributable costs a reader one row, where the reverse costs them the answer.
 *
 * ## Two action namespaces, and a fourth status
 *
 * Almost every row's `action` is `verb:<noun>.<verb>`, built by `../../admit/ledger.ts`'s
 * `doorDecisionRecord` after the door judged a request. A row whose `action` is `gate:<gate>` is the other
 * kind: a send a PRE-DOOR gate stopped, so the door never saw it, and its `status` is `refused` rather than
 * one of the three a `DoorStatus` can hold. Both project here unchanged. The `gate:` prefix exists BECAUSE
 * this module refuses a line with no `action` and reports it — a refusal row without one would have added a
 * growing list of unreadable lines to every `slopweaver store push`. The one line written before the prefix
 * existed carries its `gate` and is read as `gate:<gate>` ({@link doorAction}); a line with neither is still
 * refused.
 */
import { isRecord } from "#lib/parsers.js";

import { optStr } from "../../corpus/slack/shape.js";

import { err, ok, type Result } from "../../lib/result.js";
import type { NewDoorEventRecord } from "../schema/ledgers.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { ledgerImportKey } from "./importKey.js";

/**
 * The committer date of the commit that added the ambient-home sandbox guard.
 *
 * Kept, and deliberately NOT the separator. It is the EXPLANATION for why the test writes stop where they
 * do, and it is not the point at which they stopped — see the module header. Exported so a reader can see the two instants side by side rather than wondering whether the
 * commit was forgotten.
 */
export const AMBIENT_HOME_GUARD_ISO = "2026-09-03T13:15:51Z";

/**
 * The instant of the last door row bearing a PROVEN test marker, and the separator this module uses.
 *
 * Derived from the ledger itself, by two markers that agree — the `C1` fixture channel's last appearance
 * and the dominant fixture `duplicateKey`'s last appearance, both inside one burst. The module header carries both commands. A row strictly after this is `attributed`.
 */
export const LAST_PROVEN_TEST_WRITE_ISO = "2026-09-03T17:08:55.922Z";

/**
 * The same read, spelled for a NULLABLE column.
 *
 * A separate function rather than `optStr(…) ?? null` because `no-silent-fallback` refuses `??`
 * outright and it is right to: the two absent cases here mean different things, and this one
 * says out loud that an absent field becomes a NULL in the row rather than defaulting to something.
 */
function nullableTextField({ value }: { value: unknown }): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

/** A row's readable array field, kept whole, or the empty list when it is absent or not an array. */
function listField({ value }: { value: unknown }): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Every waiver one ledger line carries, from EITHER key it may have been written under.
 *
 * `../../admit/ledger.ts` writes `acknowledgements` as a list, because one `--acknowledge` waives a
 * comma-separated set of subjects. Older lines carry a single `acknowledgement` record, and
 * 243 of this install's 201,300 lines still carry that spelling — those are facts on an append-only
 * ledger, so reading both is correctness rather than a compatibility shim. Reproduce the count with
 * `grep -c '"acknowledgement"' ~/.slopweaver/ledgers/door.jsonl`.
 *
 * @param decoded one already-parsed ledger line
 * @returns every waiver on it, in the order written; empty when the line waived nothing
 */
function projectAcknowledgements({
  decoded,
}: {
  decoded: Readonly<Record<string, unknown>>;
}): readonly Readonly<Record<string, unknown>>[] {
  const list = listField({ value: decoded["acknowledgements"] }).filter((entry) => isRecord(entry));
  if (list.length > 0) {
    return list;
  }
  const single = decoded["acknowledgement"];
  return isRecord(single) ? [single] : [];
}

/**
 * A line's `action`, or the one a pre-door gate row carries by construction when the line predates the field.
 *
 * `../../admit/ledger.ts`'s `preDoorRefusalRecord` writes `action: gate:<gate>` beside `gate: <gate>`, and the
 * `action` half was added in review. A checkout running
 * the branch before the review wrote ONE line with `gate` and no `action`, and it
 * refused every nightly `store import-fleet` from then on. Deriving it is the builder's own rule applied to
 * the builder's own field, the same correctness `projectAcknowledgements` gives the older singular spelling
 * on an append-only ledger. Reproduce the count with
 * `grep '"gate":' ~/.slopweaver/ledgers/door.jsonl | grep -vc '"action":'`.
 *
 * @param decoded one already-parsed ledger line
 * @returns the action, or `undefined` when the line carries neither an action nor a gate
 */
function doorAction({ decoded }: { decoded: Readonly<Record<string, unknown>> }): string | undefined {
  const action = optStr({ value: decoded["action"] });
  if (action !== undefined) {
    return action;
  }
  const gate = optStr({ value: decoded["gate"] });
  if (gate === undefined) {
    return undefined;
  }
  return `gate:${gate}`;
}

/** The scalar columns one record projects to — everything but the key, the provenance and the record itself. */
type DoorEventFields = Omit<NewDoorEventRecord, "importKey" | "provenance" | "record" | "id" | "seq">;

/** Why a record does not project: a required field it lacks, or an instant that does not parse. */
type DoorFieldProblem =
  { readonly kind: "missing"; readonly field: string } | { readonly kind: "instant"; readonly value: string };

/** The scalar projection of one decoded record, or the first problem with it. Pure. */
function doorFieldsOrProblem({
  decoded,
}: {
  decoded: Readonly<Record<string, unknown>>;
}): Result<DoorEventFields, DoorFieldProblem> {
  const action = doorAction({ decoded });
  if (action === undefined) {
    return err({ field: "action", kind: "missing" });
  }
  const effect = optStr({ value: decoded["effect"] });
  if (effect === undefined) {
    return err({ field: "effect", kind: "missing" });
  }
  const status = optStr({ value: decoded["status"] });
  if (status === undefined) {
    return err({ field: "status", kind: "missing" });
  }
  const tsIso = optStr({ value: decoded["tsIso"] });
  if (tsIso === undefined) {
    return err({ field: "tsIso", kind: "missing" });
  }
  const occurredAt = new Date(tsIso);
  if (Number.isNaN(occurredAt.getTime())) {
    return err({ kind: "instant", value: tsIso });
  }
  const acknowledgements = projectAcknowledgements({ decoded });
  return ok({
    acknowledgement: acknowledgements.length === 0 ? null : acknowledgements,
    action,
    doorRunId: nullableTextField({ value: decoded["runId"] }),
    duplicateKey: nullableTextField({ value: decoded["duplicateKey"] }),
    effect,
    findings: listField({ value: decoded["findings"] }).filter((entry) => isRecord(entry)),
    occurredAt,
    overridden: listField({ value: decoded["overridden"] }).filter((entry) => typeof entry === "string"),
    status,
  });
}

/**
 * The scalar columns a record the door wrote LIVE projects to — the same projection an imported line takes, so a
 * live row and an imported one are queried identically.
 *
 * @param decoded the record `../../admit/ledger.ts` built
 * @returns the columns, or a sentence naming why the record does not project
 */
export function doorEventFields({
  decoded,
}: {
  decoded: Readonly<Record<string, unknown>>;
}): Result<DoorEventFields, string> {
  return doorFieldsOrProblem({ decoded }).mapErr((problem) =>
    problem.kind === "missing" ? `it has no ${problem.field}` : `${problem.value} is not an instant`,
  );
}

/**
 * Project one physical line of the door ledger into the row an insert takes, the line itself kept verbatim as the
 * row's `record`.
 *
 * @param line the line's exact text, hashed into the import key so a re-apply is a no-op
 * @param lineNumber the 1-based physical line number
 * @param path the ledger's path, carried into every failure so the operator can go and look
 * @param guardIso the separator instant — {@link LAST_PROVEN_TEST_WRITE_ISO} in the shipped caller
 * @returns the row, or the typed reason the line could not become one
 */
export function projectDoorLine({
  line,
  lineNumber,
  path,
  guardIso,
}: {
  line: string;
  lineNumber: number;
  path: string;
  guardIso: string;
}): Result<NewDoorEventRecord, FleetImportError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(FleetImportErrors.unreadableLine({ lineNumber, path }));
  }
  if (!isRecord(decoded)) {
    return err(FleetImportErrors.unreadableLine({ lineNumber, path }));
  }
  const fields = doorFieldsOrProblem({ decoded });
  if (fields.isErr()) {
    const problem = fields.error;
    return err(
      problem.kind === "missing"
        ? FleetImportErrors.missingField({ field: problem.field, lineNumber, path })
        : FleetImportErrors.unreadableInstant({ lineNumber, path, value: problem.value }),
    );
  }
  return ok({
    ...fields.value,
    importKey: ledgerImportKey({ line, lineNumber }),
    provenance: doorProvenance({ guardIso, occurredAt: fields.value.occurredAt }),
    record: decoded,
  });
}

/**
 * Whether a row at this instant can be shown not to be a test write.
 *
 * Exported so `src/__tests__/unit/store/fleet/doorEvent.test.ts` can drive the boundary directly rather
 * than through two whole lines, and so the criterion has one name a reader can grep for.
 *
 * @param occurredAt when the door recorded the decision
 * @param guardIso the instant of the last row bearing a proven test marker
 * @returns `attributed` STRICTLY after that instant, `unattributable` at it or before it
 */
export function doorProvenance({
  occurredAt,
  guardIso,
}: {
  occurredAt: Date;
  guardIso: string;
}): "attributed" | "unattributable" {
  // `>` and not `>=`: the separator instant IS a test write, so a row sharing it is one too. The earlier
  // version used `>=` against the guard COMMIT, where the boundary row was not evidence of anything —
  // moving the separator onto a real row is what makes the strict comparison the correct one.
  if (occurredAt.getTime() > new Date(guardIso).getTime()) {
    return "attributed";
  }
  return "unattributable";
}
