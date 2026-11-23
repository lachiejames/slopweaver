/**
 * `slopweaver profile steers` — which kind of correction each turn from the owner names about the Slack drafts written as
 * them, the turns nobody has read for it yet, and the one write that journals a read.
 *
 * The shell is here; what a verdict is, what a candidate is and how a reading folds is `src/profile/steerKinds.ts`.
 * Their turns come from `profile words`' own gather, so the two verbs can never disagree about what they said.
 */
import { join } from "node:path";

import { resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  foldSteerVerdicts,
  quoteIsVerbatim,
  type SteerCandidate,
  type SteerVerdict,
  steerKindsReading,
  unreadSteerCandidates,
} from "../../../profile/steerKinds.js";
import { steerKindsLines } from "../../../profile/steerKindsLines.js";
import { type SteerMeasurementPort, steerMeasurementPort } from "../../../profile/steerMeasurementPort.js";
import { readProfile } from "../../../profileStore.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "../talk/args.js";
import { profileTail } from "./core.js";
import { type ProfileSteersArgs, parseProfileSteersArgs } from "./steersArgs.js";
import { PROFILE_STEERS_USAGE } from "./steersUsage.js";
import { wordsWindow } from "./wordsArgs.js";
import { gatherOwnerWords } from "./wordsRun.js";

/** Journal one read, after checking the turn is theirs and holds the quoted words. */
async function judge({
  args,
  home,
  claudeHome,
  nowIso,
  out,
  steers,
}: {
  args: Extract<ProfileSteersArgs, { mode: "judge" }>;
  home: string;
  claudeHome: string;
  nowIso: string;
  out: (line: string) => void;
  steers: SteerMeasurementPort;
}): Promise<number> {
  const { anchor, judgement } = args;
  const raw = resolveRawWords({ anchor, home, projectsDir: join(claudeHome, "projects") });
  if (raw.isErr()) {
    out(`profile steers judge: ${raw.error.message}`);
    return EXIT_ERROR;
  }
  const at = Date.parse(raw.value.atIso);
  if (raw.value.text.trim() === "" || Number.isNaN(at)) {
    out(`profile steers judge: ${anchor} holds no turn from the owner with an instant, so there is nothing to judge`);
    return EXIT_ERROR;
  }
  // The console's own line at a transcript anchor is refused by the read (`TURN_CONSOLE_LINE`), naming what to judge.
  const turnAtIso = new Date(at).toISOString();
  let verdict: SteerVerdict;
  if (judgement.mode === "nothing") {
    verdict = { anchor, judgedAtIso: nowIso, says: "nothing", turnAtIso };
  } else if (judgement.mode === "withdraw") {
    verdict = { anchor, judgedAtIso: nowIso, kind: judgement.kind, says: "withdrawn" };
  } else {
    if (!quoteIsVerbatim({ quote: judgement.quote, text: raw.value.text })) {
      out(`profile steers judge: ${anchor} does not hold those words verbatim — quote the turn, never a paraphrase`);
      return EXIT_ERROR;
    }
    verdict = {
      anchor,
      judgedAtIso: nowIso,
      kind: judgement.kind,
      quote: judgement.quote,
      says: judgement.says,
      turnAtIso,
    };
  }
  const written = await steers.append({ home, verdict });
  if (written.isErr()) {
    out(`profile steers judge: ${written.error.message}`);
    return EXIT_ERROR;
  }
  out(`judged ${anchor}: ${verdict.says}${"kind" in verdict ? ` ${verdict.kind}` : ""}`);
  return EXIT_OK;
}

/** Print the oldest unread candidates, each turn whole beneath its anchor. */
function printUnread({
  args,
  unread,
  gaps,
  sinceIso,
  out,
}: {
  args: Extract<ProfileSteersArgs, { mode: "unread" }>;
  unread: readonly SteerCandidate[];
  gaps: readonly string[];
  sinceIso: string;
  out: (line: string) => void;
}): void {
  const shown = unread.slice(0, args.limit);
  if (args.json) {
    out(safeJsonStringify({ label: "profile steers unread", value: { gaps, shown, unread: unread.length } }));
    return;
  }
  out(
    `${String(unread.length)} cued turn(s) since ${sinceIso.slice(0, 10)} not yet read; the oldest ${String(shown.length)}:`,
  );
  shown.forEach((one) => {
    out(`${one.atIso.slice(0, 16)}Z  ${one.how}  ${one.anchor}  cued: ${one.cued.join(", ")}`);
    one.text.split("\n").forEach((line) => {
      out(`    ${line}`);
    });
  });
}

