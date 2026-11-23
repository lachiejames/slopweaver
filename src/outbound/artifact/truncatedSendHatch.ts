/**
 * The one way past a truncated-send refusal (`./truncate.ts`): the journalled `truncated-send` hatch.
 *
 * Split from the truncation itself because the two answer different questions — that module computes what a
 * drop would cost, this one says whether this session decided to pay it — and `./schema.ts` and
 * `../assistant/answerForm.ts` ask the second without needing the first.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchOpen } from "../../hatch/open.js";
import { hatchIncantation } from "../../hatch/types.js";

/**
 * The journalled hatch that lets a caller post a card/answer truncated instead of having it refused.
 */
export const TRUNCATED_SEND_HATCH = "truncated-send";

/**
 * Whether this session holds a live {@link TRUNCATED_SEND_HATCH} grant.
 *
 * Takes an injected `env` rather than reading `process.env` itself, so a test decides the session and the
 * state home the grant is read from without mutating real process state. No variable in `env` lifts the cap:
 * the grant journal does, so a value set on the environment, inherited through a prototype or answered by a
 * `Proxy` names a session at most, never a decision.
 *
 * @param env the environment the session id and state home are read from
 * @returns true only when this session took the grant with `slopweaver hatch open` and it has not expired
 */
export function truncatedSendAllowed({ env }: { env: Readonly<Record<string, string | undefined>> }): boolean {
  return hatchOpen({ env, id: TRUNCATED_SEND_HATCH, nowIso: new Date().toISOString() });
}

/** The command a truncated-send refusal names, so every one of them offers the same way past. */
export const TRUNCATED_SEND_ESCAPE = hatchIncantation({ hatch: hatchFor({ id: TRUNCATED_SEND_HATCH }) });
