/*
 * The recording's message edge: a preparation parks only as ONE typed form message. The whole record run is driven
 * end to end through `runSlackDraftWithDeps` in `./draftVerb/`.
 */

import { describe, expect, it } from "vitest";

import { NOTHING_PARKED } from "../../../../../cli/commands/slack/draftMedia.js";
import {
  parkableMessage,
  parkableMessageOf,
  recordableVoice,
} from "../../../../../cli/commands/slack/draftRecordMessage.js";
import {
  ParkableMessageErrors,
  parkableMessageLines,
} from "../../../../../cli/commands/slack/parkableMessageErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { SlackPlainMessagePayload } from "../../../../../outbound/slack/types.js";
import { type ExactVoiceRuleFinding, VOICE_RULES_ESCAPE } from "../../../../../outbound/voice/exactRules.js";

const PAYLOAD: SlackPlainMessagePayload = {
  form: "plain",
  text: "thanks for the review",
  unfurl_links: false,
  unfurl_media: false,
};

const FORM = '{"kind":"one-card"}';

describe("parkableMessageOf", () => {
  it("parks one form message, carrying its form, payload and preparation", () => {
    const prepared = { plan: { messages: [{ payload: PAYLOAD }] }, source: { json: FORM, kind: "form" as const } };
    expect(unwrap(parkableMessage({ prepared }))).toEqual({ form: FORM, payload: PAYLOAD, prepared });
  });

  it("refuses a raw --body before looking at the plan, printing its one line", () => {
    const prepared = { plan: { messages: [{ payload: PAYLOAD }] }, source: { kind: "body" as const, text: "hi" } };
    const refusal = unwrapErr(parkableMessageOf({ prepared }));
    expect(refusal).toEqual(ParkableMessageErrors.rawBody());
    expect(parkableMessageLines({ error: refusal })).toEqual(["a parked draft is a typed --form, never a raw --body"]);
  });

  it("refuses a drip of more than one message, naming the count on one line", () => {
    const prepared = {
      plan: { messages: [{ payload: PAYLOAD }, { payload: PAYLOAD }] },
      source: { json: FORM, kind: "form" as const },
    };
    const refusal = unwrapErr(parkableMessageOf({ prepared }));
    expect(refusal.code).toBe("NOT_ONE_MESSAGE");
    expect(refusal).toEqual(ParkableMessageErrors.notOneMessage({ messages: 2 }));
    const lines = parkableMessageLines({ error: refusal });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("REFUSING to park a 2-message drip");
  });

  it("refuses an empty plan as a zero-message drip", () => {
    const prepared = { plan: { messages: [] }, source: { json: FORM, kind: "form" as const } };
    const refusal = unwrapErr(parkableMessageOf({ prepared }));
    expect(refusal.code).toBe("NOT_ONE_MESSAGE");
    expect(refusal.message).toContain("REFUSING to park a 0-message drip");
  });
});

describe("parkableMessage", () => {
  it("hands the draft chains the typed refusal as the lines it prints", () => {
    const prepared = { plan: { messages: [{ payload: PAYLOAD }] }, source: { kind: "body" as const, text: "hi" } };
    expect(unwrapErr(parkableMessage({ prepared }))).toEqual(["a parked draft is a typed --form, never a raw --body"]);
  });
});

describe("recordableVoice", () => {
  const EM_DASH: ExactVoiceRuleFinding = { path: "text", rule: { kind: "literal", value: "—" } };
  const DELVE: ExactVoiceRuleFinding = { path: "text.line[1]", rule: { kind: "word", value: "delve" } };

  // A draft as the owner carried an em dash, and the owner had to catch it themselves.
  it("refuses a draft breaking the owner's rules, one line per rule and then that nothing parked", () => {
    const prepared = { allowVoiceRules: false, voiceRuleFindings: [EM_DASH, DELVE] };

    expect(unwrapErr(recordableVoice({ actor: "me", prepared }))).toEqual([
      'text matches the configured literal voice rule "—". Rewrite the authored prose, or for one deliberate ' +
        `exception run ${VOICE_RULES_ESCAPE}; the grant parks the original content unchanged.`,
      'text.line[1] matches the configured word voice rule "delve". Rewrite the authored prose, or for one ' +
        `deliberate exception run ${VOICE_RULES_ESCAPE}; the grant parks the original content unchanged.`,
      NOTHING_PARKED,
    ]);
  });

  it("passes a draft keeping every rule through unchanged", () => {
    const prepared = { allowVoiceRules: false, voiceRuleFindings: [] };

    expect(unwrap(recordableVoice({ actor: "me", prepared }))).toBe(prepared);
  });

  it("parks a draft under the open voice-rules hatch unchanged, findings and all", () => {
    const prepared = { allowVoiceRules: true, voiceRuleFindings: [EM_DASH] };

    expect(unwrap(recordableVoice({ actor: "me", prepared }))).toBe(prepared);
  });

  it("parks a --as bot draft as it always did: the owner's me-lane rules are not the bot's", () => {
    const prepared = { allowVoiceRules: false, voiceRuleFindings: [EM_DASH] };

    expect(unwrap(recordableVoice({ actor: "bot", prepared }))).toBe(prepared);
  });
});
