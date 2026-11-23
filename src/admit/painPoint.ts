/**
 * PAIN POINTS — a ledger of friction the door counted rather than felt-and-forgotten, written by CODE.
 *
 * `$SLOPWEAVER_HOME/ledgers/loop-breakage.jsonl` already exists for this, in spirit: the owner asked for
 * "a ledger somewhere, a list of pain points counted throughout the day". But when this file was written, that
 * one was written BY HAND — `skills/loop/SKILL.md` instructed an agent to run a `printf >>` — and it had four
 * rows in two days. That is not a low rate of friction, it is an under-recording ledger BY CONSTRUCTION: the
 * agent who is supposed to stop and write a row is mid-turn, with every incentive to keep going and none to
 * interrupt itself. A ledger whose only writer is a distracted party will always undercount, no matter how
 * real the friction was. (That diagnosis is why the loop ledger now has code writers per class and a required
 * cause on the residue — `live/turn/breakageClasses.ts`.)
 *
 * This file is a SIBLING, not an extension of that one, on purpose: `loop-breakage.jsonl` records what broke
 * in a loop turn, and this ledger's count is real precisely
 * because nothing has to remember to write it — the as-me Slack shell calls {@link recordPainPoint} whenever
 * a configured exact voice rule matches, with no agent turn in the loop to skip it.
 *
 * Same pure-record / effectful-write split as `ledger.ts`: {@link painPointLine} is pure and deterministic
 * (the timestamp is injected, never read from a clock in here); {@link recordPainPoint} is the thin effectful
 * append. And the same "audit without dumping the artifact" property: a row carries the field PATH and the
 * rule that fired, never the authored prose — a ledger is a record of what happened, not a copy of what was
 * said, the same rule `doorDecisionRecord` follows and for the same reason.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { logger } from "../lib/logger.js";
import { isRecord } from "../lib/parsers.js";
import { type ExactVoiceRuleFinding, voiceRuleLabel } from "../outbound/voice/exactRules.js";
import { stateHomePaths } from "../stateHome.js";

/** Which name the attempted send would use. */
export type PainPointLane = "as-me" | "as-bot";

/**
 * What kind of pain point a row records. Starts with just `voice` — the only kind anything in this repo
 * emits today. A category nobody emits is a category nobody can verify, so a new one is added only alongside
 * the code that produces it.
 */
type PainPointKind = "voice";

/**
 * One row: what fired, where, and why — never the prose itself. `tsIso` and `reason` are free text, but
 * `reason` is policy prose a judgement in this repo authored (like `DoorFinding.summary`), not the artifact.
 */
export interface PainPoint {
  /** When the pain point was recorded. */
  readonly tsIso: string;
  /** Which kind of pain point this is (see {@link PainPointKind}). */
  readonly kind: PainPointKind;
  /** Which name the send was posted under. */
  readonly lane: PainPointLane;
  /** The form field path the rule fired against — never the field's text. */
  readonly fieldPath: string;
  /** Why the rule fired, in the judgement's own words. */
  readonly reason: string;
}

/**
 * Build the one JSONL line for a pain point. Pure + deterministic — `point.tsIso` is injected, never read
 * from a clock here, exactly like `doorDecisionRecord`'s `tsIso`.
 *
 * @param point the pain point to render
 * @returns the JSON line (no trailing newline)
 */
export function painPointLine({ point }: { point: PainPoint }): string {
  return JSON.stringify({
    fieldPath: point.fieldPath,
    kind: point.kind,
    lane: point.lane,
    reason: point.reason,
    schemaVersion: 1,
    tsIso: point.tsIso,
  });
}

/** One parsed pain-point row. */
export interface PainPointEntry {
  readonly tsIso: string;
  readonly kind: PainPointKind;
  readonly lane: PainPointLane;
  readonly fieldPath: string;
  readonly reason: string;
}

/** Whether a parsed value is a known {@link PainPointKind}. Pure. */
function isPainPointKind(value: unknown): value is PainPointKind {
  return value === "voice";
}

/** Whether a parsed value is a known {@link PainPointLane}. Pure. */
function isPainPointLane(value: unknown): value is PainPointLane {
  return value === "as-me" || value === "as-bot";
}

/**
 * Parse the ledger text into rows. Tolerant by design: a blank or malformed
 * line, or a row missing a field, is SKIPPED rather than fatal — a corrupt audit line must not break a send,
 * and skipping only ever loses a count, never invents one. Pure.
 *
 * @param text the raw `pain-points.jsonl` contents
 * @returns the parsed rows, in file order
 */
export function parsePainPoints({ text }: { text: string }): readonly PainPointEntry[] {
  const entries: PainPointEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !isPainPointKind(parsed["kind"]) || !isPainPointLane(parsed["lane"])) {
      continue;
    }
    const { tsIso, fieldPath, reason } = parsed;
    if (typeof tsIso === "string" && typeof fieldPath === "string" && typeof reason === "string") {
      entries.push({ fieldPath, kind: parsed["kind"], lane: parsed["lane"], reason, tsIso });
    }
  }
  return entries;
}

/** Maximum number of recent, distinct pain points exposed to one visible turn. */
const RECENT_PAIN_POINT_GUIDANCE_LIMIT = 5;

