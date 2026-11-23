/**
 * The flag layer of the per-claim `knowledge` verbs: each one's flag spec, its `--`-prefixed flag names for the
 * help-truth ratchet, and its parse. Pure: no I/O, no clock.
 *
 * Usage text, `VERB_ARG_OFFSET` and the `quiz-answer` and `answer` families stay in `./core.ts`, whose overview
 * says why these sit apart from the verb modules.
 */
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/**
 * Every `--`-prefixed flag one spec declares, sorted — the shape the help-truth ratchet compares against.
 *
 * A destructured default rather than `?? []` on each arm: `FlagSpec` makes both arms optional, so a spec
 * that declares only strings has no `boolean` key at all, and the `no-silent-fallback` gate asks for the
 * substitution to be a line of code rather than an operator. Collapsing the nine copies of that block into
 * one call is what made the whole file honest instead of moving the operator around.
 *
 * @param spec the flag spec to read both arms of
 * @returns the flags, each `--`-prefixed, sorted
 */
export function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  const { string: valued = [], boolean: switches = [] } = spec;
  return [...valued, ...switches].map((name) => `--${name}`).toSorted();
}

const RECORD_FLAGS: FlagSpec = {
  boolean: ["json", "redact"],
  string: [
    "domain",
    "claim",
    "verdict",
    "tier",
    "surface",
    "learner",
    "evidence",
    "repro",
    "caveat",
    "supersedes",
    "run",
    "behaviour-change",
    "retrieval-cue",
    "home",
  ],
};

const REMEMBER_FLAGS: FlagSpec = {
  boolean: ["json", "redact"],
  string: [
    "kind",
    "placement",
    "domain",
    "claim",
    "evidence",
    "verdict",
    "tier",
    "surface",
    "learner",
    "behaviour-change",
    "retrieval-cue",
    "repro",
    "caveat",
    "supersedes",
    "run",
  ],
};

const TRACE_FLAGS: FlagSpec = {
  boolean: ["json", "redact"],
  string: ["domain", "question", "probe", "outcome", "evidence", "does-not-prove", "learner", "run"],
};

const DETECT_FLAGS: FlagSpec = { boolean: ["json"], repeatable: ["term"], string: ["term", "slots", "out", "ask"] };

const RECALLED_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["outcome", "evidence", "verdict", "run"],
};

const RECALL_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["domain", "kind", "learner", "limit", "offset"],
};

const VOICE_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["batch", "source", "out", "run", "home"],
};

const QUIZ_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["sweep", "home"],
};

const PROPOSE_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["from", "unit", "domain", "claim", "quote", "held", "none", "run", "home"],
};

const LIST_FLAGS: FlagSpec = {
  boolean: ["json", "repeats"],
  string: ["domain", "verdict", "tier", "surface", "learner", "run", "home"],
};

/** `--`-prefixed record flags, for the help-truth ratchet. */
export const KNOWLEDGE_RECORD_FLAG_NAMES: readonly string[] = flagNames({ spec: RECORD_FLAGS });

/** `--`-prefixed voice flags, for the help-truth ratchet. */
export const KNOWLEDGE_VOICE_FLAG_NAMES: readonly string[] = flagNames({ spec: VOICE_FLAGS });

/** `--`-prefixed quiz flags, for the help-truth ratchet. */
export const KNOWLEDGE_QUIZ_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: QUIZ_FLAGS }),
  ...booleanFlagsOf({ spec: QUIZ_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed propose flags, for the help-truth ratchet. */
export const KNOWLEDGE_PROPOSE_FLAG_NAMES: readonly string[] = flagNames({ spec: PROPOSE_FLAGS });

/** `--`-prefixed list flags, for the help-truth ratchet. */
export const KNOWLEDGE_LIST_FLAG_NAMES: readonly string[] = flagNames({ spec: LIST_FLAGS });

/** `--`-prefixed remember flags, for the help-truth ratchet. */
export const KNOWLEDGE_REMEMBER_FLAG_NAMES: readonly string[] = flagNames({ spec: REMEMBER_FLAGS });

/** `--`-prefixed trace flags, for the help-truth ratchet. */
export const KNOWLEDGE_TRACE_FLAG_NAMES: readonly string[] = flagNames({ spec: TRACE_FLAGS });

/** `--`-prefixed recalled flags, for the help-truth ratchet. */
export const KNOWLEDGE_RECALLED_FLAG_NAMES: readonly string[] = flagNames({ spec: RECALLED_FLAGS });

/** `--`-prefixed detect flags, for the help-truth ratchet. */
export const KNOWLEDGE_DETECT_FLAG_NAMES: readonly string[] = flagNames({ spec: DETECT_FLAGS });

/**
 * Parse `knowledge detect`'s flags. The task is positional, and `--term` is declared `repeatable` and read
 * from the raw argv by the verb, because this parser keeps one value per flag.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeDetectArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: DETECT_FLAGS });
}

/**
 * Parse `knowledge recalled`'s flags. The claim id is positional, so it pastes straight off a recall page.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRecalledArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: RECALLED_FLAGS });
}

/**
 * Parse `knowledge trace`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeTraceArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: TRACE_FLAGS });
}

/**
 * Parse `knowledge remember`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRememberArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: REMEMBER_FLAGS });
}

/** `--`-prefixed recall flags, for the help-truth ratchet. */
export const KNOWLEDGE_RECALL_FLAG_NAMES: readonly string[] = flagNames({ spec: RECALL_FLAGS });

/**
 * Parse `knowledge recall`'s flags. The query itself is positional, so a session types the words a task
 * mentions without quoting a flag name around them.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRecallArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: RECALL_FLAGS });
}

/**
 * Parse `knowledge record`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeRecordArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECORD_FLAGS });
}

/**
 * Parse `knowledge voice`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeVoiceArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: VOICE_FLAGS });
}

/**
 * Parse `knowledge quiz`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeQuizArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: QUIZ_FLAGS });
}

/**
 * Parse `knowledge propose`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeProposeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PROPOSE_FLAGS });
}

/**
 * Parse `knowledge list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseKnowledgeListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}
