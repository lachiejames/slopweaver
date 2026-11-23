/**
 * `hand surface`'s flags and its I/O-free parser — the half the help-truth ratchet probes, apart from the verb's
 * printing shell in `./surface.ts`.
 *
 * Nothing is defaulted: urgency, context, the observing seat, every access companion and every field of the Queue
 * card's shape are stated by the seat or the invocation is refused, because a default here would be a guess about
 * how urgent something is for the owner presented as the seat's word.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  MID_STATE_URGENCIES,
  type MidStateAccess,
  type MidStateReport,
  type MidStateUrgency,
} from "../../../hand/midState.js";
import type { HandContext } from "../../../hand/step.js";
import { type FlagSpec, parseFlags, repeatedFlagValues } from "../../parseFlags.js";
import { type HandSurfaceArgsError, HandSurfaceArgsErrors } from "./surfaceArgsErrors.js";

/** Flags a report must carry. */
const REQUIRED_STRINGS = [
  "row",
  "ask-slug",
  "documented",
  "observed",
  "codex",
  "why",
  "urgency",
  "question",
  "problem",
  "options",
  "lean",
  "risk",
  "blast-radius",
  "still-real",
  "observed-by",
  "context",
] as const;

/** Each urgency kind's own companion flags, beside `--note-what` which every note kind takes. */
const COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  "blocked-send": ["send"],
  breaking: ["breaks", "by"],
  "close-call": ["if-silent"],
  "fleet-idle": [],
  keen: [],
  none: [],
};

/** Flags a report may carry. */
const OPTIONAL_STRINGS = [
  "hedge",
  "access",
  "holder",
  "would-settle",
  "breaks",
  "by",
  "send",
  "if-silent",
  "note-what",
  "by-session",
];

/** Flags whose repeats are a list. */
const LISTS = ["tried", "doc", "evidence"] as const;

