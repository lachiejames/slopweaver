/**
 * One line of the intake ledger, both ways: decoding a stored mark and building a new one. `./intake.ts` holds the
 * mark's shape and the check that reads marks; this is the codec, so the pointer forms a mark may name and the
 * writer it records are judged in one place for the reader and the writer alike.
 *
 * Pure: text in, a mark out.
 */
import { formatCodexRolloutPointer, parseCodexRolloutPointer } from "../codex/rolloutOwnerTurnPointer.js";
import { isRecord } from "../lib/parsers.js";
import { parseRelayAnchor } from "../talk/relayDraft.js";
import { parseCallPointer } from "../talk/unreadWords.js";
import { formatTurnPointer, parseTurnPointer } from "../transcripts/pointer.js";
import { INTAKE_MARK_KINDS, type IntakeMark, type IntakeMarkKind } from "./intake.js";
import { claudeSessionIdOf, parseVisibleSession, type VisibleSupervisorSession } from "./session.js";

/**
 * Read one ledger line, refusing anything that is not completely a mark.
 *
 * @param line one line of the journal
 * @returns the mark, or `undefined` for a blank, malformed or incomplete line
 */
export function parseIntakeMarkLine({ line }: { line: string }): IntakeMark | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const pointer = parsed["pointer"];
  const kind = parsed["kind"];
  const witness = parsed["witness"];
  const markedAtIso = parsed["markedAtIso"];
  const byClaudeSessionId = parsed["byClaudeSessionId"];
  const knownKind = INTAKE_MARK_KINDS.find((known) => known === kind);
  if (
    typeof pointer !== "string" ||
    knownKind === undefined ||
    typeof witness !== "string" ||
    typeof markedAtIso !== "string" ||
    typeof byClaudeSessionId !== "string"
  ) {
    return undefined;
  }
  const writer = markWriterOf({ byClaudeSessionId, value: parsed["bySession"] });
  if (writer === undefined) {
    return undefined;
  }
  // Read back in the form the writer stores, so a hand-written spelling of one turn is the same turn to every
  // reader (an upper-case relay anchor is a re-mark the reuse gate refuses). An unparseable pointer
  // stays as written — it matches nothing, as before.
  let stored = pointer;
  const normalised = normalisedTurnPointer({ pointer });
  if (normalised !== undefined) {
    stored = normalised;
  }
  return { byClaudeSessionId, kind: knownKind, markedAtIso, pointer: stored, witness: witness.trim(), ...writer };
}

/**
 * A mark's `bySession`, judged against its `byClaudeSessionId`: absent stays absent, and a present one must be a
 * visible session that agrees with the Claude id — a Claude writer naming the same id, a Codex writer beside an empty
 * one. A line whose two fields disagree is refused rather than attributed by precedence.
 *
 * @param byClaudeSessionId the row's Claude id
 * @param value the row's `bySession`, as decoded
 * @returns the field to spread in, or `undefined` when the line is refused
 */
function markWriterOf({
  byClaudeSessionId,
  value,
}: {
  byClaudeSessionId: string;
  value: unknown;
}): { readonly bySession?: VisibleSupervisorSession } | undefined {
  if (value === undefined) {
    return {};
  }
  const session = parseVisibleSession({ value });
  if (session === undefined) {
    return undefined;
  }
  const agrees = session.host === "claude-code" ? session.id === byClaudeSessionId : byClaudeSessionId === "";
  return agrees ? { bySession: session } : undefined;
}

/** A turn pointer in the one form a mark stores, or `undefined` when it is not one of the four forms. */
function normalisedTurnPointer({ pointer }: { pointer: string }): string | undefined {
  const parsed = parseTurnPointer({ text: pointer });
  if (parsed !== undefined) {
    return formatTurnPointer({ pointer: parsed });
  }
  // Surrounding whitespace is a typing slip; the pointer itself has exactly one spelling, case included.
  const codex = parseCodexRolloutPointer({ text: pointer.trim() });
  if (codex !== undefined) {
    return formatCodexRolloutPointer({ pointer: codex });
  }
  const relay = parseRelayAnchor({ text: pointer });
  if (relay !== undefined) {
    return relay;
  }
  return parseCallPointer({ text: pointer });
}

/**
 * Every decodable mark in a journal, in file order.
 *
 * @param text the whole journal
 * @returns the marks; a line that will not decode is skipped rather than failing the read
 */
export function parseIntakeMarkJournal({ text }: { text: string }): readonly IntakeMark[] {
  return text
    .split("\n")
    .map((line) => parseIntakeMarkLine({ line }))
    .filter((mark): mark is IntakeMark => mark !== undefined);
}

/**
 * Build one mark, refusing a pointer that is not a turn pointer or a witness that says nothing.
 *
 * Four pointer forms mark a turn: an owner turn in a Claude supervisor transcript, one in a Codex chair's rollout
 * (`codex-rollout:<thread>#<rollout>@<offset>`), a voice relay's `talk:<turnId>` — the owner's word that reached the
 * board without reaching the chat (`../talk/relayIntake.ts`) — and a stretch of their speech on a call,
 * `talk-call:<callId>#<segmentId>`, which `talk unread` prints whether or not it was relayed.
 *
 * @param pointer the turn being marked, in pointer form
 * @param kind what the turn became
 * @param witness the checkable thing behind the mark
 * @param markedAtIso when it is being written
 * @param bySession the visible session writing it, or `undefined` when the process runs in none
 * @returns the mark, or the one-line refusal
 */
export function buildIntakeMark({
  pointer,
  kind,
  witness,
  markedAtIso,
  bySession,
}: {
  pointer: string;
  kind: IntakeMarkKind;
  witness: string;
  markedAtIso: string;
  bySession: VisibleSupervisorSession | undefined;
}): { readonly mark: IntakeMark } | { readonly refusal: string } {
  const normalised = normalisedTurnPointer({ pointer });
  if (normalised === undefined) {
    return {
      refusal: `${pointer} is not a turn pointer — the form is transcript:<sessionId>#<turnUuid>, codex-rollout:<thread>#<rollout>@<offset>, talk:<turnId> or talk-call:<callId>#<segmentId>`,
    };
  }
  if (witness.trim().length === 0) {
    return {
      refusal: "--witness is required — the card's question, where the answer went, or why the turn asked for nothing",
    };
  }
  // A mark no Claude Code session wrote carries "" there, as one written outside any session always has.
  let byClaudeSessionId = "";
  const claudeId = claudeSessionIdOf({ session: bySession });
  if (claudeId !== undefined) {
    byClaudeSessionId = claudeId;
  }
  return {
    mark: {
      byClaudeSessionId,
      kind,
      markedAtIso,
      pointer: normalised,
      witness: witness.trim(),
      ...(bySession === undefined ? {} : { bySession }),
    },
  };
}
