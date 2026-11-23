/**
 * Rapid triage's half of the shell (`triageClock.ts` is the pure half). A visible
 * countdown beside the Slopweaver menu bar item while a triage runs, the menu bar as a second control beside the voice,
 * and two buttons on every floating note — pause timer, turn triage off — that exist only while triage mode is on.
 *
 * - **One page is the authority**: the voice's window, the only one that draws the Messenger and holds the call, so the
 *   only one that runs a pass. A report from any other window is refused, and its menu and note presses go to it alone.
 * - **The mirror ends with that page**: a reload or crash of the voice's window stops the pass there
 *   (`site/components/voice/useTriageWalk.ts`), so `retireTriage` turns the countdown off with it. A same-document move
 *   — the Queue opening each card — is not a new page and leaves it standing.
 * - **The notes read a file, never the shell**: `hand-steps/triage/state.json`, rewritten every tick while triage is
 *   on, so a shell that died leaves a file the note reads as stale. A note's press is a file in
 *   `hand-steps/triage/commands/`, taken only once the voice's page has reported, and removed once sent; that page's
 *   preload holds it until the page's listener takes it (`preload.ts` `onTriageCommand`).
 */
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type IpcMainEvent, ipcMain, type MenuItemConstructorOptions, type WebContents } from "electron";

import {
  parseTriageClockReport,
  TRIAGE_OFF,
  type TriageClockReport,
  type TriageCommand,
  triageCommandFile,
  triageMenuItems,
  triagePathsOf,
  triageProjectionText,
  triageTicking,
  triageTitle,
} from "./triageClock";

/** How often, while triage is on, the countdown is redrawn, the notes' file rewritten and their presses read. */
const TRIAGE_TICK_MS = 500;

/** What the triage shell needs of the rest of the app. */
export interface TriageHost {
  /** Whether a message came from the voice's window, on the console, from its top frame. */
  readonly fromOverlay: (input: { readonly event: IpcMainEvent }) => boolean;
  /** The voice's page, once it is listening for commands; `undefined` before it first reports or after it went. */
  readonly listeningOverlay: () => WebContents | undefined;
  /** Bring the voice up and the console window forward on the Queue, for a start the owner pressed. */
  readonly showForStart: () => void;
  /** Redraw the whole menu bar menu, after the items changed. */
  readonly redrawTray: () => void;
  /** Set the words beside the menu bar icon. */
  readonly setTitle: (input: { readonly title: string }) => void;
}

let host: TriageHost | undefined;
let report: TriageClockReport = TRIAGE_OFF;
let tick: NodeJS.Timeout | undefined;
/** The owner pressed Start triage before the voice's page was listening: sent when it first does. */
let pendingStart = false;
/** Why the notes' inbox could not be read, shown in the menu until a read works again. */
let inboxProblem: string | undefined;
/** Why the notes' file could not be written, shown in the menu until a write works again. */
let projectionProblem: string | undefined;
const paths = triagePathsOf({ envHome: process.env["SLOPWEAVER_HOME"], userHome: homedir() });

/**
 * Write the notes' file from the report now, atomically, readable by the owner alone. Their inbox exists only while triage is
 * on, so nothing dropped while it is off waits there.
 */
