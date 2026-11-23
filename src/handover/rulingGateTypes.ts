/**
 * The machine-readable half of an owner ruling: which verbs it gates, and which gates a ruling lifts.
 *
 * Types only, and in their own module because `./ledger.ts` carries the event that holds them while
 * `./rulingGate.ts` carries the logic that reads them — a shared type in either of those would be a cycle.
 *
 * ## Why a ruling needs a machine-readable half at all
 *
 * A ruling the owner gave can be forgotten or mis-prioritised by the chair that heard it, and a post then goes
 * out against it. The guardrail is this module's whole purpose: **a ruling recorded on the board must be read by
 * the verb it rules on at run time and refuse, never rely on the chair remembering it across a compaction.**
 *
 * Without it, a ruling is free text. Making one bite takes a bespoke mechanism per ruling, such as teaching
 * `live/automation/postTarget.ts` and `outbound/slack/scheduledPostChannel.ts` one thing the owner said once.
 * That work recurs per ruling, and it cannot be in place at the moment the owner rules — which is the moment
 * the next verb runs.
 *
 * **What this changes, stated no larger than it is.** The chair still has to record the gate. What moves is
 * the DURATION of that dependence: from "remember this ruling for the rest of the workstream, across every
 * compaction" to "remember it for the length of one `handover rule` invocation".
 */

/**
 * One `<noun> <verb>` pair a gate names.
 *
 * Exact pairs, never a wildcard, and that is a decision rather than an omission. `slack *` reads as narrow
 * and is not — it would catch `slack read-thread`, `slack when` and `slack voice-rules`, none of which
 * reaches anybody. A gate over a whole noun lists that noun's verbs, which also makes the refusal
 * self-documenting when the owner reads it back.
 */
export interface GatedVerb {
  /** The CLI noun, as `slopweaver <noun> <verb>` spells it. */
  readonly noun: string;
  /** The CLI verb under that noun. */
  readonly verb: string;
}

/**
 * The gate one ruling places.
 *
 * `subjects` is what keeps a ruling about scheduled posts from refusing every `slack post`. Empty means the
 * gate covers the whole verb; non-empty narrows it to invocations whose subject is one of these strings —
 * matched as a WHOLE argv token at the dispatch boundary, and asked directly by a verb that resolves its own
 * subject (a recipe id never appears in `automation run-due`'s argv).
 */
export interface RulingGate {
  /** The verbs this ruling gates. At least one; the writer refuses an empty list. */
  readonly verbs: readonly GatedVerb[];
  /** Exact subject strings this gate narrows to, or empty for the whole verb. */
  readonly subjects: readonly string[];
  /**
   * When the gate lapses on its own, in canonical `toISOString()` spelling — absent means it stands until
   * the owner releases it.
   *
   * One optional field rather than two shapes, because a "no post today" and a standing "DM only" differ in
   * exactly this and nothing else. An expired gate is SPENT, not released: it still lists, with its expiry
   * shown, because "the owner ruled this and it lapsed" and "nobody ever ruled" are different facts — the same
   * distinction `./findingGate.ts` draws between `declined` and `unruled`.
   */
  readonly untilIso?: string;
}

/**
 * A gate's id: the row's slug, a `#`, and the placing ruling's own `atIso` in canonical spelling.
 *
 * Readable, stable, and it resolves to exactly one line of exactly one journal — so a reader handed one in a
 * refusal can go and read the ruling that placed it without being told where to look.
 */
export type RulingGateId = string;
