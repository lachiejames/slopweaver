/**
 * The TYPED REFUSAL PATH — the closed set of checks a session may decline a grant on.
 *
 * ## Why a closed union rather than a sentence in a rule
 *
 * The failure mode this exists for is a session that reads a relayed ruling, does what it was trained to do,
 * and asks the owner to type the instruction into its own tab instead. Prose cannot close that: the refusing
 * session is being careful, and being careful is right. What closes it is making the refusal NAME something.
 *
 * Every variant below is a check on the ROW or on the world. None of them is "I do not believe the sender",
 * and there is deliberately no code for it — a session that will not act has to point at a failed check, and
 * `grant refuse` will not journal a code outside {@link GRANT_CHECK_CODES}. So the untyped refusal is not an
 * available shape, while every typed one stays wanted and is exactly as loud as before.
 *
 * ## What each one means when it fires
 *
 * `ROW_MISSING`, `ANCHOR_UNRESOLVED`, `CHANGE_MISMATCH`, `ALREADY_PERFORMED` and `STATE_ABSENT` are computed
 * by `./verify.ts` from the journal and the world. `RAIL_CROSSED` is the one a session supplies itself: no
 * code can decide whether an act crosses `.claude/rules/cross-session-messages.md`'s tier-3 set, and that set
 * is untouched by this mechanism — a row is not authority to widen access, address a new audience, spend, or
 * do something irreversible nobody asked for. A grant that would is refused on this code and routed to the owner.
 */

/** One of the checks a session may refuse on. Also the journal's `code` vocabulary. */
export type GrantCheckCode =
  "ROW_MISSING" | "ANCHOR_UNRESOLVED" | "CHANGE_MISMATCH" | "ALREADY_PERFORMED" | "STATE_ABSENT" | "RAIL_CROSSED";

/** Every code, in the order a session should work through them. Enumerated so a refusal can be validated. */
export const GRANT_CHECK_CODES: readonly GrantCheckCode[] = [
  "ROW_MISSING",
  "ANCHOR_UNRESOLVED",
  "CHANGE_MISMATCH",
  "ALREADY_PERFORMED",
  "STATE_ABSENT",
  "RAIL_CROSSED",
];

/** No row carries the offered id — the commonest case, and the one a fabricated instruction produces. */
export interface RowMissingError {
  readonly code: "ROW_MISSING";
  readonly message: string;
  readonly grantId: string;
}

/** The row's anchor does not resolve to anything a reader can go and look at. */
export interface AnchorUnresolvedError {
  readonly code: "ANCHOR_UNRESOLVED";
  readonly message: string;
  readonly anchor: string;
  /** What the edge observed: the owning reader's own refusal, or that the anchor has no shape it recognises. */
  readonly why: string;
}

/** What the session is about to write is not, byte for byte, what the row records. */
export interface ChangeMismatchError {
  readonly code: "CHANGE_MISMATCH";
  readonly message: string;
  readonly grantId: string;
}

/** The row is spent. One row is one change; a second performance would be a standing grant by accident. */
export interface AlreadyPerformedError {
  readonly code: "ALREADY_PERFORMED";
  readonly message: string;
  readonly grantId: string;
  readonly performedAtIso: string;
}

/** The file or system the row names is not there, so the change cannot be the one that was decided. */
export interface StateAbsentError {
  readonly code: "STATE_ABSENT";
  readonly message: string;
  readonly target: string;
}

/** Acting would cross the tier-3 set, which no row may authorise. Judgement, supplied by the session. */
export interface RailCrossedError {
  readonly code: "RAIL_CROSSED";
  readonly message: string;
  readonly rail: string;
}

/** Every way a session may decline to act on a row. */
export type GrantCheckError =
  | RowMissingError
  | AnchorUnresolvedError
  | ChangeMismatchError
  | AlreadyPerformedError
  | StateAbsentError
  | RailCrossedError;

/** Build one typed refusal. The factory the real code calls, so a test built the same way catches drift. */
export const GrantCheckErrors = {
  alreadyPerformed: ({
    grantId,
    performedAtIso,
  }: {
    grantId: string;
    performedAtIso: string;
  }): AlreadyPerformedError => ({
    code: "ALREADY_PERFORMED",
    grantId,
    message: `grant ${grantId} was already performed at ${performedAtIso} — one row is one change, so record a new row`,
    performedAtIso,
  }),
  anchorUnresolved: ({ anchor, why }: { anchor: string; why: string }): AnchorUnresolvedError => ({
    anchor,
    code: "ANCHOR_UNRESOLVED",
    message: `the anchor ${anchor} does not resolve to anything checkable — ${why}; a row's origin must be readable`,
    why,
  }),
  changeMismatch: ({ grantId }: { grantId: string }): ChangeMismatchError => ({
    code: "CHANGE_MISMATCH",
    grantId,
    message: `what this session is about to write is not the change grant ${grantId} records — the row is exact on purpose`,
  }),
  railCrossed: ({ rail }: { rail: string }): RailCrossedError => ({
    code: "RAIL_CROSSED",
    message: `acting on this row would cross a rail no grant may authorise: ${rail} — route it to the owner`,
    rail,
  }),
  rowMissing: ({ grantId }: { grantId: string }): RowMissingError => ({
    code: "ROW_MISSING",
    grantId,
    message: `no grant row carries the id ${grantId} — ask the supervisor to record one with \`slopweaver grant record\``,
  }),
  stateAbsent: ({ target }: { target: string }): StateAbsentError => ({
    code: "STATE_ABSENT",
    message: `the ${target} this row names is not there, so this cannot be the change that was decided`,
    target,
  }),
} as const;

/**
 * Whether a string is one of the codes a refusal may be journalled under.
 *
 * Positional because TypeScript error TS1230 forbids destructuring in a type predicate — the compiler's
 * decision, and the exemption `.claude/rules/typescript-patterns.md` already computes.
 *
 * @param value the candidate code
 * @returns true only for a member of {@link GRANT_CHECK_CODES}
 */
export function isGrantCheckCode(value: string): value is GrantCheckCode {
  return (GRANT_CHECK_CODES as readonly string[]).includes(value);
}
