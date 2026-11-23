/**
 * Reading a Slack message's `metadata` back — telling V1 (no identity, forever non-evidentiary) from V2
 * (a real answer, carrying which ask it answers). Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import { parseAssistantAnswerMetadata } from "../../../../live/slack/messageMetadata.js";

const V1_METADATA = {
  event_payload: { artifactFingerprint: "fp-1", renderer: "slack-assistant-answer-v1", schemaVersion: 1 },
  event_type: "slopweaver_assistant_answer_v1",
};

const V2_METADATA = {
  event_payload: {
    artifactFingerprint: "fp-1",
    askIdentity: { channel: "C1", messageTs: "2.2", quality: "exact", threadTs: "1.1" },
    renderer: "slack-assistant-answer-v2",
    schemaVersion: 2,
  },
  event_type: "slopweaver_assistant_answer_v2",
};

describe("parseAssistantAnswerMetadata", () => {
  it("reads a V1 message as v1, carrying no identity — it is never evidence of which ask it answers", () => {
    expect(parseAssistantAnswerMetadata({ value: V1_METADATA })).toEqual({
      kind: "v1",
      metadata: { artifactFingerprint: "fp-1", renderer: "slack-assistant-answer-v1" },
    });
  });

  it("reads a V2 message as v2, carrying its askIdentity", () => {
    expect(parseAssistantAnswerMetadata({ value: V2_METADATA })).toEqual({
      kind: "v2",
      metadata: {
        artifactFingerprint: "fp-1",
        askIdentity: { channel: "C1", messageTs: "2.2", quality: "exact", threadTs: "1.1" },
        renderer: "slack-assistant-answer-v2",
      },
    });
  });

  it.each(["thread-only", "legacy"])(
    "reads a V2 message whose askIdentity quality is spelled %s as a thread-only v2 identity",
    (quality) => {
      const threadOnly = {
        ...V2_METADATA,
        event_payload: {
          ...V2_METADATA.event_payload,
          askIdentity: { channel: "C1", quality, threadTs: "1.1" },
        },
      };

      expect(parseAssistantAnswerMetadata({ value: threadOnly })).toEqual({
        kind: "v2",
        metadata: {
          artifactFingerprint: "fp-1",
          askIdentity: { channel: "C1", quality: "thread-only", threadTs: "1.1" },
          renderer: "slack-assistant-answer-v2",
        },
      });
    },
  );

  it("reads any other message's metadata as not-assistant-answer", () => {
    expect(parseAssistantAnswerMetadata({ value: { event_payload: {}, event_type: "slack-card-v1" } })).toEqual({
      kind: "not-assistant-answer",
    });
  });

  it("reads a non-record value as not-assistant-answer", () => {
    expect(parseAssistantAnswerMetadata({ value: "not a record" })).toEqual({ kind: "not-assistant-answer" });
  });

  it("reads undefined as not-assistant-answer", () => {
    expect(parseAssistantAnswerMetadata({ value: undefined })).toEqual({ kind: "not-assistant-answer" });
  });

  it("reads a matching event_type with a non-object event_payload as malformed", () => {
    const malformed = parseAssistantAnswerMetadata({
      value: { event_payload: "not an object", event_type: "slopweaver_assistant_answer_v1" },
    });

    expect(malformed.kind).toBe("malformed");
  });

  it("reads a matching event_type missing a string renderer as malformed", () => {
    const malformed = parseAssistantAnswerMetadata({
      value: { event_payload: { artifactFingerprint: "fp-1" }, event_type: "slopweaver_assistant_answer_v1" },
    });

    expect(malformed.kind).toBe("malformed");
  });

  it("reads a V2 event_payload with no well-formed askIdentity as malformed, never silently v1", () => {
    const malformed = parseAssistantAnswerMetadata({
      value: {
        event_payload: { artifactFingerprint: "fp-1", renderer: "slack-assistant-answer-v2" },
        event_type: "slopweaver_assistant_answer_v2",
      },
    });

    expect(malformed).toEqual({ kind: "malformed", reason: "a v2 event_payload is missing a well-formed askIdentity" });
  });
});
