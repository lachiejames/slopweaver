/**
 * The PURE core of `slopweaver atlas vanta changes`: flag parsing, the kind filter and the human rendering of
 * the unread change records. No fs, no clock — `changesRun.ts` does the reads and the cursor write.
 *
 * The rendering is written for a session judging what the owner would want to hear about, so it puts what
 * moved first and folds what did not: every kind that changed nothing shares ONE line, still named, because
 * an absent kind reads as one this sync never looked at.
 */
import type { VantaChangeGroup, VantaChangeRecord, VantaKindChange } from "../../../atlas/vanta/changes.js";
import { VANTA_KINDS, type VantaKind } from "../../../atlas/vanta/model.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** The validated invocation: list what is unread, or move the cursor. */
export type VantaChangesOptions =
  | { readonly mode: "list"; readonly home: string; readonly json: boolean; readonly kind: VantaKind | null }
  | { readonly mode: "mark-read"; readonly home: string; readonly json: boolean; readonly at: string };

/** Whether a flag value names a Vanta kind. */
function isVantaKind(value: string): value is VantaKind {
  return VANTA_KINDS.some((kind) => kind === value);
}

/**
 * Parse the verb tail.
 *
 * @param rest the argv tail after `slopweaver atlas vanta changes`
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaChangesOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaChangesOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "kind", "mark-read"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value });
  const json = parsed.value.flags.has("json");
  const kind = flagValue({ name: "kind", parsed: parsed.value });
  const markRead = flagValue({ name: "mark-read", parsed: parsed.value });
  if (markRead !== null) {
    if (kind !== null) {
      return err(["--mark-read moves the cursor for every kind at once, so it takes no --kind"]);
    }
    return ok({ at: markRead, home, json, mode: "mark-read" });
  }
  if (kind !== null && !isVantaKind(kind)) {
    return err([`--kind ${kind} is not a Vanta kind — one of: ${VANTA_KINDS.join(", ")}`]);
  }
  return ok({ home, json, kind, mode: "list" });
}

/**
 * Narrow each record to one kind, dropping records that never touched it.
 *
 * @param kind the kind to keep, or `null` to keep every kind
 * @returns the records as they would read with only that kind
 */
export function filterVantaChangesByKind({
  records,
  kind,
}: {
  records: readonly VantaChangeRecord[];
  kind: VantaKind | null;
}): readonly VantaChangeRecord[] {
  if (kind === null) {
    return records;
  }
  return records
    .map((record): VantaChangeRecord => ({
      at: record.at,
      kinds: record.kinds.filter((entry) => entry.kind === kind),
      version: record.version,
    }))
    .filter((record) => record.kinds.length > 0);
}

/** An entity as a reader names it: its display name when it has one, and always its provider id. */
function refLabel({ name, providerId }: { name: string | null; providerId: string }): string {
  return name === null ? providerId : `${name} [${providerId}]`;
}

/** Whether a completely read kind has anything to say: an entity that moved, or a note from the sync. */
function moved({ entry }: { entry: Extract<VantaKindChange, { read: "complete" }> }): boolean {
  const { added, changed, removed, returned } = entry.counts;
  return added + changed + removed + returned > 0 || entry.notes.length > 0;
}

/** One changed group: its size and fields, then each example's field-by-field before and after. */
function groupLines({ group }: { group: VantaChangeGroup }): readonly string[] {
  const more = group.count - group.examples.length;
  return [
    `  ~ ${String(group.count)} changed ${group.fields.join(", ")}`,
    ...group.examples.flatMap((example) => [
      `      ${refLabel(example)}`,
      ...example.fields.map((change) => `        ${change.field}: ${change.before} → ${change.after}`),
    ]),
    ...(more > 0 ? [`      … and ${String(more)} more with the same fields`] : []),
  ];
}

/** Every line one kind that moved contributes. */
function completeKindLines({ entry }: { entry: Extract<VantaKindChange, { read: "complete" }> }): readonly string[] {
  const { added, changed, removed, returned, unchanged } = entry.counts;
  const omitted = entry.groupsOmitted;
  return [
    `${entry.kind}: +${String(added)} added, ${String(returned)} returned, -${String(removed)} removed, ~${String(changed)} changed, ${String(unchanged)} unchanged — since ${entry.since}`,
    ...entry.notes.map((note) => `  ! the sync still called this read failed: ${note}`),
    ...entry.added.map((ref) => `  + ${refLabel(ref)}${ref.returned ? " (returned)" : ""}`),
    ...(entry.addedMore > 0 ? [`  + … and ${String(entry.addedMore)} more`] : []),
    ...entry.removed.map((ref) => `  - ${refLabel(ref)}`),
    ...(entry.removedMore > 0 ? [`  - … and ${String(entry.removedMore)} more`] : []),
    ...entry.changedGroups.flatMap((group) => groupLines({ group })),
    ...(omitted.groups > 0
      ? [
          `  ~ … and ${String(omitted.groups)} commoner group(s) covering ${String(omitted.entities)} entit(ies); fields moved: ${Object.entries(
            entry.fieldTally,
          )
            .map(([field, count]) => `${field}×${String(count)}`)
            .join(", ")}`,
        ]
      : []),
  ];
}

/**
 * The human lines for one change record.
 *
 * @returns a heading, each moved kind in sync order, each baseline and unread kind, then one line naming
 *   every kind that changed nothing
 */
export function renderVantaChangeRecordLines({ record }: { record: VantaChangeRecord }): readonly string[] {
  const still: string[] = [];
  const lines: string[] = [`== Vanta sync ${record.at} ==`];
  for (const entry of record.kinds) {
    if (entry.read === "baseline") {
      lines.push(`${entry.kind}: baseline — ${String(entry.entities)} entit(ies), the first read, so nothing compared`);
    } else if (entry.read === "incomplete") {
      lines.push(`${entry.kind}: UNREAD this sync — nothing compared`, ...entry.reasons.map((reason) => `  ${reason}`));
    } else if (moved({ entry })) {
      lines.push(...completeKindLines({ entry }));
    } else {
      still.push(entry.kind);
    }
  }
  if (still.length > 0) {
    lines.push(`no change: ${still.join(", ")}`);
  }
  return lines;
}

/**
 * The human lines for every unread record, oldest first, ending with the command that marks them judged.
 *
 * A listing narrowed by `--kind` never offers that command: the cursor covers every kind at once, so marking
 * from one kind's listing would mark every other kind judged unread.
 *
 * @param throughAt the latest record already judged, or `null` when none has been
 * @param kind the kind the listing was narrowed to, or `null` for the whole change
 * @returns the report lines
 */
export function renderUnreadVantaChangesLines({
  records,
  throughAt,
  kind,
}: {
  records: readonly VantaChangeRecord[];
  throughAt: string | null;
  kind: VantaKind | null;
}): readonly string[] {
  const judged = throughAt === null ? "none judged yet" : `judged through ${throughAt}`;
  const latest = records.at(-1);
  if (latest === undefined) {
    return [`no unread Vanta changes (${judged})`];
  }
  return [
    `${String(records.length)} unread Vanta change record(s) (${judged})`,
    ...records.flatMap((record) => ["", ...renderVantaChangeRecordLines({ record })]),
    "",
    kind === null
      ? `once judged: slopweaver atlas vanta changes --mark-read ${latest.at}`
      : `this listing shows ${kind} only — read the whole change, without --kind, before marking it judged`,
  ];
}