function writeProjection(): void {
  const temporary = `${paths.state}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(dirname(paths.state), { mode: 0o700, recursive: true });
    if (report.on) {
      mkdirSync(paths.commands, { mode: 0o700, recursive: true });
    }
    writeFileSync(temporary, triageProjectionText({ nowMs: Date.now(), report }), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, paths.state);
    if (projectionProblem !== undefined) {
      projectionProblem = undefined;
      host?.redrawTray();
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const problem = `Triage buttons on notes are off: ${detail}`;
    if (projectionProblem !== problem) {
      projectionProblem = problem;
      host?.redrawTray();
    }
  }
}

/**
 * Send the voice's page one command, once it has reported. Its preload holds the command until the page's listener
 * takes it (`preload.ts` `onTriageCommand`), so a page between listeners loses nothing.
 *
 * @param command what to do
 * @returns true when it was sent
 */
function sendCommand({ command }: { command: TriageCommand }): boolean {
  const contents = host?.listeningOverlay();
  if (contents === undefined || contents.isDestroyed()) {
    return false;
  }
  contents.send("slopweaver:triage-command", command);
  return true;
}

/**
 * Every note press handed over, by file name, kept while that name is still fresh enough to be handed over or its
 * file is still there: a name written again is removed unsent, and a file that could not be removed is
 * never sent again, even once a wall clock moved back makes its name read fresh.
 */
const handed = new Set<string>();

/** Take every fresh note press waiting, in the order pressed; a stale, foreign or already handed file is removed unread. */
function takeNotePresses(): void {
  let names: string[];
  try {
    names = readdirSync(paths.commands).toSorted();
  } catch (cause) {
    // No inbox yet is expected, as no note has been pressed since it was made; anything else is shown in the menu.
    const missing = cause instanceof Error && "code" in cause && cause.code === "ENOENT";
    showInboxProblem({ problem: missing ? undefined : `Triage buttons on notes cannot be read: ${String(cause)}` });
    return;
  }
  const listed = new Set(names);
  const nowMs = Date.now();
  for (const name of handed) {
    if (!listed.has(name) && triageCommandFile({ name, nowMs }) === undefined) {
      handed.delete(name);
    }
  }
  let removalProblem: string | undefined;
  for (const name of names) {
    // The clock is read per file, after the listing, so the time a read takes never counts toward a press's freshness.
    const command = triageCommandFile({ name, nowMs: Date.now() });
    // A press waits in its file until the page is listening; one that went stale is dropped, as a press the owner made
    // before this shell could act on it.
    if (command !== undefined && !handed.has(name)) {
      if (!sendCommand({ command })) {
        continue;
      }
      handed.add(name);
    }
    const problem = removeProblem({ path: join(paths.commands, name) });
    if (problem !== undefined) {
      removalProblem = problem;
    }
  }
  showInboxProblem({ problem: removalProblem });
}

/**
 * Remove one path from the notes' inbox, never throwing out of the tick.
 *
 * @param path the file or directory to remove
 * @returns the menu line saying why it could not be removed, or `undefined` once it is gone
 */
function removeProblem({ path }: { path: string }): string | undefined {
  try {
    rmSync(path, { force: true, recursive: true });
    return undefined;
  } catch (cause) {
    // Shown in the menu rather than thrown: an exception from the timer would take the shell's main process down.
    return `Triage buttons on notes cannot be cleared: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

/**
 * Show why the notes' inbox cannot be read in the menu, or clear that line once it can.
 *
 * @param problem the line to show, `undefined` to clear it
 */
function showInboxProblem({ problem }: { problem: string | undefined }): void {
  if (inboxProblem !== problem) {
    inboxProblem = problem;
    host?.redrawTray();
  }
}

/** Remove the notes' inbox and everything in it; a failure is shown in the menu, never thrown. */
function emptyInbox(): void {
  showInboxProblem({ problem: removeProblem({ path: paths.commands }) });
}

/** One tick: the countdown, the notes' file and the notes' presses. */
function onTick(): void {
  host?.setTitle({ title: triageTitle({ nowMs: Date.now(), report }) });
  writeProjection();
  takeNotePresses();
}

/** Run the tick while triage is on, and stop it while off. */
function scheduleTick(): void {
  if (report.on && tick === undefined) {
    tick = setInterval(onTick, TRIAGE_TICK_MS);
  }
  if (!report.on && tick !== undefined) {
    clearInterval(tick);
    tick = undefined;
  }
}

/**
 * Take a new report: redraw the menu bar now, and the notes' file with it.
 *
 * @param next what the voice's page says now
 */
function applyReport({ next }: { next: TriageClockReport }): void {
  // Triage turning on or off empties the notes' inbox, so a file left there while it was off is never handed over.
  if (next.on !== report.on) {
    emptyInbox();
  }
  report = next;
  host?.setTitle({ title: triageTitle({ nowMs: Date.now(), report }) });
  host?.redrawTray();
  writeProjection();
  scheduleTick();
}

/**
 * Start the triage shell: the notes' file says off and their inbox is emptied, so nothing from a shell before this one
 * is acted on, and the voice's page may report from now.
 *
 * @param triageHost what it needs of the rest of the app
 */
export function startTriageShell({ triageHost }: { triageHost: TriageHost }): void {
  host = triageHost;
  emptyInbox();
  writeProjection();
  ipcMain.on("slopweaver:triage-clock", (event, value: unknown) => {
    const next = parseTriageClockReport({ value });
    if (next !== undefined && triageHost.fromOverlay({ event })) {
      applyReport({ next });
    }
  });
}

/** The voice's page is listening for commands: a start the owner pressed before it was goes now. */
export function triageOverlayListening(): void {
  if (pendingStart && sendCommand({ command: "start" })) {
    pendingStart = false;
  }
}

/** The voice's page is gone — reloaded, navigated away or crashed — and its pass stopped with it. */
export function retireTriage(): void {
  if (report.on) {
    applyReport({ next: TRIAGE_OFF });
  }
}

/** The app is quitting: the notes' file says off, so no note offers a button that reaches nothing. */
export function stopTriageShell(): void {
  report = TRIAGE_OFF;
  scheduleTick();
  emptyInbox();
  writeProjection();
}

/**
 * The words beside the menu bar icon now.
 *
 * @returns the countdown, or nothing while triage is off
 */
export function triageTrayTitle(): string {
  return triageTitle({ nowMs: Date.now(), report });
}

/**
 * Whether the countdown moves by itself now (the tick redraws it).
 *
 * @returns true while a card's clock has time left
 */
export function triageTrayTicking(): boolean {
  return triageTicking({ nowMs: Date.now(), report });
}

/**
 * The menu bar menu's triage items: start while off, pause or resume and off while on, and a line when the notes'
 * file cannot be written.
 *
 * @returns the items, in menu order
 */
export function triageTrayItems(): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = triageMenuItems({ report }).map(({ command, label }) => ({
    click: () => {
      if (command !== "start") {
        sendCommand({ command });
        return;
      }
      startedHost().showForStart();
      if (!sendCommand({ command })) {
        pendingStart = true;
      }
    },
    label,
  }));
  for (const problem of [projectionProblem, inboxProblem]) {
    if (problem !== undefined) {
      items.push({ enabled: false, label: problem });
    }
  }
  return items;
}

/**
 * The host, which exists once the shell is started; a menu is only drawn after that.
 *
 * @returns the host
 */
function startedHost(): TriageHost {
  if (host === undefined) {
    throw new Error("the triage shell was not started before its menu was drawn");
  }
  return host;
}
