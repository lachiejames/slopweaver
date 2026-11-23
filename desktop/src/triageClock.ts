/**
 * Rapid triage in the menu bar: the countdown beside the Slopweaver item, the menu's triage items, and the small file
 * the floating notes read to draw their two triage buttons. The countdown is visible
 * while a triage is running, started and stopped by voice with the menu bar as a second control, and the timer
 * exists only while triage mode is on.
 *
 * The voice's page is the one authority on the pass and its clock (`site/lib/triageClockReport.ts`); the shell only
 * mirrors what that page last reported and routes the owner's presses back to it. The site's half of these shapes is
 * `site/lib/desktopShell.ts` — a separate project, so each side parses what it receives. Pure.
 */
import { join } from "node:path";

import { shellHomeOf } from "./pageReveal";

/** What the voice's page says of its triage pass. */
export type TriageClockReport =
  | { readonly on: false }
  | { readonly on: true; readonly phase: "running"; readonly deadlineMs: number }
  | { readonly on: true; readonly phase: "paused" }
  | { readonly on: true; readonly phase: "between" };

/** What a press in the menu bar or on a floating note asks of the pass. */
export type TriageCommand = "start" | "pause" | "resume" | "off";

/** Triage off: nothing drawn, and the one item that starts it. */
export const TRIAGE_OFF: TriageClockReport = { on: false };

/**
 * Whether a value is a plain record.
 *
 * @param value anything
 * @returns true for a non-null, non-array object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One report off the wire, exact: any other key, or a deadline that is not a whole, positive instant, is no report.
 *
 * @param value what the page sent
 * @returns the report, or `undefined` when it is not exactly one
 */
export function parseTriageClockReport({ value }: { value: unknown }): TriageClockReport | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const keys = Object.keys(value).length;
  if (value["on"] === false) {
    return keys === 1 ? TRIAGE_OFF : undefined;
  }
  if (value["on"] !== true) {
    return undefined;
  }
  const phase = value["phase"];
  if ((phase === "paused" || phase === "between") && keys === 2) {
    return { on: true, phase };
  }
  const deadlineMs = value["deadlineMs"];
  const wholeInstant = typeof deadlineMs === "number" && Number.isSafeInteger(deadlineMs) && deadlineMs > 0;
  if (phase === "running" && keys === 3 && wholeInstant) {
    return { deadlineMs, on: true, phase };
  }
  return undefined;
}

/**
 * One command off the wire or out of a note's inbox file name.
 *
 * @param value what was sent
 * @returns the command, or `undefined` when it is not one
 */
export function parseTriageCommand({ value }: { value: unknown }): TriageCommand | undefined {
  if (value === "start" || value === "pause" || value === "resume" || value === "off") {
    return value;
  }
  return undefined;
}

/**
 * The words beside the menu bar icon: the time left on the card as `m:ss`, rounded up so `0:00` never shows while time
 * is left; `Time up` once the card's clock is spent and the owner has not ruled it; `Paused` while the owner has paused it;
 * `Triage` between cards; nothing at all while triage is off.
 *
 * @param report what the page last said
 * @param nowMs the instant drawn
 * @returns the menu bar title
 */
export function triageTitle({ report, nowMs }: { report: TriageClockReport; nowMs: number }): string {
  if (!report.on) {
    return "";
  }
  if (report.phase === "paused") {
    return "Paused";
  }
  if (report.phase === "between") {
    return "Triage";
  }
  const leftMs = report.deadlineMs - nowMs;
  if (leftMs <= 0) {
    return "Time up";
  }
  const seconds = Math.ceil(leftMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Whether the title changes by itself as time passes, so the shell redraws it every second: only while a card's clock
 * still has time left.
 *
 * @param report what the page last said
 * @param nowMs the instant now
 * @returns true while the countdown is moving
 */
export function triageTicking({ report, nowMs }: { report: TriageClockReport; nowMs: number }): boolean {
  return report.on && report.phase === "running" && report.deadlineMs > nowMs;
}

/** One triage item in the menu bar's menu. */
export interface TriageMenuItem {
  readonly label: string;
  readonly command: TriageCommand;
}

/**
 * The menu's triage items: `Start triage` while it is off; while it is on, the clock's pause or resume and the way out.
 *
 * @param report what the page last said
 * @returns the items, in menu order
 */
export function triageMenuItems({ report }: { report: TriageClockReport }): readonly TriageMenuItem[] {
  if (!report.on) {
    return [{ command: "start", label: "Start triage" }];
  }
  const off: TriageMenuItem = { command: "off", label: "Turn triage off" };
  if (report.phase === "paused") {
    return [{ command: "resume", label: "Resume timer" }, off];
  }
  return [{ command: "pause", label: "Pause timer" }, off];
}

/** The triage files under a home: the state the notes read, and the inbox their presses land in. */
export interface TriagePaths {
  readonly dir: string;
  readonly state: string;
  readonly commands: string;
}

/**
 * The triage files under the home the console reads, resolved as `pageReveal.ts` resolves pages:
 * `<home>/hand-steps/triage/state.json` and `<home>/hand-steps/triage/commands/`. The note's own half is
 * `src/hand/note/triagePaths.ts`.
 *
 * @param envHome the shell's `SLOPWEAVER_HOME`, as set
 * @param userHome the owner's own home directory
 * @returns the paths
 */
export function triagePathsOf({ envHome, userHome }: { envHome: string | undefined; userHome: string }): TriagePaths {
  const dir = join(shellHomeOf({ envHome, userHome }), "hand-steps", "triage");
  return { commands: join(dir, "commands"), dir, state: join(dir, "state.json") };
}

/** What a floating note reads: the page's report, and the instant the shell last wrote it. */
export interface TriageProjection {
  readonly on: boolean;
  readonly paused: boolean;
  readonly writtenMs: number;
}

/**
 * The file a floating note reads to decide whether to draw its two triage buttons. Rewritten every tick while triage is
 * on, so a shell that died leaves a file the note reads as stale rather than a pass that never ends.
 *
 * @param report what the page last said
 * @param nowMs the instant written
 * @returns the file's contents
 */
export function triageProjectionText({ report, nowMs }: { report: TriageClockReport; nowMs: number }): string {
  const projection: TriageProjection = {
    on: report.on,
    paused: report.on && report.phase === "paused",
    writtenMs: nowMs,
  };
  return `${JSON.stringify(projection)}\n`;
}

/** How old a note's press may be and still be acted on: older, it was pressed before this shell was listening. */
export const TRIAGE_COMMAND_FRESH_MS = 10_000;

/** A note's press, as its file is named: `<13-digit ms>-<uuid>.<command>`. */
const COMMAND_FILE = /^(\d{13})-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(pause|resume|off)$/u;

/**
 * A note's press, read off its file's name: the command, when it is one a note may send and was pressed recently.
 *
 * @param name the file's name in the inbox
 * @param nowMs the instant it is read
 * @returns the command, or `undefined` for anything else, a stale press included
 */
export function triageCommandFile({ name, nowMs }: { name: string; nowMs: number }): TriageCommand | undefined {
  const match = COMMAND_FILE.exec(name);
  if (match === null) {
    return undefined;
  }
  const pressedMs = Number(match[1]);
  if (Math.abs(nowMs - pressedMs) > TRIAGE_COMMAND_FRESH_MS) {
    return undefined;
  }
  return parseTriageCommand({ value: match[2] });
}
