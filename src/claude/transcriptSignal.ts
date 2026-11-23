/**
 * Classify one Claude Code transcript line as a plan limit, a refusal that must be IGNORED, or nothing.
 *
 * This is the REACTIVE lane, and it exists because the proactive one is not reachable. The
 * `anthropic-ratelimit-unified-*` headers arrive on the Claude Code CLI's own HTTP responses, which no
 * Slopweaver process sees; a successful response carrying `allowed_warning` may not be persisted at all.
 * A refusal, by contrast, IS written into `~/.claude/projects/**.jsonl` as
 * `{"isApiErrorMessage":true,"apiErrorStatus":429, …}`, so a Stop hook can read it. Until an
 * `allowed_warning` is proven readable, this is the signal a rotation can actually depend on, and
 * `usage.ts`'s probe is what makes rotation proactive instead.
 *
 * ## Structure first, prose second — and four things that look like a plan limit and are not
 *
 * The classifier refuses to read prose until the STRUCTURE says the line is a `429` API error, because
 * matching phrases in arbitrary transcript text would classify a session that merely discussed a rate limit.
 * Once past that gate, the phrases below are matched against measurements from this machine's own
 * transcripts, with all-time counts at the time of measuring (reproduce with
 * `rg -c 'isApiErrorMessage' ~/.claude/projects`):
 *
 * - **80×** `You've hit your session limit · resets <t>` → `five_hour`, ROTATE.
 * - **15×** `You've hit your weekly limit · resets <d> at <t>` → `seven_day`, ROTATE.
 * - **26×** `You've hit your individual spend limit` → a different budget entirely. IGNORE.
 * - **9×** `You've reached your <model> limit` → a model-scoped cap; the answer is a model downgrade
 *   (doctrine rule 5), not a plan switch. IGNORE.
 * - **64×** `API Error: 529 Overloaded` → server-side and transient; never a plan limit, and rotating on it
 *   would burn a healthy plan for nothing. IGNORE, and it never reaches the prose test because its status
 *   is not `429`.
 *
 * The reset instant the message quotes is deliberately NOT parsed into a timestamp here: it is a local-time
 * phrase (`resets <time> (<timezone>)`) with no date, and deriving an instant from it by hand is
 * the exact class of error `slopweaver slack when` exists to prevent. The authoritative reset comes from the
 * gauge's own absolute epoch-second header instead.
 */
import { isRecord } from "../lib/parsers.js";
import type { ClaudeLimitSignal, ClaudeRateClaim } from "./contracts.js";

/**
 * Which model-scoped claim a refusal names. Opus and Sonnet have their own weekly claims; anything else
 * this build does not recognise by name falls back to the Opus claim, because the RESPONSE is identical for
 * every model-scoped claim and the alternative is dropping the signal entirely.
 *
 * @param text the refusal message
 * @returns the model-scoped claim to report
 */
function modelClaimFor({ text }: { text: string }): ClaudeRateClaim {
  return /sonnet/i.test(text) ? "seven_day_sonnet" : "seven_day_opus";
}

/** The only HTTP status a plan limit is ever reported under. */
const LIMIT_STATUS = 429;

/** Matched only after the structural gate; anchored on the provider's own wording. */
const SESSION_LIMIT = /hit your session limit/i;
const WEEKLY_LIMIT = /hit your weekly limit/i;
const SPEND_LIMIT = /hit your individual spend limit/i;
const MODEL_LIMIT = /reached your \S+ limit/i;

/**
 * Flatten a transcript record's message content into plain text. Content is either a string or the
 * block array the API returns, and only `text` blocks carry anything a classifier can read.
 *
 * @param value the `message.content` field, whatever shape it arrived in
 * @returns the concatenated text, or an empty string when there is none
 */
function contentText({ value }: { value: unknown }): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((block) => (isRecord(block) && typeof block["text"] === "string" ? block["text"] : "")).join(" ");
}

/**
 * Classify one already-parsed transcript record.
 *
 * @param record one line of a Claude Code session JSONL, already decoded
 * @returns what the line says about the plan's limits
 */
export function classifyLimitRecord({ record }: { record: unknown }): ClaudeLimitSignal {
  if (!isRecord(record) || record["isApiErrorMessage"] !== true) {
    return { kind: "none", reason: "not an API error record" };
  }
  const status = record["apiErrorStatus"];
  if (status !== LIMIT_STATUS) {
    return { kind: "ignored", reason: `apiErrorStatus ${String(status)} is not a plan limit` };
  }
  const message = record["message"];
  const text = contentText({ value: isRecord(message) ? message["content"] : record["content"] });

  if (SPEND_LIMIT.test(text)) {
    return { kind: "ignored", reason: "individual spend limit — a different budget" };
  }
  if (SESSION_LIMIT.test(text)) {
    return { claim: "five_hour", kind: "plan-limit", reason: "session limit refused" };
  }
  if (WEEKLY_LIMIT.test(text)) {
    return { claim: "seven_day", kind: "plan-limit", reason: "weekly limit refused" };
  }
  if (MODEL_LIMIT.test(text)) {
    // Reported as a plan-limit CARRYING its claim, not swallowed as "ignored". What to do about it is
    // `claimResponse.ts`'s decision and depends on the seat: a worker changes model, and the supervisor
    // chair rotates the plan because it may not be moved off Fable. Classifying it as "ignored" here made
    // that rule unreachable, which is a defect this comment exists to stop anyone reintroducing.
    return { claim: modelClaimFor({ text }), kind: "plan-limit", reason: "a model-scoped cap refused" };
  }
  return { kind: "ignored", reason: "a 429 this classifier does not recognise as a plan limit" };
}

/**
 * Classify one raw JSONL line, tolerating anything that is not valid JSON.
 *
 * @param line one raw line from a session transcript
 * @returns what the line says about the plan's limits
 */
export function classifyLimitLine({ line }: { line: string }): ClaudeLimitSignal {
  try {
    return classifyLimitRecord({ record: JSON.parse(line) });
  } catch {
    return { kind: "none", reason: "unparseable transcript line" };
  }
}