/**
 * Render bounded, distinct composition guidance from the pain-point ledger.
 *
 * Newest entries win and duplicate rule/path pairs collapse. The bounded list is deliberate: these are
 * guardrails below the fold, never a growing wall that crowds the actual question out of the turn brief.
 *
 * @param entries parsed ledger entries in file order
 * @param limit maximum distinct entries to render
 * @returns no lines when the ledger is empty, otherwise a short guidance section
 */
export function painPointGuidanceLines({
  entries,
  limit = RECENT_PAIN_POINT_GUIDANCE_LIMIT,
}: {
  entries: readonly PainPointEntry[];
  limit?: number;
}): readonly string[] {
  if (limit <= 0) {
    return [];
  }
  const seen = new Set<string>();
  const recent: PainPointEntry[] = [];
  for (const entry of entries.toReversed()) {
    const identity = `${entry.lane}\u0000${entry.fieldPath}\u0000${entry.reason}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      recent.push(entry);
    }
    if (recent.length >= limit) {
      break;
    }
  }
  return recent.length === 0
    ? []
    : [
        "RECENT VOICE PAIN POINTS — avoid repeating these exact misses:",
        ...recent.map((entry) => `  - ${entry.reason} (${entry.lane}, ${entry.fieldPath})`),
      ];
}

/**
 * Read the pain-point ledger's raw text. An absent ledger (a home that has never recorded one) is the empty
 * string, not an error. Effectful edge over {@link parsePainPoints}.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the ledger contents, or `""` when there is no ledger yet
 */
export function readPainPointsText({ home }: { home?: string } = {}): string {
  const ledgers = stateHomePaths(home !== undefined ? { home } : {}).ledgers;
  try {
    return readFileSync(join(ledgers, "pain-points.jsonl"), "utf8");
  } catch {
    return "";
  }
}

/**
 * Append a pain point to `$SLOPWEAVER_HOME/ledgers/pain-points.jsonl`, creating the ledgers dir if needed.
 * Effectful edge over {@link painPointLine}. This — never a hand-run `printf` — is the writer, so the count
 * is real: see the module comment.
 *
 * ## It NEVER throws, and that is the one place this repo's fail-loud rule is deliberately inverted
 *
 * The Slack shell records a match before deciding whether a named override admits the send. So an append left to
 * throw here — a read-only home, a full disk — would replace an actionable voice-rule result with
 * an unrelated filesystem failure. The exact rule still decides the send; the observation ledger never does.
 *
 * So a write failure is reported LOUDLY through the logger and swallowed as a return value. Loud in the log,
 * invisible to the send decision. Swallowing it silently would be the under-recording this ledger exists to
 * fix, and rethrowing it would be the blocking the ruling exists to prevent; the only honest option left is
 * to be noisy about it somewhere that is not the send path.
 *
 * ## It counts ATTEMPTED sends, not delivered ones
 *
 * The sink fires before the door and the Slack API, so a refused exact rule, a later duplicate claim, or a
 * network failure can still leave a row. That is the intended reading: a voice problem is a problem with
 * what was COMPOSED, and it is worth counting whether or not the send ultimately landed.
 *
 * @param point the pain point to append
 * @param home the state home (defaults to the resolved home)
 * @returns whether the row was written, and the reason it was not
 */
export function recordPainPoint({
  point,
  home,
}: {
  point: PainPoint;
  home?: string;
}): { readonly written: true } | { readonly written: false; readonly why: string } {
  const ledgers = stateHomePaths(home !== undefined ? { home } : {}).ledgers;
  try {
    mkdirSync(ledgers, { recursive: true });
    appendLines({ path: join(ledgers, "pain-points.jsonl"), text: `${painPointLine({ point })}\n` });
    return { written: true };
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    logger.error({
      msg: `could not append a pain point to the ledger under ${ledgers}: ${why} — the send is NOT blocked by this, but the day's count is now short by one`,
    });
    return { why, written: false };
  }
}

/**
 * Record every configured exact-rule match without copying the attempted message into the ledger.
 *
 * The configured rule value is retained because it is the actionable thing a later turn should avoid; the
 * authored field text is not. {@link recordPainPoint} owns the deliberate non-throwing write boundary.
 *
 * ## The lane is a PARAMETER, and it had been a constant
 *
 * `PainPointLane` has carried `"as-bot"` since it was declared and nothing had ever written one, because
 * this function pinned `"as-me"`. So `painPointGuidanceLines` — which feeds the composing brief — could only
 * ever learn from the operator's own lane, while the bot lane, which is where the measured em-dash leak
 * actually lives, contributed nothing to the brief that composes it. Every caller names its own lane now.
 *
 * @param home the state home holding the pain-point ledger
 * @param findings exact-rule matches over validated authored prose
 * @param lane which name the send that produced these findings was going out under
 * @param tsIso the injected observation instant shared by this attempted send
 * @returns nothing
 */
export function recordExactVoicePainPoints({
  home,
  findings,
  lane,
  tsIso,
}: {
  home: string;
  findings: readonly ExactVoiceRuleFinding[];
  lane: PainPointLane;
  tsIso: string;
}): void {
  for (const finding of findings) {
    recordPainPoint({
      home,
      point: {
        fieldPath: finding.path,
        kind: "voice",
        lane,
        reason: `authored prose ${voiceRuleLabel({ rule: finding.rule })}`,
        tsIso,
      },
    });
  }
}
