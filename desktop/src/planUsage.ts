/**
 * Each registered plan's usage as the menu bar reads it: the console's `plan-usage` answer (`site/lib/liveVerbs.ts`),
 * which carries the document `slopweaver plans usage --json` prints, parsed rather than trusted. The CLI's half is
 * `src/plans/planUsage.ts`; this package imports nothing from `src/`, so the shape is written twice and this side
 * checks every field it receives. A document with one malformed field is refused whole, never drawn in part: a plan
 * missing from the menu would read as a plan that is not registered. Pure.
 */
import { err, ok, type Result } from "neverthrow";

import { isRecord } from "./desktopBridge";

/** Which weekly window a reading is of. */
export type PlanUsageWindowLabel = "week" | "fable-week";

/** One weekly window, as far as the recorded evidence lets it be said. */
export type PlanUsageWindow =
  | {
      readonly kind: "measured";
      readonly label: PlanUsageWindowLabel;
      readonly usedPercent: number;
      readonly resetAtIso: string | null;
      readonly observedAtIso: string;
    }
  | {
      readonly kind: "stale";
      readonly label: PlanUsageWindowLabel;
      readonly usedPercent: number;
      readonly resetAtIso: string | null;
      readonly observedAtIso: string;
      readonly reason: string;
    }
  | { readonly kind: "no-reading" | "unavailable"; readonly label: PlanUsageWindowLabel; readonly reason: string };

/** Whether the store a row names is signed in. */
export type PlanUsageSignIn =
  { readonly kind: "ok" } | { readonly kind: "needs-sign-in" | "unknown"; readonly reason: string };

/** A row's usage: its weekly windows, or why it carries none. */
export type PlanUsageState =
  | { readonly kind: "weekly"; readonly windows: readonly PlanUsageWindow[] }
  | { readonly kind: "paused"; readonly reason: string }
  | { readonly kind: "not-measured"; readonly reason: string };

/** One registered plan. */
export interface PlanUsageRow {
  readonly alias: string;
  readonly modelHost: "claude" | "codex";
  readonly signIn: PlanUsageSignIn;
  readonly usage: PlanUsageState;
}

/** What the console answered: the report, or a register holding no plan, which is an answer and not a failure. */
export type PlanUsageReading =
  | { readonly kind: "report"; readonly observedAtIso: string; readonly rows: readonly PlanUsageRow[] }
  | { readonly kind: "none-registered" };

const LABELS: readonly PlanUsageWindowLabel[] = ["week", "fable-week"];

/** One of `allowed`, or `undefined`. */
function oneOf<T extends string>({ value, allowed }: { value: unknown; allowed: readonly T[] }): T | undefined {
  return allowed.find((member) => member === value);
}

/** An instant that parses, or `undefined`. */
function instantOf({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

/** A reset: an instant, `null` when the reading carried none, or `undefined` when malformed. */
function resetOf({ value }: { value: unknown }): string | null | undefined {
  if (value === null) {
    return null;
  }
  return instantOf({ value });
}

/** A percentage the menu can print, or `undefined`. */
function percentOf({ value }: { value: unknown }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** One window, or `undefined` when it is malformed. */
function parseWindow({ value }: { value: unknown }): PlanUsageWindow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const label = oneOf({ allowed: LABELS, value: value["label"] });
  if (label === undefined) {
    return undefined;
  }
  const { kind, reason } = value;
  if (kind === "no-reading" || kind === "unavailable") {
    return typeof reason === "string" ? { kind, label, reason } : undefined;
  }
  const usedPercent = percentOf({ value: value["usedPercent"] });
  const resetAtIso = resetOf({ value: value["resetAtIso"] });
  const observedAtIso = instantOf({ value: value["observedAtIso"] });
  if (usedPercent === undefined || resetAtIso === undefined || observedAtIso === undefined) {
    return undefined;
  }
  if (kind === "measured") {
    return { kind, label, observedAtIso, resetAtIso, usedPercent };
  }
  if (kind === "stale" && typeof reason === "string") {
    return { kind, label, observedAtIso, reason, resetAtIso, usedPercent };
  }
  return undefined;
}

/** A sign-in verdict, or `undefined` when it is malformed. */
function parseSignIn({ value }: { value: unknown }): PlanUsageSignIn | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind, reason } = value;
  if (kind === "ok") {
    return { kind };
  }
  if ((kind === "needs-sign-in" || kind === "unknown") && typeof reason === "string") {
    return { kind, reason };
  }
  return undefined;
}

/** A row's usage, or `undefined` when it is malformed. */
function parseUsage({ value }: { value: unknown }): PlanUsageState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind, reason, windows } = value;
  if ((kind === "paused" || kind === "not-measured") && typeof reason === "string") {
    return { kind, reason };
  }
  if (kind !== "weekly" || !Array.isArray(windows)) {
    return undefined;
  }
  const parsed = windows.map((window: unknown) => parseWindow({ value: window }));
  if (parsed.some((window) => window === undefined)) {
    return undefined;
  }
  return { kind, windows: parsed.filter((window): window is PlanUsageWindow => window !== undefined) };
}

/** One row, or `undefined` when it is malformed. */
function parseRow({ value }: { value: unknown }): PlanUsageRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { alias } = value;
  const modelHost = oneOf({ allowed: ["claude", "codex"] as const, value: value["modelHost"] });
  const signIn = parseSignIn({ value: value["signIn"] });
  const usage = parseUsage({ value: value["usage"] });
  if (
    typeof alias !== "string" ||
    alias === "" ||
    modelHost === undefined ||
    signIn === undefined ||
    usage === undefined
  ) {
    return undefined;
  }
  return { alias, modelHost, signIn, usage };
}

/**
 * The menu bar's reading off what the console's `/api/live/plan-usage` answered.
 *
 * @param value the response body, already parsed from JSON
 * @returns the reading, or why it could not be read: the console's own sentence when it could not run the verb
 */
export function parsePlanUsageLiveResult({ value }: { value: unknown }): Result<PlanUsageReading, string> {
  if (!isRecord(value)) {
    return err("the console's answer is not a document");
  }
  if (value["ok"] === false) {
    const { notMeasured } = value;
    return err(typeof notMeasured === "string" ? notMeasured : "the console could not read it");
  }
  if (value["ok"] !== true || !isRecord(value["payload"])) {
    return err("the console's answer carries no reading");
  }
  const { payload } = value;
  if (payload["kind"] === "expected-empty") {
    return ok({ kind: "none-registered" });
  }
  const observedAtIso = instantOf({ value: payload["observedAtIso"] });
  const { rows } = payload;
  if (observedAtIso === undefined || !Array.isArray(rows)) {
    return err("the reading is malformed: observedAtIso or rows");
  }
  const parsed = rows.map((row: unknown) => parseRow({ value: row }));
  const bad = parsed.findIndex((row) => row === undefined);
  if (bad !== -1) {
    return err(`the reading is malformed: row ${String(bad + 1)}`);
  }
  return ok({
    kind: "report",
    observedAtIso,
    rows: parsed.filter((row): row is PlanUsageRow => row !== undefined),
  });
}
