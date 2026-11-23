/**
 * `slopweaver onboard` — ask for the two things it cannot derive, render the Slack app manifest to paste,
 * and name what each tier costs.
 *
 * ## A thin shell over a pure render
 *
 * This module resolves two answers and prints a value. It reads no state home, holds no token, opens no
 * socket and writes nothing anywhere — the entire output is `renderOnboardSession` applied to the answers,
 * so the words a new user reads are asserted in a unit test rather than reproduced by running the verb.
 *
 * ## Why this verb may block on input at all
 *
 * The house rule is that no Slopweaver command blocks the terminal waiting for input, because a crawl that
 * stops for a question is a crawl nobody can script. The sanctioned exception is a ONE-SHOT capture that
 * cannot be derived, which is why `secrets set` prompts. Onboarding is the same shape: two questions, asked
 * once, and only when a terminal is actually there to answer them. Given `--tier`/`--app-name`, or run
 * without a TTY, it asks nothing and says which default it took — so a pipe or a CI job never hangs.
 *
 * Every seam that touches the terminal is injected through {@link OnboardDeps}, so the whole branching —
 * flag vs question vs default, and a re-ask after an invalid answer — is exercised with plain fakes.
 */

import type { Logger } from "../../../lib/logger.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { createLinePrompter } from "../../../onboard/prompt.js";
import {
  type AnswerNote,
  type OnboardAnswers,
  renderOnboardJson,
  renderOnboardSession,
} from "../../../onboard/render.js";
import { type OnboardTier, parseAppName, parseTier } from "../../../onboard/tiers.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  APP_NAME_QUESTION,
  answerRoute,
  finalSource,
  type OnboardOptions,
  onboardOptions,
  parseOnboardArgs,
  TIER_QUESTION,
} from "./core.js";
import { type OnboardError, OnboardErrors, onboardErrorLines } from "./errors.js";
import { ONBOARD_USAGE } from "./usage.js";

/** How many times an invalid interactive answer is re-asked before the verb gives up. Bounded, so it cannot hang. */
export const MAX_ANSWER_ATTEMPTS = 3;

/** The seams that touch the terminal. Injected so every branch is testable without a TTY. */
export interface OnboardDeps {
  /** Ask one question and read the answer. */
  readonly ask: (args: { prompt: string }) => Promise<string>;
  /** Release stdin once the questions are done. */
  readonly close: () => void;
  /** Whether stdin is an interactive terminal — i.e. whether a question can actually be answered. */
  readonly isTty: () => boolean;
  readonly logger: Pick<Logger, "out" | "error">;
}

/** One question: what it is called, the flag that skips it, how it is asked, and how its answer is validated. */
interface Question<T> {
  readonly label: string;
  readonly flag: string;
  readonly prompt: string;
  readonly flagValue: string | undefined;
  readonly parse: (args: { value: string }) => Result<T>;
  readonly display: (args: { value: T }) => string;
}

/** An answer, plus the note saying where it came from. */
interface Answer<T> {
  readonly value: T;
  readonly note: AnswerNote;
}

/** Build the note for a resolved answer. */
function noteOf<T>({
  question,
  route,
  raw,
  value,
}: {
  question: Question<T>;
  route: "flag" | "ask" | "default";
  raw: string;
  value: T;
}): AnswerNote {
  return {
    flag: question.flag,
    label: question.label,
    source: finalSource({ raw, route }),
    value: question.display({ value }),
  };
}

/** Validate one raw answer that will not be re-asked — a flagged value, or a taken default. */
function parseOnce<T>({
  question,
  raw,
  route,
}: {
  question: Question<T>;
  raw: string;
  route: "flag" | "ask" | "default";
}): Result<Answer<T>, OnboardError> {
  const parsed = question.parse({ value: raw });
  if (parsed.isErr()) {
    return err(OnboardErrors.answerRefused({ reasons: parsed.error }));
  }
  return ok({ note: noteOf({ question, raw, route, value: parsed.value }), value: parsed.value });
}

/**
 * Resolve one answer: take the flag if there is one, ask if a terminal can answer, otherwise take the
 * default. An invalid interactive answer is reported and re-asked, up to {@link MAX_ANSWER_ATTEMPTS}.
 *
 * @param question the question to resolve
 * @param canAsk whether a question can actually be answered
 * @param deps the injected terminal seams
 * @returns the answer and its note, or the rejections
 */