/**
 * The verb's body with its inputs injected — what the unit test drives, since `logger.out` cannot be read back.
 *
 * @param args the parsed flags
 * @param home the Slopweaver home
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param nowIso the instant a relative `--since` counts back from, and a verdict's judging instant
 * @param out where each line goes
 * @param steers the door the measurements are read and appended through — the store, in production
 * @returns 0 on a reading or a journalled verdict, 1 when the store, the old journal or a turn would not read, 2 on
 *   a bad window
 */
export async function profileSteers({
  args,
  home,
  claudeHome,
  nowIso,
  out,
  steers,
}: {
  args: ProfileSteersArgs;
  home: string;
  claudeHome: string;
  nowIso: string;
  out: (line: string) => void;
  steers: SteerMeasurementPort;
}): Promise<number> {
  if (args.mode === "judge") {
    return judge({ args, claudeHome, home, nowIso, out, steers });
  }
  const window = wordsWindow({ nowIso, since: args.since, until: args.until });
  if (window.isErr()) {
    window.error.forEach((problem) => {
      out(`profile steers: ${problem}`);
    });
    return EXIT_USAGE;
  }
  // An outage is a refusal, never an empty reading: the Alignment page would draw "nothing judged" over their reads.
  const history = await steers.readHistory({ home });
  if (history.isErr()) {
    out(`profile steers: ${history.error.message}`);
    return EXIT_ERROR;
  }
  const { unparsed, verdicts } = history.value;
  const { sinceIso, untilIso } = window.value;
  const gathered = gatherOwnerWords({ claudeHome, home, sinceIso, untilIso });
  const utterances = gathered.utterances.filter((one) => one.atIso >= sinceIso && one.atIso < untilIso);
  const bot = botHandlesOf({ home });
  const gaps = [...gathered.gaps.map((gap) => `${gap.source}: ${gap.why}`), ...bot.gaps];
  const botHandles = bot.handles;
  if (args.mode === "unread") {
    const unread = unreadSteerCandidates({ botHandles, read: foldSteerVerdicts({ verdicts }).read, utterances });
    printUnread({ args, gaps, out, sinceIso, unread });
    return EXIT_OK;
  }
  const reading = steerKindsReading({ botHandles, gaps, nowIso, sinceIso, unparsed, utterances, verdicts });
  if (args.json) {
    out(safeJsonStringify({ label: "profile steers", value: reading }));
  } else {
    steerKindsLines({ reading }).forEach((line) => {
      out(line);
    });
  }
  return EXIT_OK;
}

/**
 * The bot's own Slack handles, as this home's `profile.json` records them, so a turn naming the bot by handle is
 * offered for reading. Offering none is always said among the gaps — a profile that would not read, or one
 * declaring no `slackBot.selfHandles` — because the role word `the bot` alone then places a turn, and a reading
 * that quietly misses turns naming the bot by handle would read as complete.
 *
 * @param home the Slopweaver home
 * @returns the handles, and the gap left when there are none
 */
function botHandlesOf({ home }: { home: string }): { handles: readonly string[]; gaps: readonly string[] } {
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return {
      gaps: [`profile.json: ${profile.error.message} — a turn naming the bot by handle is not offered`],
      handles: [],
    };
  }
  const handles = profile.value?.slackBot?.selfHandles;
  if (handles === undefined || handles.length === 0) {
    return {
      gaps: ["profile.json: declares no slackBot.selfHandles — a turn naming the bot by handle is not offered"],
      handles: [],
    };
  }
  return { gaps: [], handles };
}

/**
 * Run the `profile steers` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfileSteers(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PROFILE_STEERS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProfileSteersArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: PROFILE_STEERS_USAGE });
    return EXIT_USAGE;
  }
  let nowIso = new Date().toISOString();
  if (parsed.value.now !== undefined) {
    nowIso = new Date(parsed.value.now).toISOString();
  }
  return profileSteers({
    args: parsed.value,
    claudeHome: claudeHomeDir(),
    home: talkHomeOf({ home: parsed.value.home }),
    nowIso,
    out: (line) => {
      logger.out({ line });
    },
    steers: steerMeasurementPort(),
  });
}

export const profileSteersCommand = defineCommand({ run: runProfileSteers });
