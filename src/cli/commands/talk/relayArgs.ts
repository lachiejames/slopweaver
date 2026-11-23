/**
 * What `slopweaver talk relay` ACCEPTS — its flag spec, its usage and its pure parser.
 *
 * Split from `args.ts`, which holds every other `talk` verb's, because the relay's flags carried it past the
 * file-size ratchet; what the relay carries — a reading or the reads that dropped it, a picture or the reason
 * there is none — is read in `./relayContentArgs.ts`. The help-truth ratchet reads these exactly as it reads the
 * others.
 */
import { RULING_COVERS, type RulingCovers } from "../../../autonomy/checkIns.js";
import type { StatedWorkspace } from "../../../handover/workspace.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CandidateVerdict } from "../../../talk/candidateRuling.js";
import { CHECK_IN_KEY_PREFIX } from "../../../talk/checkInRuling.js";
import { type DiscussFirstRecord, discussFirstRecordOf } from "../../../talk/discussFirst.js";
import type { TriageRuling } from "../../../talk/triageVocabulary.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { registerWorkspace } from "../handover/registerWorkspace.js";
import { CONSOLE_ORIGIN_FLAGS, type ConsoleOriginArgs, consoleOriginOf } from "./consoleOriginArgs.js";
import { flagNames, stringOf, stringOr } from "./flagValues.js";
import { alsoAnswersArgsOf } from "./relayAlsoAnswersArgs.js";
import { candidateVerdictOf } from "./relayCandidateArgs.js";
import { relayContentOf } from "./relayContentArgs.js";
import { triageRulingOf } from "./relayTriageArgs.js";

/** The flags `talk relay` accepts. */
const RELAY_FLAGS = {
  boolean: [
    "json",
    "deliver-to-supervisor",
    "screen-failed",
    "screen-not-taken",
    "screen-recording-off",
    "words-alone",
    "typed",
    "heard-stdin",
  ],
  string: [
    "turn",
    "say",
    "heard",
    // Whether a call stretch was still open when the page relayed (`cut`) or every stretch had finished (`whole`).
    "heard-tail",
    "about",
    // The other Queue cards the owner's words answer, repeatable (`./relayAlsoAnswersArgs.ts`).
    "also-answers",
    "read-after",
    "screen",
    "home",
    "dir",
    "priority",
    "covers",
    "candidate",
    "reaction",
    "triage",
    "label",
    "feedback",
    // Whose work the row is, as the page placed the owner's words; passed straight on to `handover register`.
    "workspace",
    "workspace-because",
    // The copy-tray offer the owner was reacting to, staged as a JSON file by the route (`./relayOfferFile.ts`).
    "offered-file",
    // The discuss-first nudge the page put, or the owner's answer to it (`../../../talk/discussFirst.ts`).
    "discuss-first",
    "team-fix",
    "fix-thread",
    "discuss-first-turn",
    // Where the console server that spawned it is serving from (`./consoleOrigin.ts`); a hand run passes none.
    ...CONSOLE_ORIGIN_FLAGS,
  ],
  repeatable: ["also-answers"],
} satisfies FlagSpec;

/**
 * How far a reaction to a check-in reaches, or why `--covers` is refused: it names one of {@link RULING_COVERS},
 * and only beside an `--about act:<id>`, because a ruling is a word on the check-in the owner was read.
 *
 * @param value the flag's value
 * @param about the relay's `--about` key
 * @param problems the parse's running list, which a refusal is appended to
 * @returns the reach, or `undefined` when the flag was absent or refused
 */
function coversOf({
  value,
  about,
  problems,
}: {
  value: string | boolean | undefined;
  about: string;
  problems: string[];
}): RulingCovers | undefined {
  const text = stringOf({ value });
  if (text === undefined) {
    return undefined;
  }
  const covers = RULING_COVERS.find((reach) => reach === text);
  if (covers === undefined) {
    problems.push(`--covers must be ${RULING_COVERS.join(" or ")}, got ${text}`);
    return undefined;
  }
  if (!about.startsWith(CHECK_IN_KEY_PREFIX)) {
    problems.push(
      `--covers records the owner's word on a check-in, so it needs --about ${CHECK_IN_KEY_PREFIX}<actionId>`,
    );
    return undefined;
  }
  return covers;
}

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_RELAY_FLAG_NAMES: readonly string[] = flagNames({ spec: RELAY_FLAGS });