async function resolveAnswer<T>({
  question,
  canAsk,
  deps,
}: {
  question: Question<T>;
  canAsk: boolean;
  deps: OnboardDeps;
}): Promise<Result<Answer<T>, OnboardError>> {
  const { flagValue } = question;
  const route = answerRoute({ canAsk, flagValue });
  if (route === "ask") {
    for (let attempt = 1; attempt <= MAX_ANSWER_ATTEMPTS; attempt += 1) {
      const raw = await deps.ask({ prompt: question.prompt });
      const parsed = question.parse({ value: raw });
      if (parsed.isOk()) {
        return ok({ note: noteOf({ question, raw, route, value: parsed.value }), value: parsed.value });
      }
      for (const error of parsed.error) {
        deps.logger.error({ msg: error });
      }
    }
    return err(OnboardErrors.answersExhausted({ attempts: MAX_ANSWER_ATTEMPTS, label: question.label }));
  }
  // Nothing was asked. Either a flag supplied the answer, or nothing could have answered a question and the
  // EMPTY answer is what each parser here reads as "take the default" — a real answer, not a fallback
  // standing in for a missing one. Both cases are handled, so an unexpected route can never reach `ask`.
  if (flagValue === undefined) {
    return parseOnce({ question, raw: "", route });
  }
  return parseOnce({ question, raw: flagValue, route });
}

/**
 * Ask (or derive) both answers, always releasing stdin afterwards.
 *
 * @param options what the verb was asked to do
 * @param deps the injected terminal seams
 * @returns the answers and their notes, or the rejections
 */
async function collectAnswers({
  options,
  deps,
}: {
  options: OnboardOptions;
  deps: OnboardDeps;
}): Promise<Result<{ answers: OnboardAnswers; notes: readonly AnswerNote[] }, OnboardError>> {
  // `--json` is a machine lane: it asks nothing, so a script never gets a question mixed into its output.
  const canAsk = !options.json && deps.isTty();
  try {
    const name = await resolveAnswer({
      canAsk,
      deps,
      question: {
        display: ({ value }) => value,
        flag: "--app-name",
        flagValue: options.appName,
        label: "app name",
        parse: parseAppName,
        prompt: APP_NAME_QUESTION,
      },
    });
    if (name.isErr()) {
      return err(name.error);
    }
    const tier = await resolveAnswer<OnboardTier>({
      canAsk,
      deps,
      question: {
        display: ({ value }) => value,
        flag: "--tier",
        flagValue: options.tier,
        label: "tier",
        parse: parseTier,
        prompt: TIER_QUESTION,
      },
    });
    if (tier.isErr()) {
      return err(tier.error);
    }
    return ok({
      // `identity` and `mailboxZone` carry no note: a note says where an ANSWER came from, and these two
      // are never asked and never defaulted — they are present as typed, or absent and rendered as absent.
      answers: {
        appName: name.value.value,
        identity: options.identity,
        mailboxZone: options.mailboxZone,
        tier: tier.value.value,
      },
      notes: [name.value.note, tier.value.note],
    });
  } finally {
    deps.close();
  }
}

/**
 * `slopweaver onboard` with its terminal seams injected — the whole verb, minus the wiring.
 *
 * @param argv the full process argv
 * @param deps the injected terminal seams
 * @returns the process exit code
 */
export async function runOnboardWith({ argv, deps }: { argv: readonly string[]; deps: OnboardDeps }): Promise<number> {
  const tail = argv.slice(3);
  const rest = tail[0] === "run" ? tail.slice(1) : tail;
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: ONBOARD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseOnboardArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      deps.logger.error({ msg: error });
    }
    deps.logger.error({ msg: ONBOARD_USAGE });
    return EXIT_USAGE;
  }
  const options = onboardOptions({ parsed: parsed.value });
  const collected = await collectAnswers({ deps, options });
  if (collected.isErr()) {
    for (const error of onboardErrorLines({ error: collected.error })) {
      deps.logger.error({ msg: error });
    }
    deps.logger.error({ msg: ONBOARD_USAGE });
    return EXIT_USAGE;
  }
  const { answers, notes } = collected.value;
  const rendered = options.json ? [renderOnboardJson({ answers, notes })] : renderOnboardSession({ answers, notes });
  for (const line of rendered) {
    deps.logger.out({ line });
  }
  return EXIT_OK;
}

/** The live seams: the real readline, the real stdin, the real logger. */
function liveDeps(): OnboardDeps {
  const prompter = createLinePrompter();
  return {
    ask: prompter.ask,
    close: prompter.close,
    isTty: () => process.stdin.isTTY === true,
    logger,
  };
}

/**
 * `slopweaver onboard` — the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runOnboard(argv: readonly string[]): Promise<number> {
  return runOnboardWith({ argv, deps: liveDeps() });
}

export const onboardCommand = defineCommand({ run: runOnboard });
