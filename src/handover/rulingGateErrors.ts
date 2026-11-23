/**
 * The typed failures of declaring, projecting or lifting a ruling gate.
 *
 * Its own union rather than a member of `./rulingErrors.ts`, per `.claude/rules/error-handling.md`: that
 * union is about a ruling's WORDS and their source, and a caller branches on those to decide what to fix in
 * a backfill. These are facts about the gate's own shape and its projection — a verb that does not exist, a
 * verb no gate may ever name, an index that will not parse — and a caller branches on them to decide whether
 * to correct a flag, rebuild a file, or stop.
 *
 * **None of these is a policy refusal.** The refusal a gate MAKES is `./rulingGate.ts`'s
 * `rulingGateRefusalLines`, which is a hold and says it has no hatch. Everything here is a failure of fact,
 * so none of it carries one either.
 *
 * Pure: every factory takes already-read values. No filesystem, no clock.
 */

/** A `--gates` entry is not a `<noun> <verb>` pair. */
export interface GateSelectorMalformedError {
  readonly code: "GATE_SELECTOR_MALFORMED";
  readonly message: string;
  /** The entry as written, so the caller can see which one of a comma-separated list is wrong. */
  readonly entry: string;
}

/** A gate names a verb this build does not register, so it could never fire. */
export interface GateVerbUnknownError {
  readonly code: "GATE_VERB_UNKNOWN";
  readonly message: string;
  readonly noun: string;
  readonly verb: string;
}

/** A gate names a verb that would make the register unfixable — `./rulingGate.ts`'s `UNGATEABLE`. */
export interface GateVerbUngateableError {
  readonly code: "GATE_VERB_UNGATEABLE";
  readonly message: string;
  readonly noun: string;
  readonly verb: string;
}

/** A gate's `--gate-until` is not an instant, or is not in the canonical spelling a reader compares. */
export interface GateUntilInvalidError {
  readonly code: "GATE_UNTIL_INVALID";
  readonly message: string;
  readonly untilIso: string;
}

/** The projection on disk will not parse, so it cannot be amended in place. */
export interface GateIndexUnreadableError {
  readonly code: "GATE_INDEX_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The projection could not be written. */
export interface GateIndexWriteFailedError {
  readonly code: "GATE_INDEX_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** No standing gate carries the id a release names. */
export interface GateNotFoundError {
  readonly code: "GATE_NOT_FOUND";
  readonly message: string;
  readonly id: string;
}

/** Every way declaring, projecting or lifting a gate can fail. */
export type RulingGateError =
  | GateSelectorMalformedError
  | GateVerbUnknownError
  | GateVerbUngateableError
  | GateUntilInvalidError
  | GateIndexUnreadableError
  | GateIndexWriteFailedError
  | GateNotFoundError;

/** The one place a `RulingGateError` is constructed, so a test builds what the real code builds. */
export const RulingGateErrors = {
  indexUnreadable: ({ path, detail }: { path: string; detail: string }): GateIndexUnreadableError => ({
    code: "GATE_INDEX_UNREADABLE",
    message: `the ruling gate index at ${path} will not parse (${detail}) — rebuild it with \`slopweaver handover gate rebuild\``,
    path,
  }),
  indexWriteFailed: ({ path, detail }: { path: string; detail: string }): GateIndexWriteFailedError => ({
    code: "GATE_INDEX_WRITE_FAILED",
    message: `could not write the ruling gate index at ${path}: ${detail}`,
    path,
  }),
  notFound: ({ id }: { id: string }): GateNotFoundError => ({
    code: "GATE_NOT_FOUND",
    id,
    message: `no standing gate carries the id "${id}" — \`slopweaver handover gate list\` names them`,
  }),
  selectorMalformed: ({ entry }: { entry: string }): GateSelectorMalformedError => ({
    code: "GATE_SELECTOR_MALFORMED",
    entry,
    message: `"${entry}" is not a \`<noun> <verb>\` pair — a gate names exact verbs, and there is no wildcard`,
  }),
  untilInvalid: ({ untilIso }: { untilIso: string }): GateUntilInvalidError => ({
    code: "GATE_UNTIL_INVALID",
    message:
      `--gate-until "${untilIso}" is not a canonical toISOString() instant; a gate that lapses at a time ` +
      "nothing can order lapses at no time at all",
    untilIso,
  }),
  verbUngateable: ({ noun, verb }: { noun: string; verb: string }): GateVerbUngateableError => ({
    code: "GATE_VERB_UNGATEABLE",
    message:
      `\`${noun} ${verb}\` can never be gated: gating it would leave the register unfixable or the gate ` +
      "unliftable. Recording a gate that will be ignored is the failure this whole mechanism closes, so it " +
      "is refused instead",
    noun,
    verb,
  }),
  verbUnknown: ({ noun, verb }: { noun: string; verb: string }): GateVerbUnknownError => ({
    code: "GATE_VERB_UNKNOWN",
    message: `this build registers no \`slopweaver ${noun} ${verb}\` — a gate on it would never fire`,
    noun,
    verb,
  }),
} as const;
