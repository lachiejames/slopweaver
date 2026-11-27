/**
 * A Codex-hosted supervisor chair's owner turns, read off its rollout — the effectful shell around
 * `../codex/rolloutOwnerTurns.ts`, and the Codex counterpart of `./chairTranscript.ts`'s `readChairTranscript`.
 *
 * **The home is the recorded one, never a guess.** A Codex chair's pin and chain link carry the absolute
 * `CODEX_HOME` it ran under (`../cli/commands/cmux/recordPin.ts`); this reads that home's `sessions/` and nothing
 * else. A chair recorded with no home — one pinned before the field existed, or hosted by the desktop app, whose
 * pin is written from the session rather than the detection — is `CODEX_HOME_UNRECORDED`, and two links naming two
 * homes is `CODEX_HOME_CONFLICT`: picking one by precedence could read the wrong account's thread.
 *
 * **Every failure is named, none is an empty list.** A walk that passed over a place could have passed over the
 * chair's rollout, no matching file is not "no turns", and two files for one thread are refused rather than
 * concatenated, because one may replay the other's history and nothing on disk says how to deduplicate them. A
 * resume that APPENDS to the original file is one file and reads whole.
 *
 * **Owner turns only.** The rollout's peer traffic is not read here, and a reader says so (`./chain.ts`'s
 * `CODEX_CHAIR_PEER_TRAFFIC_UNREAD`).
 */
import { basename } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { isRolloutBasename } from "../codex/rolloutOwnerTurnPointer.js";
import { type CodexOwnerTurnParseError, rolloutOwnerTurnFold } from "../codex/rolloutOwnerTurns.js";
import { walkRollouts } from "../codex/rolloutWalk.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { codexThreadIdOfPath } from "../measurement/codexSessions.js";
import type { OwnerTurn } from "./intake.js";
import { sameSupervisorSession, supervisorSessionLabel, type VisibleSupervisorSession } from "./session.js";
import type { SupervisorLink } from "./supervisorLink.js";

/** Why a Codex chair's owner turns could not be read. */
export type CodexChairReadError =
  | { readonly code: "CODEX_HOME_UNRECORDED"; readonly message: string }
  | { readonly code: "CODEX_HOME_CONFLICT"; readonly message: string }
  | { readonly code: "CODEX_ROLLOUT_WALK_INCOMPLETE"; readonly message: string }
  | { readonly code: "CODEX_ROLLOUT_NOT_FOUND"; readonly message: string }
  | { readonly code: "CODEX_ROLLOUT_SPLIT"; readonly message: string }
  | { readonly code: "CODEX_ROLLOUT_UNREADABLE"; readonly message: string; readonly cause: unknown }
  | { readonly code: "CODEX_ROLLOUT_INVALID"; readonly message: string; readonly parse: CodexOwnerTurnParseError };

/** The factory, so every refusal carries the same words. */
export const CodexChairReadErrors = {
  homeConflict: ({ homes }: { homes: readonly string[] }): CodexChairReadError => ({
    code: "CODEX_HOME_CONFLICT",
    message: `its pin and chain links record ${String(homes.length)} different Codex homes, so which account's rollout is the chair's is not known`,
  }),
  homeUnrecorded: (): CodexChairReadError => ({
    code: "CODEX_HOME_UNRECORDED",
    message:
      "no Codex home is recorded for it (pinned before homes were recorded, from a process naming none, or hosted by the desktop app), so its rollout is UNREAD",
  }),
  invalid: ({ parse, rolloutName }: { parse: CodexOwnerTurnParseError; rolloutName: string }): CodexChairReadError => ({
    code: "CODEX_ROLLOUT_INVALID",
    message: `its rollout ${rolloutName} would not read whole (${parse.code}): ${parse.message}`,
    parse,
  }),
  notFound: (): CodexChairReadError => ({
    code: "CODEX_ROLLOUT_NOT_FOUND",
    message: "no rollout for its thread is under its recorded Codex home, so its owner turns are UNREAD",
  }),
  split: ({ count }: { count: number }): CodexChairReadError => ({
    code: "CODEX_ROLLOUT_SPLIT",
    message: `${String(count)} rollouts under its Codex home name its thread, and one may replay another, so neither is read`,
  }),
  unreadable: ({ cause, rolloutName }: { cause: unknown; rolloutName: string }): CodexChairReadError => ({
    cause,
    code: "CODEX_ROLLOUT_UNREADABLE",
    message: `its rollout ${rolloutName} would not open: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  walkIncomplete: ({ hiddenPlaces }: { hiddenPlaces: number }): CodexChairReadError => ({
    code: "CODEX_ROLLOUT_WALK_INCOMPLETE",
    message: `the walk of its Codex home's sessions passed over ${String(hiddenPlaces)} place(s), any of which could hold its rollout`,
  }),
} as const;

/**
 * The one Codex home recorded for a chair across every PIN link naming it, the live pin's included. Only a pin
 * records a home (`cmux pin`), and a scan link's tenure is never closed, so a home on a scan link is not read:
 * a scan-only Codex chair stays unrecorded and refuses rather than reading turns past another session's pin.
 *
 * @param session the Codex chair
 * @param links every chain link, and the pin as a link
 * @returns the home, or why there is not exactly one
 */
