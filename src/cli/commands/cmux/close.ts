/**
 * `slopweaver cmux close` — close one named workspace through the session harness, which forces past cmux
 * 0.65.2's running-process confirmation only on a screen proving Claude Code or Codex idle at its prompt, then
 * reap what its worktree left.
 */
import { err, ok, type Result } from "#lib/result.js";
import { logger } from "../../../lib/logger.js";
import { closeAbsentAppRow } from "../../../sessionHarness/absentAppClose.js";
import { cmuxWorkspaceFromSession } from "../../../sessionHarness/cmuxSession.js";
import type { SessionHarnessError } from "../../../sessionHarness/errors.js";
import { type HarnessName, parseHarnessFlag, withNamedSessionHarness } from "../../../sessionHarness/harnessChoice.js";
import type { HarnessCloseHold, SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { appendSessionEvent, readSessionLogText } from "../../../sessions/sessionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { cmuxUsage, parseCmuxVerb, stringFlag, workspaceOperand } from "./core.js";
import { openSessionKeyFor } from "./run.js";
import { type ResidueReport, reapClosedSeat, renderResidueReport } from "./worktreeResidue.js";

/** How the close ended when the harness did not fail it: closed and reaped, or held open. */
type CloseAndReap =
  | {
      readonly kind: "closed";
      readonly ref: string;
      readonly sessionKey: string | undefined;
      readonly residue: ResidueReport;
    }
  | { readonly kind: "held"; readonly ref: string; readonly reason: HarnessCloseHold };

/** A reap that had no seat to look at: what an app session's close reports. */
const EMPTY_RESIDUE: ResidueReport = { refusal: null, seats: [] };

/**
 * Resolve, close and reap over ONE open harness, so the post-close list is read on the same connection the
 * close went through. A held close is neither reaped nor its ledger row touched.
 */
async function closeAndReap({
  harness,
  harnessName,
  home,
  workspaceRef,
}: {
  harness: SessionHarness;
  harnessName: HarnessName;
  home: string | undefined;
  workspaceRef: string;
}): Promise<Result<CloseAndReap, SessionHarnessError>> {
  const resolved = await harness.resolve({ handle: workspaceRef });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const { session } = resolved.value;
  const shut = await harness.close({ target: resolved.value });
  if (shut.isErr()) {
    return err(shut.error);
  }
  if (shut.value.kind === "held") {
    return ok({ kind: "held", reason: shut.value.reason, ref: session.handle });
  }
  // The residue reap reads cmux's workspaces to tell a closed seat's leftovers from a live one's; an app session's
  // process group is ended by the app itself, so there is nothing of its own left to reap here.
  if (harnessName === "app") {
    return ok({
      kind: "closed",
      ref: session.handle,
      residue: EMPTY_RESIDUE,
      sessionKey: openSessionKeyFor({ home, workspaceRef: session.handle }),
    });
  }
  const reaped = await reapClosedSeat({
    client: {
      listWorkspaces: async () =>
        (await harness.list()).map((sessions) => sessions.map((live) => cmuxWorkspaceFromSession({ session: live }))),
    },
    currentDirectory: session.directory,
    home: resolveHome({ named: home }),
    ref: session.handle,
    sessionKeyFor: ({ workspaceRef: ref }) => openSessionKeyFor({ home, workspaceRef: ref }),
    workspaceId: session.id,
  });
  return ok({ kind: "closed", ...reaped });
}

/**
 * `cmux close --via-card`: press the app session's own card Stop, as its owner would, and wait for the card's stop.
 * That stop closes through this verb (`desktop/src/sessionStopRequests.ts`'s `stopFromCard`), which records the
 * ledger's close, so this outer call records nothing itself and has no seat to reap.
 *
 * @param harnessName the harness the caller named; only the app draws a card
 * @param workspaceRef the session's handle
 * @returns the process exit code
 */
async function closeViaCard({
  harnessName,
  workspaceRef,
}: {
  harnessName: HarnessName;
  workspaceRef: string;
}): Promise<number> {
  if (harnessName !== "app") {
    logger.error({ msg: "cmux close: --via-card presses an app session's card Stop, so it needs --harness app" });
    logger.error({ msg: cmuxUsage({ verb: "close" }) });
    return EXIT_USAGE;
  }
  const pressed = await withNamedSessionHarness({
    body: async ({ harness }) => {
      const resolved = await harness.resolve({ handle: workspaceRef });
      if (resolved.isErr()) {
        return err(resolved.error);
      }
      return (await harness.pressStop({ target: resolved.value })).map(() => resolved.value.session.handle);
    },
    name: harnessName,
  });
  if (pressed.isErr()) {
    logger.error({ msg: `cmux close: ${pressed.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux close: pressed the card's Stop on ${pressed.value}, and the card's stop finished` });
  return EXIT_OK;
}

/**
 * A failed close's exit code. The one failure that still ends a row is the app proving the session gone while the
 * operand names exactly one open app row (`../../../sessionHarness/absentAppClose.ts`); every other failure keeps its error and writes
 * nothing.
 *
 * @returns the process exit code
 */
function closeFailed({
  error,
  harnessName,
  home,
  workspaceRef,
}: {
  error: SessionHarnessError;
  harnessName: HarnessName;
  home: string | undefined;
  workspaceRef: string;
}): number {
  const homeArg = home === undefined ? {} : { home };
  const gone = closeAbsentAppRow({
    deps: {
      append: ({ event }) => {
        appendSessionEvent({ event, ...homeArg });
      },
      nowIso: () => new Date().toISOString(),
      rows: () => foldSessions({ events: parseSessionLog({ text: readSessionLogText(homeArg) }).events }),
    },
    error,
    handle: workspaceRef,
    harness: harnessName,
  });
  if (gone !== undefined) {
    logger.out({ line: gone });
    return EXIT_OK;
  }
  logger.error({ msg: `cmux close: ${error.message}` });
  return EXIT_ERROR;
}

/**
 * `cmux close` — close a cmux workspace once its work has landed, then reap the node processes its worktree
 * left running (a detached nx daemon outlives the seat that started it). The reap is
 * `./worktreeResidue.ts`'s, over the same connection, and never fails the close: it prints what it did. When
 * cmux refuses the close for a running process, it forces once only if the screen proves Claude Code or Codex
 * idle at its prompt, and otherwise holds the workspace open and exits 1 (`../../../sessions/closeForce.ts`).
 * Under `--harness app`, a session the app answers `SESSION_NOT_FOUND` for is already gone: its exact open ledger
 * row is closed and the verb exits 0 (`../../../sessionHarness/absentAppClose.ts`).
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxClose(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "close" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const workspaceRef = workspaceOperand({ parsed, precedence: "positional" });
  if (workspaceRef === undefined) {
    logger.error({ msg: "cmux close: a workspace ref or id is required" });
    logger.error({ msg: cmuxUsage({ verb: "close" }) });
    return EXIT_USAGE;
  }
  const harnessName = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed }) });
  if (harnessName.isErr()) {
    logger.error({ msg: `cmux close: ${harnessName.error}` });
    logger.error({ msg: cmuxUsage({ verb: "close" }) });
    return EXIT_USAGE;
  }
  const home = stringFlag({ name: "home", parsed });
  if (parsed.values["via-card"] === true) {
    return closeViaCard({ harnessName: harnessName.value, workspaceRef });
  }
  const closed = await withNamedSessionHarness({
    body: ({ harness }) => closeAndReap({ harness, harnessName: harnessName.value, home, workspaceRef }),
    name: harnessName.value,
  });
  if (closed.isErr()) {
    return closeFailed({ error: closed.error, harnessName: harnessName.value, home, workspaceRef });
  }
  if (closed.value.kind === "held") {
    logger.error({
      msg: `cmux close: held ${closed.value.ref} — cmux wants force for its running process, and its screen does not prove Claude Code or Codex idle at a prompt (${closed.value.reason}); workspace left open`,
    });
    return EXIT_ERROR;
  }
  const { ref, residue, sessionKey } = closed.value;
  if (sessionKey !== undefined) {
    appendSessionEvent({
      event: { kind: "closed", sessionKey, tsIso: new Date().toISOString(), workspaceRef: ref },
      ...(home === undefined ? {} : { home }),
    });
  }
  logger.out({ line: `cmux close: closed ${ref}` });
  renderResidueReport({ dryRun: false, report: residue, verb: "cmux close" }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const cmuxCloseCommand = defineCommand({ run: runCmuxClose });
