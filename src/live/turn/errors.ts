/**
 * Typed domain errors for the turn surface — see `.claude/rules/error-handling.md` for the shape.
 *
 * Three independent types live here, none sharing a base with another: {@link BriefParseError} for the
 * brief's own on-disk contract (`brief.ts` + `briefAnswerable.ts` + `briefStore.ts`),
 * {@link GroundingValidationError} for the answer/decision consistency check `validateAnswerForDispatch` runs,
 * and {@link StartedChecklistMismatchError} for the one refusal `reconcileStartedChecklist` can produce.
 *
 * Everything else this directory authors is `turnErrors.ts`'s `TurnError`. `judgement.ts`'s two
 * single-reason checks raise it; its variable-length lists of zod schema issues and invalid-capability-id
 * problems (`parseRoutingDecision`, `validateNeedsAgainstRoster`) stay a `readonly string[]`, because a list
 * of same-shaped problems is the behaviour, and every caller folds it into a flat list alongside unrelated
 * flag-validation errors (see `cli/commands/turn/run.ts`'s `loadDirectInputs`).
 */
import type { StartedChecklist } from "../ask/checklist.js";

// ---------------------------------------------------------------------------------------------------------
// BriefParseError — the on-disk contract (the decoders in `brief.ts`/`briefAnswerable.ts`, `briefStore.ts`'s read).
// ---------------------------------------------------------------------------------------------------------

/** The decoded JSON value was not an object at all. */
export interface BriefNotAnObjectError {
  readonly code: "BRIEF_NOT_AN_OBJECT";
  readonly message: string;
}

/** The brief's `version` field did not match the version this build reads. */
export interface BriefVersionMismatchError {
  readonly code: "BRIEF_VERSION_MISMATCH";
  readonly message: string;
  readonly found: unknown;
  readonly expected: number;
}

/** One or more required string fields (`question`/`channel`/`messageTs`/`threadTs`/`userId`) were absent. */
export interface BriefMissingFieldsError {
  readonly code: "BRIEF_MISSING_FIELDS";
  readonly message: string;
  readonly missing: readonly string[];
}

/** The brief's `surface` field was neither `channel` nor `dm`. */
export interface BriefInvalidSurfaceError {
  readonly code: "BRIEF_INVALID_SURFACE";
  readonly message: string;
  readonly value: unknown;
}

/** The brief's `started` field was present but not a well-formed `{turnId, workingTs}` pair of strings. */
export interface BriefInvalidStartedError {
  readonly code: "BRIEF_INVALID_STARTED";
  readonly message: string;
}

/** One of the brief's capability-array fields (`unavailableCapabilities`, or `routingInput`'s own) failed to parse. */
export interface BriefInvalidCapabilityArrayError {
  readonly code: "BRIEF_INVALID_CAPABILITY_ARRAY";
  readonly message: string;
  readonly field: string;
}

/** The brief's `ridesOn` is present but is not another message's ts in the same thread. */
export interface BriefInvalidRidesOnError {
  readonly code: "BRIEF_INVALID_RIDES_ON";
  readonly message: string;
}

/** The brief's `unprompted` is present but is not `true` — the one value it ever carries. */
export interface BriefInvalidUnpromptedError {
  readonly code: "BRIEF_INVALID_UNPROMPTED";
  readonly message: string;
}

/** The brief's `stoodDown` is present but is not `true` — the one value it ever carries. */
export interface BriefInvalidStoodDownError {
  readonly code: "BRIEF_INVALID_STOOD_DOWN";
  readonly message: string;
}

/** The brief's `routingInput` field failed to parse against its own schema. */
export interface BriefInvalidRoutingInputError {
  readonly code: "BRIEF_INVALID_ROUTING_INPUT";
  readonly message: string;
}