export function recordedChairCodexHome({
  session,
  links,
}: {
  session: VisibleSupervisorSession;
  links: readonly SupervisorLink[];
}): Result<string, CodexChairReadError> {
  const homes = [
    ...new Set(
      links
        .filter((link) => link.source === "pin" && sameSupervisorSession({ left: link.session, right: session }))
        .flatMap((link) => (link.codexHome === undefined ? [] : [link.codexHome])),
    ),
  ];
  const [only] = homes;
  if (only === undefined) {
    return err(CodexChairReadErrors.homeUnrecorded());
  }
  if (homes.length > 1) {
    return err(CodexChairReadErrors.homeConflict({ homes }));
  }
  return ok(only);
}

/** Whether a turn's instant is inside `[sinceIso, untilIso)`; an unreadable bound keeps it, as the Claude reader does. */
function inTenure({
  timestamp,
  sinceIso,
  untilIso,
}: {
  timestamp: string;
  sinceIso: string | undefined;
  untilIso: string | undefined;
}): boolean {
  const at = Date.parse(timestamp);
  const floor = sinceIso === undefined ? Number.NaN : Date.parse(sinceIso);
  const ceiling = untilIso === undefined ? Number.NaN : Date.parse(untilIso);
  const afterFloor = Number.isNaN(floor) || at >= floor;
  const beforeCeiling = Number.isNaN(ceiling) || at < ceiling;
  return afterFloor && beforeCeiling;
}

/**
 * The one rollout under a home naming a thread.
 *
 * @param codexHome the recorded home
 * @param threadId the chair's thread
 * @returns its path, or why there is not exactly one
 */
function chairRollout({
  codexHome,
  threadId,
}: {
  codexHome: string;
  threadId: string;
}): Result<string, CodexChairReadError> {
  const walk = walkRollouts({ codexHome });
  if (walk.hiddenPlaces > 0) {
    return err(CodexChairReadErrors.walkIncomplete({ hiddenPlaces: walk.hiddenPlaces }));
  }
  const matching = walk.candidates.filter(
    (candidate) => codexThreadIdOfPath({ homes: [codexHome], path: candidate.path }) === threadId,
  );
  const [only] = matching;
  if (only === undefined) {
    return err(CodexChairReadErrors.notFound());
  }
  if (matching.length > 1) {
    return err(CodexChairReadErrors.split({ count: matching.length }));
  }
  return ok(only.path);
}

/**
 * Read a Codex chair's owner turns inside its tenure.
 *
 * The tenure is applied only after the WHOLE rollout parsed: a line outside it that will not read still fails the
 * read, because judging its instant is what placing it outside would have needed.
 *
 * @param codexHome the chair's recorded Codex home, absolute
 * @param threadId the chair's thread id
 * @param sinceIso the floor, inclusive, or `undefined` for the whole rollout
 * @param untilIso the ceiling, exclusive — when a successor took the pin — or `undefined`
 * @returns the turns in file order, or the named failure
 */
export function readCodexChairOwnerTurns({
  codexHome,
  threadId,
  sinceIso,
  untilIso,
}: {
  codexHome: string;
  threadId: string;
  sinceIso: string | undefined;
  untilIso: string | undefined;
}): Result<readonly OwnerTurn[], CodexChairReadError> {
  const found = chairRollout({ codexHome, threadId });
  if (found.isErr()) {
    return err(found.error);
  }
  const rolloutName = basename(found.value);
  if (!isRolloutBasename({ name: rolloutName })) {
    return err(CodexChairReadErrors.notFound());
  }
  const fold = rolloutOwnerTurnFold({ rolloutName, threadId });
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line, index, byteOffset, undecodable }) => {
        fold.push({ byteOffset, line, lineNumber: index + 1, undecodable });
      },
      path: found.value,
      strictUtf8: true,
    });
  } catch (cause: unknown) {
    return err(CodexChairReadErrors.unreadable({ cause, rolloutName }));
  }
  const parsed = fold.finish();
  if (parsed.isErr()) {
    return err(CodexChairReadErrors.invalid({ parse: parsed.error, rolloutName }));
  }
  return ok(
    parsed.value
      .filter((turn) => inTenure({ sinceIso, timestamp: turn.timestamp, untilIso }))
      .map((turn): OwnerTurn => ({
        lineNumber: turn.lineNumber,
        pointer: turn.pointer,
        sessionId: supervisorSessionLabel({ session: { host: "codex", id: threadId } }),
        source: "unknown",
        text: turn.text,
        timestamp: turn.timestamp,
        turnUuid: turn.turnId,
      })),
  );
}

/**
 * A Codex chair's owner turns, the home resolved from its links first.
 *
 * @param session the Codex chair
 * @param links every chain link, and the pin as a link
 * @param sinceIso the floor, inclusive
 * @param untilIso the ceiling, exclusive
 * @returns the turns, or the named failure
 */
export function readRecordedCodexChair({
  session,
  links,
  sinceIso,
  untilIso,
}: {
  session: VisibleSupervisorSession;
  links: readonly SupervisorLink[];
  sinceIso: string | undefined;
  untilIso: string | undefined;
}): Result<readonly OwnerTurn[], CodexChairReadError> {
  return recordedChairCodexHome({ links, session }).andThen((codexHome) =>
    readCodexChairOwnerTurns({ codexHome, sinceIso, threadId: session.id, untilIso }),
  );
}
