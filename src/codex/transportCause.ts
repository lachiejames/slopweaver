/**
 * What a transport fault SAID, captured once and rendered as one bounded line.
 *
 * The defect this exists for, measured: every fatal Codex pass on this install recorded the same
 * constant, `the Codex transport failed`, while Codex's own rollout log named the workspace spend cap. The
 * rule-9 gate then refused every landing on the branch without being able to say why, and four sessions spent
 * passes narrowing diffs before a one-line task file proved the transport itself was refusing. Reproduce the
 * shape of the record set: `grep -l '"the Codex transport failed"' ~/.slopweaver/orchestration/*\/record.json | wc -l`.
 *
 * Pure: an `IngestError` and the stream's last reported failure in, a cause out.
 */

import { absentAs, absentAsNull } from "#lib/absent.js";
import type { IngestError } from "../lib/ingestError.js";
import { isRecord } from "../lib/parsers.js";
import { transportFaultRefusal } from "./policyRefusal.js";
import { detectExhaustionBanner } from "./quotaBanner.js";
import { type CodexQuotaKind, isCodexQuotaKind, PRIOR_WINDOW_LIMIT_KIND } from "./quotaTypes.js";
import type { TransportFaultCause } from "./types.js";

/** How much of a cause survives into a one-line clause — a thrown exit error can carry a whole stderr. */
const CAUSE_PREVIEW_CHARS = 200;

/*
 * ## Where the wording is matched, and why it is no longer matched here
 *
 * This file carried its own regex over the two captured exhaustion sentences and mapped BOTH to
 * `credits-out`, on the reasoning that neither self-clears on a clock. That was defensible while nothing else
 * told them apart — and stopped being defensible the moment `./quotaLog.ts` started classifying the same two
 * sentences off Codex's own reached types, which call the spend cap `workspace_member_usage_limit_reached`.
 * One event then had two labels depending on which reader saw it.
 *
 * So the wording lives in `./quotaBanner.ts` alone, where it was captured against a real exhausted account,
 * and this module asks it. Behaviour is unchanged in every case — neither kind self-clears — and what is
 * gone is the disagreement.
 *
 * A quota state is still deliberately NOT inferred from an HTTP 429, an exit code or `usage_limit_exceeded`
 * alone: none of those was measured to mean one exhaustion rather than another, and a guessed quota state is
 * worse than an unclassified one.
 */

/** The text itself when it has anything visible in it, otherwise undefined. */
function nonBlank({ text }: { text: string | undefined }): string | undefined {
  return text === undefined || text.trim().length === 0 ? undefined : text;
}

/**
 * Record what the transport said when it failed.
 *
 * @param error the boundary error the turn failed with
 * @param reported the last failure the event stream reported during this turn, if it reported one
 * @returns the cause, with the quota state classified from the stream's words when it had any, else the error's
 */
export function transportFaultCause({
  error,
  reported,
}: {
  error: IngestError;
  reported: string | undefined;
}): TransportFaultCause {
  const said = nonBlank({ text: reported });
  // ONE classifier for one wording. This kept its own regex mapping BOTH sentences to `credits-out`, and once
  // `./quotaLog.ts` started telling them apart by the same words, the two readers disagreed about the label
  // for one event — the spend cap read `usage-limit` from the rollout line and `credits-out` from the
  // transport fault. Neither self-clears, so nothing behaved differently; a record that names one exhaustion
  // two ways is a lie to whoever reads it next.
  const heard = absentAs({ value: said, whenAbsent: error.message });
  const quota: CodexQuotaKind | null = absentAsNull({ value: detectExhaustionBanner({ text: heard }) });
  return {
    quota,
    reported: absentAsNull({ value: said }),
    thrown: error.message,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
  };
}

/**
 * The quota state a recorded cause names, read defensively.
 *
 * @param cause the recorded cause, as read — a disk record is shallow-decoded, so it may be absent or malformed
 * @returns the classified quota state, or null when the cause names none or cannot be read
 */
export function transportFaultQuota({ cause }: { cause: unknown }): CodexQuotaKind | null {
  if (!isRecord(cause)) {
    return null;
  }
  const quota = cause["quota"];
  // The same legacy mapping `quotaCache.ts` applies, and for the same reason: a fault recorded before the
  // `weekly-limit` → `window-limit` rename is a real observed exhaustion, and reading it as unclassified
  // would silently discard it.
  const renamed = quota === PRIOR_WINDOW_LIMIT_KIND ? "window-limit" : quota;
  return isCodexQuotaKind(renamed) ? renamed : null;
}

/** Collapse text onto one line and bound it, so a multi-line stderr cannot become a wall in a refusal. */
function preview({ text }: { text: string }): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= CAUSE_PREVIEW_CHARS ? flat : `${flat.slice(0, CAUSE_PREVIEW_CHARS - 1)}…`;
}

/** The bracketed facts a cause carries beyond its words — each only when it is really there. */
function causeFacts({ cause }: { cause: Record<string, unknown> }): readonly string[] {
  const facts: string[] = [];
  if (typeof cause["quota"] === "string") {
    facts.push(`quota: ${cause["quota"]}`);
  }
  // Derived from the words rather than read off a field, so a refusal recorded before the classifier existed is
  // named exactly like one recorded after it (`./policyRefusal.ts`).
  const refusal = transportFaultRefusal({ cause });
  if (refusal !== null) {
    facts.push(`refusal: ${refusal}`);
  }
  if (typeof cause["status"] === "number") {
    facts.push(`HTTP ${String(cause["status"])}`);
  }
  if (typeof cause["code"] === "string") {
    facts.push(`code ${cause["code"]}`);
  }
  if (typeof cause["retryAfterMs"] === "number") {
    facts.push(`retry after ${String(cause["retryAfterMs"])}ms`);
  }
  return facts;
}

/** A recorded cause's words: the stream's own report when it said anything visible, else what was thrown. */
function causeWords({ reported, thrown }: { reported: string | undefined; thrown: string }): string | undefined {
  if (reported !== undefined) {
    return reported;
  }
  return nonBlank({ text: thrown });
}

/**
 * One bounded line naming a transport fault's cause.
 *
 * The stream's own report leads when there is one, because it is the provider's words; the thrown message is
 * the fallback. Status, code, retry hint and a classified quota state follow in brackets.
 *
 * Takes `unknown` on purpose: a pass record is shallow-decoded from disk (`./ledgerStore.ts`), so an old record
 * has no cause at all and a hand-edited one can have a malformed one, whatever the write-side type says.
 *
 * @param cause the recorded cause, as read
 * @returns the line — never blank, and an absent cause reads differently from a malformed one
 */
export function formatTransportCause({ cause }: { cause: unknown }): string {
  if (cause === undefined) {
    return "cause not recorded (this record predates that field)";
  }
  if (!isRecord(cause) || typeof cause["thrown"] !== "string") {
    return "cause unreadable (the recorded cause is malformed)";
  }
  const reported = typeof cause["reported"] === "string" ? nonBlank({ text: cause["reported"] }) : undefined;
  const said = causeWords({ reported, thrown: cause["thrown"] });
  const facts = causeFacts({ cause });
  const bracket = facts.length === 0 ? "" : ` [${facts.join(", ")}]`;
  return `${said === undefined ? "the transport gave no message" : preview({ text: said })}${bracket}`;
}
