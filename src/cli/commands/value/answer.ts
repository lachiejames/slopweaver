/**
 * `slopweaver value answer` — record the owner's one word for one sampled ask, and withdraw the week's card once
 * every ask carries one.
 *
 * The owner answers on the Queue card or to the supervisor; a session records it here. A recorded answer is the
 * owner's word and is never replaced: the same answer again is a no-op, a different one is refused
 * (`../../../value/store.ts`). Effectful edge only.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { slopweaverHome } from "../../../homeDir.js";
import { valueSampleSlug } from "../../../value/render.js";
import {
  answerSample,
  readSample,
  sampleComplete,
  VALUE_ANSWERS,
  type ValueAnswer,
  writeSample,
} from "../../../value/store.js";
import { sampleWeekOf } from "../../../value/week.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { openCardAt } from "../automation/fleetCeilingDelivery.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { runHandoverWithdraw } from "../handover/withdrawRun.js";
import { ANSWER_USAGE, flag, parseValueAnswerArgs, VERB_ARG_OFFSET } from "./core.js";

/** What became of the week's card after an answer. */
export type CardOutcome = "still-asking" | "withdrawn" | "none-open";

/** Everything `value answer` touches outside the sample store, injected so a test drives the whole verb. */
export interface ValueAnswerDeps {
  readonly nowIso: () => string;
  readonly withdrawCard: (args: { home: string; slug: string }) => Promise<Result<"withdrawn" | "none-open">>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Whether a string is one of the three answers. */
function isValueAnswer(value: string): value is ValueAnswer {
  return (VALUE_ANSWERS as readonly string[]).includes(value);
}

/** The week `--week` names, else the one the clock is in, or `undefined` when the clock names none. */
function answerWeek({
  nowIso,
  values,
}: {
  nowIso: string;
  values: Readonly<Record<string, unknown>>;
}): string | undefined {
  const named = flag({ name: "week", values });
  if (named !== undefined) {
    return named;
  }
  return sampleWeekOf({ nowIso });
}

/** The parsed request, or the usage problems. */
function requestOf({
  nowIso,
  rest,
}: {
  nowIso: string;
  rest: readonly string[];
}): Result<{ readonly answer: ValueAnswer; readonly home: string; readonly slug: string; readonly week: string }> {
  const parsed = parseValueAnswerArgs({ rest });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const slug = flag({ name: "slug", values });
  const answer = flag({ name: "answer", values });
  const problems: string[] = [];
  if (slug === undefined) {
    problems.push("--slug is required");
  }
  if (answer === undefined || !isValueAnswer(answer)) {
    problems.push(`--answer must be one of ${VALUE_ANSWERS.join(", ")}`);
  }
  const week = answerWeek({ nowIso, values });
  if (week === undefined) {
    problems.push(`the clock read ${nowIso}, which names no week; pass --week`);
  }
  if (
    problems.length > 0 ||
    slug === undefined ||
    answer === undefined ||
    !isValueAnswer(answer) ||
    week === undefined
  ) {
    return err(problems);
  }
  let home = slopweaverHome();
  const named = flag({ name: "home", values });
  if (named !== undefined) {
    home = named;
  }
  return ok({ answer, home, slug, week });
}

/**
 * Run `value answer` against injected seams.
 *
 * @param rest the argv tail after `value answer`
 * @param deps the clock, the card withdrawal and the two output channels
 * @returns the process exit code
 */
export async function runValueAnswer({
  deps,
  rest,
}: {
  deps: ValueAnswerDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ANSWER_USAGE);
    return EXIT_OK;
  }
  const nowIso = deps.nowIso();
  const request = requestOf({ nowIso, rest });
  if (request.isErr()) {
    request.error.forEach((problem) => {
      deps.writeDiagnostic(`value answer: ${problem}`);
    });
    deps.writeDiagnostic(ANSWER_USAGE);
    return EXIT_USAGE;
  }
  const { answer, home, slug, week } = request.value;
  // Two answers recorded at once would each merge into the same stale read, and the later write would drop the
  // earlier answer or carry a conflicting one past the check. The read, merge and write therefore run under one
  // lock per week.
  const lock = acquireOperationLock({ home, key: valueSampleLockKey({ week }), nowIso });
  if (lock.isErr()) {
    deps.writeDiagnostic(`value answer: another answer for ${week} is being recorded (${lock.error}); run it again`);
    return EXIT_ERROR;
  }
  try {
    return await recordUnderLock({ answer, deps, home, nowIso, slug, week });
  } finally {
    lock.value.release();
  }
}

