/*
 * The console's semantic tones: which colour a provider's word draws in.
 *
 * Every chip, tag and count on the console takes its colour from a word a verb prints. The words map here,
 * once, onto the five tones the badge primitive draws (`components/ui/badge.tsx`), so a new word the verb starts
 * printing draws in a stated fallback rather than in no colour at all.
 */
import type { Seat } from "./seat";

/** The five tones a console badge draws in; `neutral` is the muted pill, the rest are the archive's hues. */
export type SemanticTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * The tone of a pull request's CI word, as `github landing` prints it.
 *
 * @param ci `green`, `red`, `running`, or a word the verb has started printing since
 * @returns green is success, red danger, running warning, and anything else info
 */
export function pullRequestCiTone({ ci }: { ci: string }): SemanticTone {
  switch (ci) {
    case "green":
      return "success";
    case "red":
      return "danger";
    case "running":
      return "warning";
    default:
      return "info";
  }
}

/**
 * The tone of a pull request's next act, as `github landing` names it.
 *
 * @param action the verb's action word for the row, or `sync-slack` or `wait-on-channel` when that is the act its
 *   wait names
 * @returns press is success, a fleet repair warning, a human's move danger, a draft or a Slack history too stale
 *   to say whose move it is neutral, anything else — a channel that has the row included — info
 */
export function pullRequestActionTone({ action }: { action: string }): SemanticTone {
  switch (action) {
    case "press":
    case "queued":
      return "success";
    case "conflicting":
    case "spawn-ci":
    case "spawn-coderabbit":
      return "warning";
    case "blocked-on":
    case "answer-threads":
      return "danger";
    // A stale Slack history cannot say whose move it is, so `sync-slack` never draws red.
    case "draft":
    case "sync-slack":
      return "neutral";
    default:
      return "info";
  }
}

/**
 * The tone of a pull request's watch cell, from the checks-read register.
 *
 * @param watch `watched`, `stale`, `none` or `unknown`
 * @returns watched is success, stale warning, an unreadable fold danger, and no watcher neutral
 */
export function pullRequestWatchTone({ watch }: { watch: "watched" | "stale" | "none" | "unknown" }): SemanticTone {
  switch (watch) {
    case "watched":
      return "success";
    case "stale":
      return "warning";
    case "unknown":
      return "danger";
    case "none":
      return "neutral";
  }
}

/**
 * The tone of a pull request's seat cell.
 *
 * @param kind which of the seat's closed set of sentences it is (`lib/seat.ts`)
 * @returns someone on it — a channel included — is info, paused or nobody danger, and a seat this machine cannot
 *   place — or one whose Slack history is too stale to say whether anyone was asked — neutral
 */
export function seatTone({ kind }: { kind: Seat["kind"] }): SemanticTone {
  switch (kind) {
    case "seated":
    case "shared":
      return "info";
    case "paused":
    case "nobody":
      return "danger";
    case "unattended":
    case "unmatched":
    case "unknown":
    case "stale-history":
      return "neutral";
  }
}

/**
 * The badge variant a tone draws as (`components/ui/badge.tsx`): the four hues by their own names, and
 * `neutral` as the muted pill.
 *
 * @returns the variant name
 */
export function toneVariant({ tone }: { tone: SemanticTone }): "muted" | "info" | "success" | "warning" | "danger" {
  if (tone === "neutral") {
    return "muted";
  }
  return tone;
}
