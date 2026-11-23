/**
 * promptfoo custom assertion for the turn-level judgement cases: scores the model's composed text against
 * the frozen expectations in `turn.cases.json`, looked up by `caseId` — the same lookup-by-var shape as
 * `groundingAssertion.ts`'s lookup-by-question. Deterministic string checks, never another model call: the
 * model call already happened in the provider, and grading it with a SECOND model would make a red result
 * unreproducible.
 *
 * `(output, context)` stays positional — promptfoo's fixed assertion signature.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTurnCases, type TurnCase } from "./turnCaseSchema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CASES = loadTurnCases({ raw: readFileSync(resolve(repoRoot, "eval/turn.cases.json"), "utf8") });

/** Phrases in the prompt data that stand in for a real asker id, checked case-insensitively. */
const ASKER_MARKERS = ["UFIXTUREAB", "the asker"];

/** Wording that reads as acknowledging a worker is genuinely alive and working, not abandoned. */
const LIVE_WORKER_MARKERS = [
  "still running",
  "in progress",
  "already working",
  "already running",
  "workspace:399",
  "is dispatched",
  "was dispatched",
  "actively",
  "picked up",
  "under way",
  "underway",
  "still composing",
  "still going",
];

/** Wording that reads as the reviewer flagging a missing mention of the asker, not approving the draft. */
const MISSING_MENTION_MARKERS = [
  "doesn't mention",
  "does not mention",
  "missing",
  "never mentions",
  "no mention",
  "doesn't tag",
  "does not tag",
  "never tags",
  "not tagged",
  "fails to mention",
  "fails to tag",
];

interface AssertionContext {
  readonly vars: Record<string, unknown>;
}

interface GradingResult {
  readonly pass: boolean;
  readonly score: number;
  readonly reason: string;
}

/** Whether `haystack` contains any of `needles`, case-insensitively. */
function containsAny({ haystack, needles }: { haystack: string; needles: readonly string[] }): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

/** One expectation check's outcome, so a failing case names exactly which property it missed. */
interface CheckOutcome {
  readonly ok: boolean;
  readonly label: string;
}

/** The `forbiddenPhrases` check, or `undefined` when the case declares none. */
function checkForbiddenPhrases({
  text,
  expected,
}: {
  text: string;
  expected: TurnCase["expected"];
}): CheckOutcome | undefined {
  if (expected.forbiddenPhrases === undefined) {
    return undefined;
  }
  const hit = expected.forbiddenPhrases.find((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
  return {
    label: hit === undefined ? "no forbidden phrase present" : `forbidden phrase present: "${hit}"`,
    ok: hit === undefined,
  };
}

/** The `forbiddenGlyphs` check, or `undefined` when the case declares none. */
function checkForbiddenGlyphs({
  text,
  expected,
}: {
  text: string;
  expected: TurnCase["expected"];
}): CheckOutcome | undefined {
  if (expected.forbiddenGlyphs === undefined) {
    return undefined;
  }
  const hit = expected.forbiddenGlyphs.find((glyph) => text.includes(glyph));
  return {
    label: hit === undefined ? "no forbidden glyph present" : `forbidden glyph present: "${hit}"`,
    ok: hit === undefined,
  };
}

/** One `mustXxx` boolean expectation: present a `[met, unmet]` label pair, absent when the case skips it. */
function checkMarkerPresence({
  wanted,
  text,
  needles,
  met,
  unmet,
}: {
  wanted: boolean | undefined;
  text: string;
  needles: readonly string[];
  met: string;
  unmet: string;
}): CheckOutcome | undefined {
  if (wanted !== true) {
    return undefined;
  }
  const ok = containsAny({ haystack: text, needles });
  return { label: ok ? met : unmet, ok };
}

/** Run every expectation `turnCase` declares against the model's composed `text`, in a fixed order. */
function runChecks({ text, turnCase }: { text: string; turnCase: TurnCase }): readonly CheckOutcome[] {
  const expected = turnCase.expected;
  const outcomes = [
    checkForbiddenPhrases({ expected, text }),
    checkForbiddenGlyphs({ expected, text }),
    checkMarkerPresence({
      met: "mentions the live worker",
      needles: LIVE_WORKER_MARKERS,
      text,
      unmet: "does not mention the live worker",
      wanted: expected.mustMentionLiveWorker,
    }),
    checkMarkerPresence({
      met: "mentions the asker",
      needles: ASKER_MARKERS,
      text,
      unmet: "does not mention the asker",
      wanted: expected.mustMentionAsker,
    }),
    checkMarkerPresence({
      met: "flags the missing asker mention",
      needles: MISSING_MENTION_MARKERS,
      text,
      unmet: "does not flag the missing asker mention",
      wanted: expected.mustFlagMissingAskerMention,
    }),
  ];
  return outcomes.filter((outcome): outcome is CheckOutcome => outcome !== undefined);
}

/**
 * Score one model-composed turn against its case's frozen expectations.
 *
 * @param output the model's raw composed text
 * @param context promptfoo's assertion context, whose `vars.caseId` resolves the case
 * @returns the graded result — score is the fraction of declared expectations this text satisfied
 */
// named-object-params-exempt: promptfoo calls a custom assertion as (output, context) positionally
export default function judgementAssertion(output: string, context: AssertionContext): GradingResult {
  const caseId = typeof context.vars["caseId"] === "string" ? context.vars["caseId"] : "";
  const turnCase = CASES.find((candidate) => candidate.id === caseId);
  if (turnCase === undefined) {
    return { pass: false, reason: `no turn case for id: ${caseId}`, score: 0 };
  }
  const outcomes = runChecks({ text: output, turnCase });
  if (outcomes.length === 0) {
    return { pass: false, reason: `case ${caseId} declared no checkable expectations`, score: 0 };
  }
  const failed = outcomes.filter((outcome) => !outcome.ok);
  return {
    pass: failed.length === 0,
    reason: outcomes.map((outcome) => outcome.label).join(" · "),
    score: (outcomes.length - failed.length) / outcomes.length,
  };
}
