/*
 * The running list's voice verdict as the page reads it: accepted only when the verb said so, and refused — never
 * accepted — for every answer that is not a verdict, since "no answer" read as "no rules" is how an em dash
 * reaches the owner's tray.
 */
import { describe, expect, it } from "vitest";

import { copyVoiceAnswerOf, copyVoiceVerdictOf } from "../../lib/copyVoiceCheck";

const EM_DASH_REASON =
  'text matches the configured literal voice rule "—". Rewrite the message in the configured voice and call offer_copy again.';

const UNCHECKED =
  "the owner's voice rules could not be checked, so nothing went on their running list: tell them the running list's voice " +
  "check is not answering";

describe("copyVoiceVerdictOf", () => {
  it("reads an acceptance and a refusal with its reasons", () => {
    expect(copyVoiceVerdictOf({ payload: { kind: "accepted" } })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdictOf({ payload: { kind: "refused", reasons: [EM_DASH_REASON] } })).toEqual({
      kind: "refused",
      reasons: [EM_DASH_REASON],
    });
  });

  it("reads nothing that is not a verdict: no kind, a refusal naming no reason, or a reason that is not words", () => {
    expect(copyVoiceVerdictOf({ payload: "accepted" })).toBeUndefined();
    expect(copyVoiceVerdictOf({ payload: { kind: "fine" } })).toBeUndefined();
    expect(copyVoiceVerdictOf({ payload: { kind: "accepted", reasons: [3] } })).toBeUndefined();
    expect(copyVoiceVerdictOf({ payload: { kind: "refused", reasons: [] } })).toBeUndefined();
    expect(copyVoiceVerdictOf({ payload: { kind: "refused", reasons: [EM_DASH_REASON, 3] } })).toBeUndefined();
    expect(copyVoiceVerdictOf({ payload: { kind: "refused", reasons: ["  "] } })).toBeUndefined();
  });
});

describe("copyVoiceAnswerOf", () => {
  it("passes the verb's verdict through", () => {
    expect(copyVoiceAnswerOf({ body: { ok: true, verdict: { kind: "accepted" } } })).toEqual({ kind: "accepted" });
    expect(copyVoiceAnswerOf({ body: { ok: true, verdict: { kind: "refused", reasons: [EM_DASH_REASON] } } })).toEqual({
      kind: "refused",
      reasons: [EM_DASH_REASON],
    });
  });

  it("refuses when the rules could not be read, naming why", () => {
    expect(copyVoiceAnswerOf({ body: { ok: false, refused: "profile.json is not JSON" } })).toEqual({
      kind: "refused",
      reasons: [`${UNCHECKED} (profile.json is not JSON)`],
    });
  });

  it("refuses a verdict that does not read, and an answer of no known shape", () => {
    expect(copyVoiceAnswerOf({ body: { ok: true, verdict: { kind: "maybe" } } })).toEqual({
      kind: "refused",
      reasons: [`${UNCHECKED} (its verdict did not read)`],
    });
    expect(copyVoiceAnswerOf({ body: null })).toEqual({
      kind: "refused",
      reasons: [`${UNCHECKED} (the route answered an unknown shape)`],
    });
  });
});
