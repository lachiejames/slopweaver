/**
 * Read a Slack message's `metadata` back as an assistant-answer read, telling V1 from V2 and refusing
 * anything that merely resembles one. This is what `../listen/recover.ts`'s exact-identity recovery matches
 * candidates against — never "the bot's user id posted somewhere in this thread".
 *
 * V1 exists on disk for two genuinely different reasons — a pre-H6 real answer, and any handover/held/
 * failure notice ever posted — and this parser deliberately does NOT try to tell them apart: it hands back
 * `{kind: "v1"}` either way, because there is nothing in the metadata itself that could. A caller must treat
 * that as "not exact evidence of anything" rather than reach for a heuristic here, which is exactly the
 * ambiguity `docs/security.md`-style honesty means naming rather than papering over with a guess.
 */
import { isRecord } from "../../lib/parsers.js";
import { ASSISTANT_ANSWER_EVENT_TYPE, ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../outbound/assistant/answerMessage.js";
import { parseRecordedAskIdentity, type RecordedAskIdentity } from "../ask/identity.js";

/** One classified read of a message's metadata. */
export type AssistantAnswerMetadataRead =
  | { readonly kind: "v1"; readonly metadata: { readonly renderer: string; readonly artifactFingerprint: string } }
  | {
      readonly kind: "v2";
      readonly metadata: {
        readonly renderer: string;
        readonly artifactFingerprint: string;
        readonly askIdentity: RecordedAskIdentity;
      };
    }
  | { readonly kind: "not-assistant-answer" }
  | { readonly kind: "malformed"; readonly reason: string };

/**
 * Classify a decoded Slack message's `metadata` field.
 *
 * @param value the decoded `metadata` value read off the message
 * @returns which version it is, or why it is neither
 */
export function parseAssistantAnswerMetadata({ value }: { value: unknown }): AssistantAnswerMetadataRead {
  if (!isRecord(value)) {
    return { kind: "not-assistant-answer" };
  }
  const eventType = value["event_type"];
  if (eventType !== ASSISTANT_ANSWER_EVENT_TYPE && eventType !== ASSISTANT_ANSWER_EVENT_TYPE_V2) {
    return { kind: "not-assistant-answer" };
  }
  const payload = value["event_payload"];
  if (!isRecord(payload)) {
    return { kind: "malformed", reason: "event_payload is not an object" };
  }
  const renderer = payload["renderer"];
  const artifactFingerprint = payload["artifactFingerprint"];
  if (typeof renderer !== "string" || typeof artifactFingerprint !== "string") {
    return { kind: "malformed", reason: "event_payload is missing a string renderer or artifactFingerprint" };
  }
  if (eventType === ASSISTANT_ANSWER_EVENT_TYPE) {
    return { kind: "v1", metadata: { artifactFingerprint, renderer } };
  }
  const askIdentity = parseRecordedAskIdentity({ value: payload["askIdentity"] });
  if (askIdentity === undefined) {
    return { kind: "malformed", reason: "a v2 event_payload is missing a well-formed askIdentity" };
  }
  return { kind: "v2", metadata: { artifactFingerprint, askIdentity, renderer } };
}
