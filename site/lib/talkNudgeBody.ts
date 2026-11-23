/**
 * The nudge route's whole body contract (`site/app/api/talk/call/[id]/nudge/route.ts`): `{}` for the owner's press, and
 * `{ promised: true }` for the page's own press over a promise the voice never started (`promiseDueOf`,
 * `./voiceOwed.ts`). Strict, so no other key — and no text of the page's — reaches the call.
 */
import { z } from "zod";

/** `{}` or `{ promised: true }`, and nothing else. */
const TALK_NUDGE_BODY = z.strictObject({ promised: z.literal(true).optional() });

/** What the route answers a body outside the contract. */
export const NUDGE_BODY_REFUSAL = "the body must be {} or { promised: true }";

/**
 * Which press a nudge body is.
 *
 * @param body the parsed JSON object the route was posted
 * @returns `{ promised }` for a body inside the contract, `undefined` for any other
 */
export function nudgeBodyOf({ body }: { body: unknown }): { readonly promised: boolean } | undefined {
  const parsed = TALK_NUDGE_BODY.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }
  return { promised: parsed.data.promised === true };
}
