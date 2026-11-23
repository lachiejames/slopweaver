/**
 * The tick digest's per-seat lists: each seat the watch report does not call working, each alert the event
 * tail found, and each seat whose context depth needs acting on. The chair read all three out of `tick-<n>/`
 * with `jq` and `grep` before the digest named them.
 *
 * Split from `tickDigest.ts` along the seam between the fleet's SEATS and the tick's own readings. Pure.
 */
import { absentAs } from "#lib/absent.js";

import { monitorPassLines } from "./digestNotice.js";
import {
  ALERT_CHARS,
  arrayField,
  capped,
  cappedInline,
  type DigestInputs,
  field,
  jsonOf,
  named,
  numberField,
  shortened,
  stringField,
  unavailableLine,
} from "./digestRead.js";

/**
 * A seat's working directory by its last segment, which is the worktree name the chair knows it by.
 *
 * @returns the last non-empty segment, or `(root)` for a path with none
 */
function basenameOf({ path }: { path: string }): string {
  const last = path.split("/").findLast((segment) => segment !== "");
  if (last === undefined) {
    return "(root)";
  }
  return last;
}

/**
 * The seats the chair has to look at: every watch row whose signal is not `working`, by worktree name.
 *
 * @returns one line per seat the watch report does not call working, then how many it suppressed
 */
export function watchLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "watch-report" });
  if ("line" in read) {
    return [read.line];
  }
  const rows = arrayField({ key: "rows", value: read.value });
  const notWorking = rows
    .filter((row) => stringField({ key: "signal", value: row }) !== "working")
    .map((row) => {
      const quiet = numberField({ key: "quietMinutes", value: row });
      const cwd = absentAs({ value: stringField({ key: "cwd", value: row }), whenAbsent: "(no cwd)" });
      return (
        `watch: ${absentAs({ value: stringField({ key: "signal", value: row }), whenAbsent: "(no signal)" })} ` +
        `${quiet === undefined ? "?" : String(quiet)}m — ${basenameOf({ path: cwd })}`
      );
    });
  const suppressed = numberField({ key: "suppressed", value: read.value });
  const lines = notWorking.length === 0 ? [`watch: all ${String(rows.length)} seat(s) working`] : notWorking;
  return [
    ...capped({ lines, prefix: "watch" }),
    ...(suppressed === undefined || suppressed === 0 ? [] : [`watch: ${String(suppressed)} suppressed`]),
  ];
}

/**
 * The alerts in the event tail, which the chair used to `grep alert` out of `events.txt`. A line of
 * `events tail` is `<type>\t<iso>\t<source>\t<kind>\t<subject>\t<text>`.
 *
 * @returns each alert the event tail carried — its kind, its subject, and the first of its text
 */
export function eventLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const reading = inputs.readings.get("events");
  const missing = unavailableLine({ name: "events", reading });
  if (missing !== undefined) {
    return [missing];
  }
  if (reading?.kind !== "text") {
    return ["events: captured as JSON, not text"];
  }
  const alerts = reading.text
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([type]) => type === "alert")
    .map(([, , , kind, subject, text]) => {
      const said = shortened({ limit: ALERT_CHARS, text: absentAs({ value: text, whenAbsent: "(no text)" }) });
      return `event: ${absentAs({ value: kind, whenAbsent: "(no kind)" })} ${absentAs({ value: subject, whenAbsent: "(no subject)" })} — ${said}`;
    });
  return alerts.length === 0 ? ["events: no alerts"] : capped({ lines: alerts, prefix: "event" });
}

/** The depth verdicts that need nothing from the chair. */
const QUIET_DEPTH_VERDICTS: ReadonlySet<string> = new Set(["keep", "under-threshold"]);

/**
 * The seats past their depth threshold, by slug, size and verdict — the respawn candidates.
 *
 * @returns each seat whose context depth the depth reading says needs acting on
 */
export function depthLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "depth" });
  if ("line" in read) {
    return [read.line];
  }
  const deep = arrayField({ key: "rows", value: read.value })
    .filter((row) => {
      const verdict = field({ key: "verdict", value: row });
      const value = stringField({ key: "value", value: verdict });
      return (
        field({ key: "known", value: verdict }) === true && value !== undefined && !QUIET_DEPTH_VERDICTS.has(value)
      );
    })
    .map((row) => {
      const tokens = numberField({
        key: "depthTokens",
        value: field({ key: "value", value: field({ key: "depth", value: row }) }),
      });
      const size = tokens === undefined ? "depth unknown" : `${String(Math.round(tokens / 1000))}k`;
      return `depth: ${absentAs({ value: stringField({ key: "slug", value: row }), whenAbsent: "(no slug)" })} ${size} ${named({ key: "value", value: field({ key: "verdict", value: row }) })}`;
    });
  return deep.length === 0 ? ["depth: every seat under threshold"] : capped({ lines: deep, prefix: "depth" });
}

/** Each close-done outcome kind, by the count key the summary line prints it under. */
const CLOSE_DONE_KINDS: readonly (readonly [kind: string, countKey: string])[] = [
  ["closed", "closed"],
  ["parked", "parked"],
  ["drift-closed", "driftClosed"],
  ["close-failed", "failed"],
  ["park-failed", "failed"],
  ["held", "held"],
  ["kept", "kept"],
];

/**
 * The rows behind each close-done count, one line per non-empty kind, labelled by the count it makes up.
 *
 * @param outcomes close-done's `outcomes` array, each `{ kind, item: { row } }`
 * @returns one `<count key>: <rows>` line per kind that has any, each list capped
 */
export function closeDoneLines({ outcomes }: { outcomes: readonly unknown[] }): readonly string[] {
  return CLOSE_DONE_KINDS.flatMap(([kind, countKey]) => {
    const rows = outcomes
      .filter((one) => stringField({ key: "kind", value: one }) === kind)
      .map((one) => {
        const row = field({ key: "row", value: field({ key: "item", value: one }) });
        const slug = stringField({ key: "slug", value: row });
        if (slug !== undefined) {
          return slug;
        }
        return named({ key: "sessionKey", value: row });
      });
    return rows.length === 0 ? [] : [`${countKey}: ${cappedInline({ items: rows })}`];
  });
}

/**
 * The fleet health verdict the tick-open pass read, and what that pass did with it: the note it posted, the card
 * it settled on recovery, or the refusal that kept a card off the owner's screen — which `tick close` then refuses on.
 *
 * @param inputs the tick's readings, whose `fleet-health` document is `monitor check --json`
 * @returns the verdict's line, then one line per action the pass took
 */
export function fleetHealthLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  return monitorPassLines({
    firing: "TRIPPED",
    inputs,
    label: "fleet health",
    monitorId: "fleet-unhealthy",
    name: "fleet-health",
  });
}