/** The brief file itself could not be read or was not valid JSON — `briefStore.ts`'s own I/O boundary. */
export interface BriefUnreadableError {
  readonly code: "BRIEF_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/**
 * Every failure {@link ./brief.parseTurnRoutingBrief}/{@link ./briefAnswerable.parseAnswerableBrief} and
 * {@link ./briefStore.readBrief} can produce.
 */
export type BriefParseError =
  | BriefNotAnObjectError
  | BriefVersionMismatchError
  | BriefMissingFieldsError
  | BriefInvalidSurfaceError
  | BriefInvalidStartedError
  | BriefInvalidRidesOnError
  | BriefInvalidUnpromptedError
  | BriefInvalidStoodDownError
  | BriefInvalidCapabilityArrayError
  | BriefInvalidRoutingInputError
  | BriefUnreadableError;

/** Factories for every {@link BriefParseError} variant. */
export const BriefParseErrors = {
  /** @returns a {@link BriefInvalidCapabilityArrayError} naming the field that failed to parse */
  invalidCapabilityArray: ({ field }: { field: string }): BriefInvalidCapabilityArrayError => ({
    code: "BRIEF_INVALID_CAPABILITY_ARRAY",
    field,
    message: `the brief's "${field}" is not a well-formed capability array`,
  }),

  /** @returns a {@link BriefInvalidRoutingInputError} */
  invalidRoutingInput: (): BriefInvalidRoutingInputError => ({
    code: "BRIEF_INVALID_ROUTING_INPUT",
    message: 'the brief\'s "routingInput" is not a well-formed routing-judgement input',
  }),

  /** @returns a {@link BriefInvalidRidesOnError} saying what the value was */
  invalidRidesOn: ({ value }: { value: unknown }): BriefInvalidRidesOnError => ({
    code: "BRIEF_INVALID_RIDES_ON",
    message: `the brief's \`ridesOn\` is \`${String(value)}\`, which is not a non-empty message ts other than the ask's own`,
  }),

  /** @returns a {@link BriefInvalidStartedError} */
  invalidStarted: (): BriefInvalidStartedError => ({
    code: "BRIEF_INVALID_STARTED",
    message: "the brief's `started` is present but is not a {turnId, workingTs} object of strings",
  }),

  /** @returns a {@link BriefInvalidUnpromptedError} saying what the value was */
  invalidUnprompted: ({ value }: { value: unknown }): BriefInvalidUnpromptedError => ({
    code: "BRIEF_INVALID_UNPROMPTED",
    message: `the brief's \`unprompted\` is \`${String(value)}\`, which is not true — absent is the only other value`,
  }),

  /** @returns a {@link BriefInvalidStoodDownError} saying what the value was */
  invalidStoodDown: ({ value }: { value: unknown }): BriefInvalidStoodDownError => ({
    code: "BRIEF_INVALID_STOOD_DOWN",
    message: `the brief's \`stoodDown\` is \`${String(value)}\`, which is not true — absent is the only other value`,
  }),

  /** @returns a {@link BriefInvalidSurfaceError} carrying the rejected value */
  invalidSurface: ({ value }: { value: unknown }): BriefInvalidSurfaceError => ({
    code: "BRIEF_INVALID_SURFACE",
    message: `the brief's surface is \`${String(value)}\`, which is neither channel nor dm`,
    value,
  }),

  /** @returns a {@link BriefMissingFieldsError} naming every missing field at once */
  missingFields: ({ missing }: { missing: readonly string[] }): BriefMissingFieldsError => ({
    code: "BRIEF_MISSING_FIELDS",
    message: `the brief is missing ${missing.join(", ")}`,
    missing,
  }),

  /** @returns a {@link BriefNotAnObjectError} */
  notAnObject: (): BriefNotAnObjectError => ({
    code: "BRIEF_NOT_AN_OBJECT",
    message: "the brief is not a JSON object",
  }),

  /** @returns a {@link BriefUnreadableError} wrapping the underlying read/parse failure */
  unreadable: ({ path, message }: { path: string; message: string }): BriefUnreadableError => ({
    code: "BRIEF_UNREADABLE",
    message: `could not read the brief at ${path}: ${message}`,
    path,
  }),

  /** @returns a {@link BriefVersionMismatchError} naming both the version found and the version expected */
  versionMismatch: ({ found, expected }: { found: unknown; expected: number }): BriefVersionMismatchError => ({
    code: "BRIEF_VERSION_MISMATCH",
    expected,
    found,
    message:
      `the brief is version ${String(found)}, but this build reads version ${String(expected)} — re-run ` +
      "`slopweaver turn brief`",
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// GroundingValidationError — `validateAnswerForDispatch`'s answer/decision consistency check.
// ---------------------------------------------------------------------------------------------------------

/** A `conversation` grounding claimed context alone was sufficient, but the decision named a required live need. */
export interface ConversationGroundingInsufficientError {
  readonly code: "CONVERSATION_GROUNDING_INSUFFICIENT";
  readonly message: string;
  readonly requiredIds: readonly string[];
}

/** A `verb` grounding named a capability the decision's own `needs` never listed. */
export interface VerbGroundingUnrequestedError {
  readonly code: "VERB_GROUNDING_UNREQUESTED";
  readonly message: string;
  readonly capabilityId: string;
  readonly allowedIds: readonly string[];
}

/** An `unreachable` grounding named a surface neither the brief nor the decision ever named. */
export interface UnreachableGroundingUnsubstantiatedError {
  readonly code: "UNREACHABLE_GROUNDING_UNSUBSTANTIATED";
  readonly message: string;
  readonly surfaceId: string;
}

/**
 * A PROPOSAL-shaped ask was answered without any present-state check of the premise it assumes.
 *
 * The owner-BAD answer in one error code: the turn costed a repository that already existed,
 * from inside that repository. `trigger` carries the wording that made the ask proposal-shaped, so the
 * refusal points at the ask rather than at the answer's author.
 */
export interface ProposalPremiseUncheckedError {
  readonly code: "PROPOSAL_PREMISE_UNCHECKED";
  readonly message: string;
  readonly trigger: string;
}

/** Every failure {@link ./briefAnswerable.validateAnswerForDispatch} can produce. */
export type GroundingValidationError =
  | ConversationGroundingInsufficientError
  | VerbGroundingUnrequestedError
  | UnreachableGroundingUnsubstantiatedError
  | ProposalPremiseUncheckedError;

/** Factories for every {@link GroundingValidationError} variant. */
export const GroundingValidationErrors = {
  /** @returns a {@link ConversationGroundingInsufficientError} naming every required need the grounding ignored */
  conversationGroundingInsufficient: ({
    requiredIds,
  }: {
    requiredIds: readonly string[];
  }): ConversationGroundingInsufficientError => ({
    code: "CONVERSATION_GROUNDING_INSUFFICIENT",
    message:
      "the answer's grounding claims conversation alone was sufficient, but the decision named a required " +
      `live need (${requiredIds.join(", ")}) that conversation grounding never consults`,
    requiredIds,
  }),

  /**
   * @param trigger the proposal wording found in the ask, quoted back so the refusal points at the premise
   * @returns a {@link ProposalPremiseUncheckedError} naming that wording
   */
  proposalPremiseUnchecked: ({ trigger }: { trigger: string }): ProposalPremiseUncheckedError => ({
    code: "PROPOSAL_PREMISE_UNCHECKED",
    message:
      `this ask proposes something ("${trigger}"), so it assumes the thing does not exist yet — but the ` +
      "answer records no present-state check of that premise. Go and look, then say what you looked for, " +
      "what you found and when, in the evidence's `premiseChecks`",
    trigger,
  }),

  /** @returns an {@link UnreachableGroundingUnsubstantiatedError} naming the unsubstantiated surface */
  unreachableGroundingUnsubstantiated: ({
    surfaceId,
  }: {
    surfaceId: string;
  }): UnreachableGroundingUnsubstantiatedError => ({
    code: "UNREACHABLE_GROUNDING_UNSUBSTANTIATED",
    message:
      `the answer's grounding claims "${surfaceId}" is unreachable, but the brief never listed it as ` +
      "unavailable and the decision never named it as a need",
    surfaceId,
  }),

  /** @returns a {@link VerbGroundingUnrequestedError} naming the unrequested capability and every id that was allowed */
  verbGroundingUnrequested: ({
    allowedIds,
    capabilityId,
  }: {
    allowedIds: readonly string[];
    capabilityId: string;
  }): VerbGroundingUnrequestedError => ({
    allowedIds,
    capabilityId,
    code: "VERB_GROUNDING_UNREQUESTED",
    message:
      `the answer's grounding claims the "${capabilityId}" verb, which is not one of this decision's own ` +
      `needs (${allowedIds.length > 0 ? allowedIds.join(", ") : "none"}) — reading the thread is ` +
      "investigation, never grounding; ground on the capability whose evidence actually backs the claim",
  }),
} as const;

// ---------------------------------------------------------------------------------------------------------
// StartedChecklistMismatchError — `reconcileStartedChecklist`'s one refusal.
// ---------------------------------------------------------------------------------------------------------

/** The explicit `--turn-id`/`--working-ts` pair disagrees with the ref the durable ask-lifecycle log recorded. */
export interface StartedChecklistMismatchError {
  readonly code: "STARTED_CHECKLIST_MISMATCH";
  readonly message: string;
  readonly explicit: StartedChecklist;
  readonly recorded: StartedChecklist;
}

/** The one factory {@link ./startedReconcile.reconcileStartedChecklist} can produce. */
export const StartedChecklistMismatchErrors = {
  /** @returns a {@link StartedChecklistMismatchError} naming both disagreeing refs */
  mismatch: ({
    explicit,
    recorded,
  }: {
    explicit: StartedChecklist;
    recorded: StartedChecklist;
  }): StartedChecklistMismatchError => ({
    code: "STARTED_CHECKLIST_MISMATCH",
    explicit,
    message:
      `the --turn-id/--working-ts passed (${explicit.turnId}/${explicit.workingTs}) do not match the ` +
      `checklist-posted ref this exact ask already recorded (${recorded.turnId}/${recorded.workingTs}) — ` +
      "refusing rather than guessing which one is real and advancing the wrong Slack message",
    recorded,
  }),
} as const;