const FLAGS: FlagSpec = {
  boolean: ["json"],
  repeatable: [...LISTS],
  string: [...REQUIRED_STRINGS, ...OPTIONAL_STRINGS, ...LISTS],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const HAND_SURFACE_FLAG_NAMES: readonly string[] = ["json", ...REQUIRED_STRINGS, ...OPTIONAL_STRINGS, ...LISTS]
  .map((name) => `--${name}`)
  .toSorted();

/** A parsed invocation. */
export interface HandSurfaceArgs {
  readonly report: MidStateReport;
  readonly json: boolean;
}

type FlagValues = Readonly<Record<string, string | boolean>>;

/**
 * A string flag's value, or `undefined` when it was not passed.
 *
 * @param values the parsed flags
 * @param name the flag, without `--`
 * @returns its value
 */
function stringFlag({ values, name }: { values: FlagValues; name: string }): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The access triple, all three flags or none.
 *
 * @param values the parsed flags
 * @returns the access, `undefined` when none of the three was passed, or the refusal
 */
function accessOf({ values }: { values: FlagValues }): Result<MidStateAccess | undefined, HandSurfaceArgsError> {
  const what = stringFlag({ name: "access", values });
  const holder = stringFlag({ name: "holder", values });
  const wouldSettle = stringFlag({ name: "would-settle", values });
  if (what === undefined && holder === undefined && wouldSettle === undefined) {
    return ok(undefined);
  }
  if (what === undefined || holder === undefined || wouldSettle === undefined) {
    return err(HandSurfaceArgsErrors.accessIncomplete());
  }
  return ok({ holder, what, wouldSettle });
}

/**
 * The note kinds' urgency once `--note-what` is in hand: each kind's own companions, checked present.
 *
 * @param values the parsed flags
 * @param kind a note kind, already checked to be in the closed set
 * @param noteWhat the one step the owner's hands take
 * @returns the urgency, or the companion it is missing
 */
function noteUrgencyOf({
  values,
  kind,
  noteWhat,
}: {
  values: FlagValues;
  kind: string;
  noteWhat: string;
}): Result<MidStateUrgency, HandSurfaceArgsError> {
  const breaks = stringFlag({ name: "breaks", values });
  const by = stringFlag({ name: "by", values });
  const send = stringFlag({ name: "send", values });
  const ifSilent = stringFlag({ name: "if-silent", values });
  if (kind === "fleet-idle" || kind === "keen") {
    return ok({ kind, noteWhat });
  }
  if (kind === "blocked-send") {
    if (send === undefined) {
      return err(HandSurfaceArgsErrors.urgencyCompanion({ kind, why: "needs --send: the approved send that waits" }));
    }
    return ok({ kind, noteWhat, send });
  }
  if (kind === "close-call") {
    if (ifSilent === undefined) {
      return err(
        HandSurfaceArgsErrors.urgencyCompanion({
          kind,
          why: "needs --if-silent: what could go wrong if the owner is not told",
        }),
      );
    }
    return ok({ ifSilent, kind, noteWhat });
  }
  if (breaks === undefined || by === undefined) {
    return err(
      HandSurfaceArgsErrors.urgencyCompanion({ kind, why: "needs --breaks and --by: what may break, and by when" }),
    );
  }
  return ok({ breaks, by, kind: "breaking", noteWhat });
}

/**
 * The urgency, with exactly the companions its kind needs.
 *
 * @param values the parsed flags
 * @param kind what `--urgency` carried
 * @returns the urgency, or the first companion it is missing or must not carry
 */
function urgencyOf({
  values,
  kind,
}: {
  values: FlagValues;
  kind: string;
}): Result<MidStateUrgency, HandSurfaceArgsError> {
  if (!(MID_STATE_URGENCIES as readonly string[]).includes(kind)) {
    return err(HandSurfaceArgsErrors.urgencyUnknown({ kind, known: MID_STATE_URGENCIES }));
  }
  const own = COMPANIONS[kind]!;
  const stray = [...Object.values(COMPANIONS).flat(), ...(kind === "none" ? ["note-what"] : [])]
    .filter((name) => !own.includes(name) && stringFlag({ name, values }) !== undefined)
    .map((name) => `--${name}`);
  if (stray.length > 0) {
    return err(HandSurfaceArgsErrors.urgencyCompanion({ kind, why: `does not take ${stray.join(", ")}` }));
  }
  if (kind === "none") {
    return ok({ kind });
  }
  const noteWhat = stringFlag({ name: "note-what", values });
  if (noteWhat === undefined) {
    return err(
      HandSurfaceArgsErrors.urgencyCompanion({
        kind,
        why: "pushes a note, so it needs --note-what: the one step the owner's hands take",
      }),
    );
  }
  return noteUrgencyOf({ kind, noteWhat, values });
}

/**
 * `--context`, checked: a note's context is immutable once posted.
 *
 * @param stated what `--context` carried
 * @returns the context, or the refusal
 */
function contextOf({ stated }: { stated: string }): Result<HandContext, HandSurfaceArgsError> {
  if (stated === "work" || stated === "slopweaver") {
    return ok(stated);
  }
  return err(HandSurfaceArgsErrors.contextInvalid({ stated }));
}

/**
 * The three repeatable lists, once every required string flag and every list is checked present.
 *
 * @param rest the argv tail the repeatable flags are read from
 * @param values the parsed flags the required strings are read from
 * @returns the lists, or one refusal naming every missing flag
 */
function listsOf({
  rest,
  values,
}: {
  rest: readonly string[];
  values: FlagValues;
}): Result<{ docs: readonly string[]; evidence: readonly string[]; tried: readonly string[] }, HandSurfaceArgsError> {
  const missing = REQUIRED_STRINGS.filter((name) => stringFlag({ name, values }) === undefined);
  const tried = repeatedFlagValues({ name: "tried", rest });
  const docs = repeatedFlagValues({ name: "doc", rest });
  const evidence = repeatedFlagValues({ name: "evidence", rest });
  const emptyLists = [
    ...(tried.length === 0 ? ["tried"] : []),
    ...(docs.length === 0 ? ["doc"] : []),
    ...(evidence.length === 0 ? ["evidence"] : []),
  ];
  if (missing.length > 0 || emptyLists.length > 0) {
    return err(HandSurfaceArgsErrors.flagsMissing({ flags: [...missing, ...emptyLists].map((name) => `--${name}`) }));
  }
  return ok({ docs, evidence, tried });
}

/**
 * Parse one `hand surface` invocation. I/O-free; exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after `hand surface`
 * @returns the invocation, or the first problem found
 */
export function parseHandSurfaceArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<HandSurfaceArgs, HandSurfaceArgsError> {
  const parsed = parseFlags({ args: rest, spec: FLAGS });
  if (parsed.isErr()) {
    return err(HandSurfaceArgsErrors.flagsRefused({ lines: parsed.error }));
  }
  const { values } = parsed.value;
  const lists = listsOf({ rest, values });
  if (lists.isErr()) {
    return err(lists.error);
  }
  // Every required flag was checked present just above, so each read is an honest invariant.
  const given = ({ name }: { name: (typeof REQUIRED_STRINGS)[number] }): string => stringFlag({ name, values })!;
  const access = accessOf({ values });
  if (access.isErr()) {
    return err(access.error);
  }
  const urgency = urgencyOf({ kind: given({ name: "urgency" }), values });
  if (urgency.isErr()) {
    return err(urgency.error);
  }
  const context = contextOf({ stated: given({ name: "context" }) });
  if (context.isErr()) {
    return err(context.error);
  }
  const hedge = stringFlag({ name: "hedge", values });
  const bySession = stringFlag({ name: "by-session", values });
  return ok({
    json: values["json"] === true,
    report: {
      askSlug: given({ name: "ask-slug" }),
      codex: given({ name: "codex" }),
      context: context.value,
      decision: {
        blastRadius: given({ name: "blast-radius" }),
        evidence: lists.value.evidence,
        lean: given({ name: "lean" }),
        observedBy: given({ name: "observed-by" }),
        optionsText: given({ name: "options" }),
        problem: given({ name: "problem" }),
        question: given({ name: "question" }),
        risk: given({ name: "risk" }),
        stillReal: given({ name: "still-real" }),
      },
      docs: lists.value.docs,
      documented: given({ name: "documented" }),
      observed: given({ name: "observed" }),
      row: given({ name: "row" }),
      tried: lists.value.tried,
      urgency: urgency.value,
      why: given({ name: "why" }),
      ...(hedge === undefined ? {} : { hedge }),
      ...(access.value === undefined ? {} : { access: access.value }),
      ...(bySession === undefined ? {} : { bySession }),
    },
  });
}
