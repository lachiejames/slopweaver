/*
 * The pure fixtures every `runTurn` test file shares: the answer a query hands back, the mention a transport
 * hands over, the provenance, the coverage, and the accessors that read one field off a durable completion.
 */
import type { Mention } from "../../../../../live/listen/mention.js";
import type { TurnCompletion } from "../../../../../live/turn/envelope.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import type { CoverageManifest } from "../../../../../retrieval/coverage.js";

/**
 * Whether the completion's primary outcome is `answered`.
 *
 * @returns true only when the primary outcome is `answered`
 */
export function answered(completion: TurnCompletion): boolean {
  return completion.primary.kind === "answered";
}

/**
 * The answer timestamp, when the primary outcome is `answered`.
 *
 * @returns the posted answer's ts, or undefined on any other ending
 */
export function answerTs(completion: TurnCompletion): string | undefined {
  return completion.primary.kind === "answered" ? completion.primary.answerTs : undefined;
}

/**
 * The notice timestamp, when the primary outcome is `withheld` or `failed`.
 *
 * @returns the posted notice's ts, or undefined on any other ending
 */
export function noticeTs(completion: TurnCompletion): string | undefined {
  return completion.primary.kind === "withheld" || completion.primary.kind === "failed"
    ? completion.primary.noticeTs
    : undefined;
}

/**
 * The failure reason, when the primary outcome is `failed`.
 *
 * @returns the failure's reason, or undefined on any other ending
 */
export function failureReason(completion: TurnCompletion): string | undefined {
  return completion.primary.kind === "failed" ? completion.primary.reason : undefined;
}

/**
 * The withheld draft's id/code/reason, when the primary outcome is `withheld`.
 *
 * @returns the held draft's identity, or undefined on any other ending
 */
export function withheldOf(
  completion: TurnCompletion,
): { readonly id: string; readonly code: string; readonly reason: string } | undefined {
  return completion.primary.kind === "withheld" ? completion.primary.held : undefined;
}

/**
 * The title-secondary-failure's reason, when one fired.
 *
 * @returns the title failure's reason, or undefined when none fired
 */
export function titleFailure(completion: TurnCompletion): string | undefined {
  return completion.secondaryFailures.find((failure) => failure.kind === "title")?.reason;
}

/**
 * Every status-secondary-failure's reason, in order — set first, then clear.
 *
 * @returns each status failure's reason, empty when none fired
 */
export function statusFailures(completion: TurnCompletion): readonly string[] {
  return completion.secondaryFailures.filter((failure) => failure.kind === "status").map((failure) => failure.reason);
}

/**
 * The checklist-secondary-failure's reason, when one fired.
 *
 * @returns the checklist failure's reason, or undefined when none fired
 */
export function checklistFailure(completion: TurnCompletion): string | undefined {
  return completion.secondaryFailures.find((failure) => failure.kind === "checklist")?.reason;
}

/** The coverage a query reports alongside its answer. */
export const COVERAGE: CoverageManifest = {
  legs: [{ detail: "newest record is 0.3d old", indexed: 10, ingested: 10, leg: "github", skipped: [], state: "ok" }],
};

/** A `verb`-grounded answer — no corpus interplay needed for these ordering tests. */
export const ANSWER: AnswerFormAnswer = {
  body: [{ runs: [{ text: "Markdown is inert inside rich_text.", type: "text" }], type: "paragraph" }],
  citations: [],
  documents: [],
  grounding: {
    capability: { command: ["fleet", "status"], id: "fleet-status", what: "every open pull request" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "claude -p", skillsLoaded: [], verbsLoaded: [] },
    result: "all green",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "We render rich_text.",
  measurements: [],
};

/** The honest empty case — an answer with nothing to say beyond the lead. */
export const EMPTY_ANSWER: AnswerFormAnswer = {
  ...ANSWER,
  body: [],
  lead: "No records in the world model matched that question.",
};

/**
 * A mention as the TRANSPORT hands it over: `text` already has every tag stripped and trimmed, because
 * `src/live/listen/mention.ts` does that before a turn ever sees it.
 */
export const MENTION: Mention = {
  channel: "C1",
  messageTs: "1712345678.000200",
  surface: "channel",
  text: "what did we decide about the renderer?",
  threadTs: "1712345678.000100",
  userId: "U_ASKER",
};

/** The same question, arriving in a 1:1 DM — the surface that also gets a thread title. */
export const DM_MENTION: Mention = { ...MENTION, channel: "D1", surface: "dm" };

/** The visible session a turn reports it ran in. */
export const PROVENANCE = { modelId: "visible supervisor", supervisor: { host: "codex", id: "thread-1" } } as const;