/** The lock key every answer to one week's sample shares. */
function valueSampleLockKey({ week }: { week: string }): string {
  return `value-sample:${week}`;
}

/** Read, merge and write one answer, then withdraw the card when it was the last. Runs under the week's lock. */
async function recordUnderLock({
  answer,
  deps,
  home,
  nowIso,
  slug,
  week,
}: {
  answer: ValueAnswer;
  deps: ValueAnswerDeps;
  home: string;
  nowIso: string;
  slug: string;
  week: string;
}): Promise<number> {
  const read = readSample({ home, week });
  if (read.isErr()) {
    deps.writeDiagnostic(`value answer: ${read.error.message}`);
    return EXIT_ERROR;
  }
  if (read.value === undefined) {
    deps.writeDiagnostic(`value answer: no sample was drawn for ${week}; run value sample first`);
    return EXIT_ERROR;
  }
  const answered = answerSample({ answer, nowIso, sample: read.value, slug });
  if (answered.isErr()) {
    deps.writeDiagnostic(`value answer: ${answered.error.message}`);
    return EXIT_ERROR;
  }
  const { changed, sample } = answered.value;
  if (changed) {
    const written = writeSample({ home, sample });
    if (written.isErr()) {
      deps.writeDiagnostic(`value answer: ${written.error.message}`);
      return EXIT_ERROR;
    }
  }
  const remaining = sample.asks.filter((ask) => sample.answers[ask.slug] === undefined).length;
  let card: CardOutcome = "still-asking";
  if (sampleComplete({ sample })) {
    const withdrawn = await deps.withdrawCard({ home, slug: valueSampleSlug({ week }) });
    if (withdrawn.isErr()) {
      deps.writeDiagnostic(
        `value answer: the answer is kept, but the card was not withdrawn: ${withdrawn.error.join("; ")}`,
      );
      return EXIT_ERROR;
    }
    card = withdrawn.value;
  }
  const verb = changed ? "recorded" : "already recorded";
  deps.writeOut(
    `value answer: ${verb} ${slug} ${answer} for ${week}, ${String(remaining)} still unanswered, card ${card}`,
  );
  return EXIT_OK;
}

/**
 * Withdraw the week's card when it still waits open; a card already settled or absent is left alone.
 *
 * @param home the state home the card lives under
 * @param slug the week's card slug
 * @returns withdrawn, none-open, or why the card could not be read or withdrawn
 */
export async function withdrawValueSampleCard({
  home,
  slug,
}: {
  home: string;
  slug: string;
}): Promise<Result<"withdrawn" | "none-open">> {
  const open = openCardAt({ handoverDir: resolveHandoverDir({ dir: undefined, home }), slug });
  if (open.isErr()) {
    return err([open.error.message]);
  }
  if (!open.value) {
    return ok("none-open");
  }
  const why = "every ask in the week's value sample carries the owner's answer";
  const code = await runHandoverWithdraw([
    "node",
    "slopweaver",
    "handover",
    "withdraw",
    slug,
    "--why",
    why,
    "--home",
    home,
  ]);
  if (code !== EXIT_OK) {
    return err([`handover withdraw exited ${String(code)}`]);
  }
  return ok("withdrawn");
}

/** `slopweaver value answer`. */
export const valueAnswerCommand = defineCommand({
  run: (argv) =>
    runValueAnswer({
      deps: {
        nowIso: () => new Date().toISOString(),
        withdrawCard: withdrawValueSampleCard,
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
