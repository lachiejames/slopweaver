/**
 * Class 2 of the sanctioned-verb-guard-enforcement ruling: a SANCTIONED CLI verb invoked without its
 * owning skill's contract in context. Unlike class 1 (a raw `gh`/`git`/`curl` call bypassing the door —
 * see `../admit/rawTools.ts`), the command here is already the right one; the gap is missing context, not
 * a wrong door. A hard block would be the wrong shape for that gap — see this module's own header in the
 * handover doc this shipped from for why a block was rejected in favour of a reminder.
 *
 * This is the pure core: which verbs are governed, and the per-session dedup state that decides whether a
 * reminder is still owed. `skillReminderEffects.ts` is the thin effectful shell (file I/O + the actual
 * print) that `cli/main.ts` calls after resolving a route and before running it.
 */
import { absentAsEmpty } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";

/** One verb whose real contract lives in a skill the CLI itself never loads. */
export interface GovernedVerb {
  /** The skill slug to name in the reminder (e.g. `/slopweaver:linear`). */
  readonly skill: string;
  /** One clause naming what actually lives in the skill, not the CLI. */
  readonly why: string;
}

/**
 * `"<noun> <verb>"` → the skill that owns it. Scoped, deliberately, to the exact verbs the owner named:
 * `slopweaver linear issue/project/milestone` used cold, without `/slopweaver:linear`'s own structure and
 * brevity contract in context. `read`/`search` are absent on purpose — they render nothing Linear-shaped,
 * so there is no format contract to miss.
 */
const GOVERNED_VERBS: ReadonlyMap<string, GovernedVerb> = new Map([
  [
    "linear issue",
    { skill: "/slopweaver:linear", why: "issue structure, section brevity caps, and freeform-kind handling" },
  ],
  ["linear project", { skill: "/slopweaver:linear", why: "project field conventions" }],
  ["linear milestone", { skill: "/slopweaver:linear", why: "milestone conventions" }],
]);

/**
 * Look up whether a verb is governed by an owning skill.
 *
 * @param noun the CLI noun (e.g. `linear`)
 * @param verb the CLI verb (e.g. `issue`)
 * @returns the governing skill, or `undefined` when this verb has none
 */
export function governedVerbFor({ noun, verb }: { noun: string; verb: string }): GovernedVerb | undefined {
  return GOVERNED_VERBS.get(`${noun} ${verb}`);
}

/** Per-session record of which `"<noun> <verb>"` keys have already been reminded this session. */
export type SkillReminderState = Readonly<Record<string, readonly string[]>>;

/** The empty state, for a missing or unreadable marker file. */
export const EMPTY_SKILL_REMINDER_STATE: SkillReminderState = {};

/** How many distinct sessions this file tracks before the oldest is evicted — bounds its growth forever. */
export const MAX_TRACKED_SESSIONS = 200;

/**
 * Whether this exact verb has already been reminded in this session.
 *
 * @param state the current per-session dedup state
 * @param sessionId the session to check
 * @param key the `"<noun> <verb>"` key ({@link governedVerbFor}'s lookup key)
 * @returns whether a reminder for this key was already recorded for this session
 */
export function hasBeenReminded({
  state,
  sessionId,
  key,
}: {
  state: SkillReminderState;
  sessionId: string;
  key: string;
}): boolean {
  return absentAsEmpty({ value: state[sessionId] }).includes(key);
}

/**
 * Record that a key has now been reminded for a session, evicting the oldest-inserted session once the
 * tracked set would otherwise grow past {@link MAX_TRACKED_SESSIONS} — a plain object preserves string-key
 * insertion order, so the first key IS the oldest entry.
 *
 * @param state the current per-session dedup state
 * @param sessionId the session that was just reminded
 * @param key the `"<noun> <verb>"` key that was just reminded
 * @returns the updated state (unchanged, by reference, if this exact key was already recorded)
 */
export function withReminded({
  state,
  sessionId,
  key,
}: {
  state: SkillReminderState;
  sessionId: string;
  key: string;
}): SkillReminderState {
  const existing = absentAsEmpty({ value: state[sessionId] });
  if (existing.includes(key)) {
    return state;
  }
  const next: SkillReminderState = { ...state, [sessionId]: [...existing, key] };
  const sessionIds = Object.keys(next);
  if (sessionIds.length <= MAX_TRACKED_SESSIONS) {
    return next;
  }
  const oldest = sessionIds[0]!; // length > MAX_TRACKED_SESSIONS ⇒ at least one entry
  return Object.fromEntries(Object.entries(next).filter(([id]) => id !== oldest));
}

/**
 * Render the one-line, non-blocking reminder for a governed verb.
 *
 * @param noun the CLI noun
 * @param verb the CLI verb
 * @param governed the verb's owning skill, from {@link governedVerbFor}
 * @returns the reminder line to print to stderr
 */
export function reminderMessage({
  noun,
  verb,
  governed,
}: {
  noun: string;
  verb: string;
  governed: GovernedVerb;
}): string {
  return (
    `slopweaver ${noun} ${verb}: this verb's contract (${governed.why}) lives in the ${governed.skill} skill, ` +
    `not the CLI — load it this session if you haven't already.`
  );
}

/** Whether `value` is an array of strings — the only shape a session's reminded-keys entry may take. */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Parse a skill-reminder marker file's contents back into state, tolerating anything malformed as empty
 * — this is a best-effort dedup marker, never a source of truth, so a corrupt file costs one extra
 * reminder rather than a failure.
 *
 * @param raw the file's raw text, or `undefined` when it could not be read at all
 * @returns the parsed state, or {@link EMPTY_SKILL_REMINDER_STATE} on anything unreadable/malformed
 */
export function parseSkillReminderState({ raw }: { raw: string | undefined }): SkillReminderState {
  if (raw === undefined) {
    return EMPTY_SKILL_REMINDER_STATE;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SKILL_REMINDER_STATE;
  }
  if (!isRecord(parsed)) {
    return EMPTY_SKILL_REMINDER_STATE;
  }
  const state: Record<string, readonly string[]> = {};
  for (const [sessionId, value] of Object.entries(parsed)) {
    if (isStringArray(value)) {
      state[sessionId] = value;
    }
  }
  return state;
}