/** A parsed `talk relay` invocation. */
export interface RelayArgs {
  readonly turn: string;
  /** The voice's reading, or empty in heard-only mode, where `--read-after` stands in its place. */
  readonly say: string;
  /** What the voice read after the owner last spoke; non-empty means only the owner's words travel. */
  readonly readAfter: readonly string[];
  /** The page's retry after a refused relay: the owner's words alone, standing in for both `--say` and `--read-after`. */
  readonly wordsAlone: boolean;
  /** The owner typed the steer on the console: `--heard` is the owner's typed words, and there is no voice reading at all. */
  readonly typed: boolean;
  /** The WebP frame of the owner's shared screen the route wrote, or `undefined` for none. */
  readonly screen: string | undefined;
  /** A look at the owner's screen — a share's frame or the desktop app's own still — gave no frame; distinct from no share. */
  readonly screenFailed: boolean;
  /** The owner's screen is shared, but no frame was taken on the owner's word this turn — the relay says so rather than grabbing one. */
  readonly screenNotTaken: boolean;
  /** The desktop app's own look was refused because macOS Screen Recording is off for it: no share was involved. */
  readonly screenRecordingOff: boolean;
  /**
   * The JSON file holding the copy-tray offer the owner was reacting to, or `undefined` when the relay carries none. Spoken
   * relays only: a words-alone retry or a typed steer carries no voice-written text.
   */
  readonly offeredFile: string | undefined;
  /** The owner's own words as the speech recogniser transcribed them, attached by the page — never the model's. */
  readonly heard: string;
  /**
   * The owner's words arrive on stdin rather than as `--heard`: the console's route sends them this way, so no length or
   * byte of the owner's reaches an argv value the spawn could refuse (`getconf ARG_MAX` bounds argv and environment together).
   */
  readonly heardStdin: boolean;
  /**
   * Whether the words end mid-sentence — `true` the page relayed while a call stretch was still open, `false` every
   * stretch had finished — or `undefined` when the caller did not say, which the record keeps as unknown, so it never
   * stands as a whole yes.
   */
  readonly heardTailCut: boolean | undefined;
  /** The console record the owner was looking at, as a `<kind>:<id>` key, or empty. */
  readonly about: string;
  /** The other Queue cards the voice judged the owner's words answer, each landed beside `about`; empty when none. */
  readonly alsoAnswers: readonly string[];
  /** How far the owner's reaction to the `act:` check-in `about` names reaches, or `undefined` when it records no ruling. */
  readonly covers: RulingCovers | undefined;
  /** The owner's ruling on the workstream candidate the voice read to the owner, or `undefined` when it records none. */
  readonly candidateVerdict: CandidateVerdict | undefined;
  /** The owner's verdict and label on the card a triage pass has open, `about`, or `undefined` when it records none. */
  readonly triageRuling: TriageRuling | undefined;
  /** Whose work the row is, as the page placed the owner's words, or `undefined` when it stated none. */
  readonly workspace: StatedWorkspace | undefined;
  /**
   * The discuss-first question the voice put on this relay, or the owner's answer to one it put earlier on the call, when the owner's
   * words ask for a fix on a team repository; `undefined` otherwise. A spoken relay's only.
   */
  readonly discussFirst: DiscussFirstRecord | undefined;
  readonly priority: string;
  /** Type the relay into the pinned supervisor's chat as well as the board — what the console asks for. */
  readonly deliverToSupervisor: boolean;
  /** Where the console server that spawned it is serving from; `undefined` for a hand run. */
  readonly consoleOrigin: ConsoleOriginArgs | undefined;
  readonly dir: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Why `--deliver-to-supervisor` refuses the flags beside it: it types into the owner's real supervisor chat, so the row it
 * points at must be on the real board and the once-per-turn record in the real home.
 *
 * @param values the parsed flags, read for `--dir` and `--home`
 * @returns the refusal, or nothing when the delivery is to the real home
 */
function deliveryProblems({
  deliverToSupervisor,
  values,
}: {
  deliverToSupervisor: boolean;
  values: Readonly<Record<string, string | boolean>>;
}): string[] {
  if (!deliverToSupervisor || (values["dir"] === undefined && values["home"] === undefined)) {
    return [];
  }
  return [
    "--deliver-to-supervisor types into the owner's real supervisor chat, so it takes no --dir or --home: the row it " +
      "points at must be on the real board and the once-per-turn record in the real home",
  ];
}

/** The owner's words arrive one way: as `--heard <words>` or on stdin with `--heard-stdin`, and naming both is refused. */
function heardSourceProblems({ values }: { values: Readonly<Record<string, string | boolean>> }): string[] {
  if (values["heard-stdin"] === true && values["heard"] !== undefined) {
    return ["talk relay takes the owner's words as --heard <words> or on stdin with --heard-stdin, never both"];
  }
  return [];
}

/**
 * What `--heard-tail` says of the words' end: `cut` is `true`, `whole` is `false`, absent is `undefined` — never read as
 * whole, because a page that predates the flag never checked.
 *
 * @param problems the parse's running list, which a refusal is appended to
 * @param value the raw flag value
 * @returns whether the words end mid-sentence, or `undefined` when the flag was absent or refused
 */
function heardTailOf({
  problems,
  value,
}: {
  problems: string[];
  value: string | boolean | undefined;
}): boolean | undefined {
  const text = stringOf({ value });
  if (text === undefined) {
    return undefined;
  }
  if (text !== "cut" && text !== "whole") {
    problems.push(`--heard-tail must be cut or whole, got ${text}`);
    return undefined;
  }
  return text === "cut";
}

/** The refusal for a relay with no `--turn`. */
const TURN_MISSING =
  "talk relay needs --turn <uuid>, which the console page minted for this relay — never a value you chose";

/**
 * The `--priority` a relay files at, `p2` when none is passed, noting a value outside p1–p3 as a problem.
 *
 * @param problems the usage problems this parse collects, appended to
 * @param value the raw flag value
 * @returns the priority as given
 */
function priorityOf({ problems, value }: { problems: string[]; value: string | boolean | undefined }): string {
  const chosen = stringOr({ fallback: "p2", value });
  if (!["p1", "p2", "p3"].includes(chosen)) {
    problems.push(`--priority must be p1, p2 or p3, got ${chosen}`);
  }
  return chosen;
}

/**
 * The rulings a relay may carry, at most one of them: the owner's word on a check-in, on a workstream candidate, or on the
 * card a triage pass has open.
 *
 * @param about the relay's `--about` key, the card or check-in each ruling is on
 * @param problems the parse's running list, which each refusal is appended to
 * @param values the parsed flags
 * @returns each ruling, `undefined` where absent or refused
 */
function rulingsOf({
  about,
  problems,
  values,
}: {
  about: string;
  problems: string[];
  values: Readonly<Record<string, string | boolean>>;
}): Pick<RelayArgs, "candidateVerdict" | "covers" | "triageRuling"> {
  const covers = coversOf({ about, problems, value: values["covers"] });
  const candidateVerdict = candidateVerdictOf({
    candidate: values["candidate"],
    checkIn: values["covers"] !== undefined,
    problems,
    reaction: values["reaction"],
  });
  const triageRuling = triageRulingOf({
    about,
    feedback: values["feedback"],
    label: values["label"],
    otherRuling: values["covers"] !== undefined || values["candidate"] !== undefined,
    problems,
    triage: values["triage"],
  });
  return { candidateVerdict, covers, triageRuling };
}

/** The discuss-first record out of a relay's four flags, and every problem with them; a typed steer carries none. */
function discussFirstOf({ typed, values }: { typed: boolean; values: Readonly<Record<string, string | boolean>> }): {
  readonly record: DiscussFirstRecord | undefined;
  readonly problems: readonly string[];
} {
  const read = discussFirstRecordOf({
    priorTurn: stringOf({ value: values["discuss-first-turn"] }),
    repository: stringOf({ value: values["team-fix"] }),
    status: stringOf({ value: values["discuss-first"] }),
    thread: stringOf({ value: values["fix-thread"] }),
  });
  if ("problems" in read) {
    return { problems: read.problems, record: undefined };
  }
  if (read.record !== undefined && typed) {
    return {
      problems: [
        "talk relay --discuss-first rides a spoken relay only: a typed steer is never put the voice's question",
      ],
      record: undefined,
    };
  }
  return { problems: [], record: read.record };
}

/**
 * Parse a `talk relay` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseRelayArgs({ rest }: { rest: readonly string[] }): Result<RelayArgs> {
  const parsed = parseFlags({ args: rest, spec: RELAY_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const turn = stringOf({ value: values["turn"] });
  const problems: string[] = turn === undefined ? [TURN_MISSING] : [];
  const content = relayContentOf({ problems, values });
  const { typed } = content;
  const chosenPriority = priorityOf({ problems, value: values["priority"] });
  const about = stringOr({ fallback: "", value: values["about"] });
  const { covers, candidateVerdict, triageRuling } = rulingsOf({ about, problems, values });
  const alsoAnswers = alsoAnswersArgsOf({ about, problems, rest, typed });
  const deliverToSupervisor = values["deliver-to-supervisor"] === true;
  problems.push(...deliveryProblems({ deliverToSupervisor, values }), ...heardSourceProblems({ values }));
  const workspace = registerWorkspace({ values });
  problems.push(...("refusal" in workspace ? [workspace.refusal] : []));
  const consoleOrigin = consoleOriginOf({ problems, values });
  const discussFirst = discussFirstOf({ typed, values });
  problems.push(...discussFirst.problems);
  const heardTailCut = heardTailOf({ problems, value: values["heard-tail"] });
  if (problems.length > 0 || turn === undefined || "refusal" in workspace) {
    return err(problems);
  }
  return ok({
    ...content,
    about,
    alsoAnswers,
    candidateVerdict,
    consoleOrigin,
    covers,
    deliverToSupervisor,
    dir: stringOf({ value: values["dir"] }),
    discussFirst: discussFirst.record,
    heard: stringOr({ fallback: "", value: values["heard"] }),
    heardStdin: values["heard-stdin"] === true,
    heardTailCut,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    priority: chosenPriority,
    say: stringOr({ fallback: "", value: content.say }),
    triageRuling,
    turn,
    workspace: workspace.stated,
  });
}
