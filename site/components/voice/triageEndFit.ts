/**
 * `triage_end`'s answer, held under the page's tool cap with room left for the unread list (`../../lib/unreadFit.ts`),
 * which is added after it: a long pass's rulings alone could sit just under the cap, and one unread register then
 * carried the whole answer over it to be refused whole. Past the budget the
 * trailing rulings are left off and counted, never dropped silently; the summary still counts every one by verdict.
 */
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";

/** The most the answer may carry before its unread list. */
export const TRIAGE_END_MAX_BYTES = TOOL_OUTPUT_MAX - UNREAD_MAX_BYTES;

/** The bytes of one value as JSON. */
function jsonBytes({ value }: { value: unknown }): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The answer with as many leading rulings as fit, and how many were left off when any were.
 *
 * @param answer the whole answer, every ruling listed
 * @param maxBytes the budget, the cap less the unread reserve unless a test narrows it
 * @returns the answer under the budget
 */
export function fitTriageEnd<A extends { readonly rulings: readonly unknown[] }>({
  answer,
  maxBytes = TRIAGE_END_MAX_BYTES,
}: {
  answer: A;
  maxBytes?: number;
}): A & { readonly rulingsNotListed?: number } {
  if (jsonBytes({ value: answer }) <= maxBytes) {
    return answer;
  }
  const of = answer.rulings.length;
  // The count field is measured with the widest number it can carry, so the fitted answer never grows past the budget.
  let left = jsonBytes({ value: { ...answer, rulings: [], rulingsNotListed: of } });
  let kept = 0;
  for (const ruling of answer.rulings) {
    const next = left + jsonBytes({ value: ruling }) + 1;
    if (next > maxBytes) {
      break;
    }
    left = next;
    kept += 1;
  }
  return { ...answer, rulings: answer.rulings.slice(0, kept), rulingsNotListed: of - kept };
}
