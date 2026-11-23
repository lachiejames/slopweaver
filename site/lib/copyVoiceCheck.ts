/**
 * The running list's voice check: every draft of the owner's words the voice offers is judged against the owner's
 * exact voice rules before it reaches the list (`../app/api/talk/copy-voice/route.ts`, which runs
 * `slack voice-rules --check-stdin`). Measured: an offered review comment carried an em dash, and the owner cut it by
 * hand.
 *
 * The page never sees the rules and never matches them: the verb does, with the one matcher the send door uses. What
 * comes back is accepted, or the rules it broke. Anything else — the route down, the rules unreadable, an answer
 * that does not read — REFUSES the offer, because reading "no answer" as "no rules" is exactly how the em dash got
 * through. No reason here quotes the message.
 *
 * A message for Slack (`destination: "slack"`) meets the shape a parked Slack draft does as well, through `--slack-draft`
 * (`src/outbound/voice/copyVerdict.ts`), so a message is never cut short without the owner's say. It also refuses any
 * one paragraph past 70 words, so a message keeps vertical white space.
 */
import { type Bag, isBag, str } from "./bag";
import type { CopyDestination } from "./runningListCopy";

/** What the tray is told about one proposed message. */
export type CopyVoiceVerdict =
  { readonly kind: "accepted" } | { readonly kind: "refused"; readonly reasons: readonly string[] };

/** What the copy-voice route answers: the verb's verdict, or why there is none. */
export type CopyVoiceRouteResult =
  { readonly ok: true; readonly verdict: unknown } | { readonly ok: false; readonly refused: string };

/** What the voice is told when no verdict could be had, so it never offers past an unchecked message. */
const UNCHECKED =
  "the owner's voice rules could not be checked, so nothing went on their running list: tell them the running list's voice " +
  "check is not answering";

/**
 * How long the page waits for the route before refusing: the route's own 10s child timeout plus room for the request
 * itself, so a route that never answers still tells the voice the offer did not land.
 */
const COPY_VOICE_WAIT_MS = 15_000;

/**
 * Read the verb's printed verdict, or `undefined` when it is not one.
 *
 * @param payload the parsed `slack voice-rules --check-stdin --json` output
 * @returns the verdict
 */
export function copyVoiceVerdictOf({ payload }: { payload: unknown }): CopyVoiceVerdict | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  // Exactly the verb's acceptance and nothing beside it: an acceptance carrying reasons is not one.
  if (payload["kind"] === "accepted") {
    return Object.keys(payload).length === 1 ? { kind: "accepted" } : undefined;
  }
  if (payload["kind"] !== "refused") {
    return undefined;
  }
  const reasons = payload["reasons"];
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return undefined;
  }
  const read = reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim() !== "");
  if (read.length !== reasons.length) {
    return undefined;
  }
  return { kind: "refused", reasons: read };
}

/**
 * Read the route's answer into a verdict, refusing whatever is not one: a route that answered no verdict, or one
 * that does not read, is never an acceptance.
 *
 * @param body the route's parsed JSON body
 * @returns the verdict
 */
export function copyVoiceAnswerOf({ body }: { body: unknown }): CopyVoiceVerdict {
  const result: Bag = isBag(body) ? body : {};
  if (result["ok"] === true) {
    const verdict = copyVoiceVerdictOf({ payload: result["verdict"] });
    if (verdict !== undefined) {
      return verdict;
    }
    return { kind: "refused", reasons: [`${UNCHECKED} (its verdict did not read)`] };
  }
  const why = str({ bag: result, key: "refused" });
  if (why !== undefined) {
    return { kind: "refused", reasons: [`${UNCHECKED} (${why})`] };
  }
  return { kind: "refused", reasons: [`${UNCHECKED} (the route answered an unknown shape)`] };
}

/**
 * Ask the copy-voice route for one message's verdict. A throw — the route down, a body that is not JSON, no answer
 * within {@link COPY_VOICE_WAIT_MS} — is a refusal carrying the reason, never a rejection and never an acceptance.
 *
 * @param text the message, exactly as the owner would paste it
 * @param destination where it goes: a `slack` message meets the parked-draft shape and the per-paragraph word cap as
 *   well as the owner's exact rules
 * @returns the verdict
 */
export async function checkCopyVoice({
  text,
  destination,
}: {
  text: string;
  destination: CopyDestination;
}): Promise<CopyVoiceVerdict> {
  try {
    const response = await fetch("/api/talk/copy-voice", {
      body: JSON.stringify({ destination, text }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(COPY_VOICE_WAIT_MS),
    });
    const body: unknown = await response.json();
    return copyVoiceAnswerOf({ body });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { kind: "refused", reasons: [`${UNCHECKED} (${why})`] };
  }
}
