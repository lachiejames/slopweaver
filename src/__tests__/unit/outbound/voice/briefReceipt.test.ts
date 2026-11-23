import { describe, expect, it } from "vitest";

import {
  briefingVerdict,
  decodeVoiceBriefReceipt,
  encodeVoiceBriefReceipt,
  type VoiceBriefReceipt,
  voiceBriefDigest,
} from "../../../../outbound/voice/briefReceipt.js";
import type { VoiceRuleBrief } from "../../../../outbound/voice/briefStore.js";
import type { SupervisorSessionDetection } from "../../../../supervisor/session.js";

const BRIEF: VoiceRuleBrief = { paragraphSpacing: true, rules: [{ kind: "word", value: "delve" }], shape: "Lead." };
const NONE: VoiceRuleBrief = { paragraphSpacing: false, rules: [], shape: null };
const CLAUDE: SupervisorSessionDetection = { kind: "active", session: { host: "claude-code", id: "abc-123" } };

/** A receipt for {@link BRIEF} held by the {@link CLAUDE} session, with any field overridden. */
function receiptOf(over: Partial<VoiceBriefReceipt> = {}): VoiceBriefReceipt {
  return {
    briefDigest: voiceBriefDigest({ brief: BRIEF }),
    briefedAtIso: "2026-11-08T12:00:00.000Z",
    session: "claude-code:abc-123",
    version: 1,
    ...over,
  };
}

describe("voiceBriefDigest", () => {
  it("is a sha256 of the rendered brief, stable for the same brief", () => {
    const digest = voiceBriefDigest({ brief: BRIEF });

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(voiceBriefDigest({ brief: { ...BRIEF } })).toBe(digest);
  });

  it("changes when the advisory shape, a rule or the spacing setting changes", () => {
    const digest = voiceBriefDigest({ brief: BRIEF });

    expect(voiceBriefDigest({ brief: { ...BRIEF, shape: "Lead, then stop." } })).not.toBe(digest);
    expect(voiceBriefDigest({ brief: { ...BRIEF, rules: [{ kind: "word", value: "utilise" }] } })).not.toBe(digest);
    expect(voiceBriefDigest({ brief: { ...BRIEF, paragraphSpacing: false } })).not.toBe(digest);
  });
});

describe("decodeVoiceBriefReceipt", () => {
  it("reads back exactly what was written, as one fixed-order line", () => {
    const text = encodeVoiceBriefReceipt({ receipt: receiptOf() });

    expect(text).toBe(
      `{"version":1,"session":"claude-code:abc-123","briefDigest":"${voiceBriefDigest({ brief: BRIEF })}","briefedAtIso":"2026-11-08T12:00:00.000Z"}\n`,
    );
    expect(decodeVoiceBriefReceipt({ text })).toEqual(receiptOf());
  });

  it("is no receipt for text that is not JSON, a wrong version or a malformed digest", () => {
    const wrongVersion = encodeVoiceBriefReceipt({ receipt: receiptOf() }).replace('"version":1', '"version":2');

    expect(decodeVoiceBriefReceipt({ text: "{" })).toBeUndefined();
    expect(decodeVoiceBriefReceipt({ text: wrongVersion })).toBeUndefined();
    expect(
      decodeVoiceBriefReceipt({ text: encodeVoiceBriefReceipt({ receipt: receiptOf({ briefDigest: "sha256:zz" }) }) }),
    ).toBeUndefined();
  });

  it("is no receipt when any byte differs from what the writer writes, so no word of the brief can ride in one", () => {
    const text = encodeVoiceBriefReceipt({ receipt: receiptOf() });
    const extraKey = text.replace("}\n", ',"brief":"delve"}\n');
    const duplicateKey = text.replace('"session":', '"session":"delve","session":');

    expect(decodeVoiceBriefReceipt({ text: extraKey })).toBeUndefined();
    expect(decodeVoiceBriefReceipt({ text: duplicateKey })).toBeUndefined();
    expect(decodeVoiceBriefReceipt({ text: `${text} ` })).toBeUndefined();
  });

  it("is no receipt when its instant is not spelled the way toISOString writes one", () => {
    expect(
      decodeVoiceBriefReceipt({ text: encodeVoiceBriefReceipt({ receipt: receiptOf({ briefedAtIso: "0" }) }) }),
    ).toBeUndefined();
    expect(
      decodeVoiceBriefReceipt({
        text: encodeVoiceBriefReceipt({ receipt: receiptOf({ briefedAtIso: "2026-11-08" }) }),
      }),
    ).toBeUndefined();
  });
});

describe("briefingVerdict", () => {
  it("admits a session holding a receipt for the current brief", () => {
    expect(briefingVerdict({ brief: BRIEF, detection: CLAUDE, hatchIsOpen: false, receipt: receiptOf() })).toEqual({
      kind: "admitted",
      via: "receipt",
    });
  });

  it("refuses a session holding no receipt, naming it and the digest it owes", () => {
    expect(briefingVerdict({ brief: BRIEF, detection: CLAUDE, hatchIsOpen: false, receipt: undefined })).toEqual({
      briefDigest: voiceBriefDigest({ brief: BRIEF }),
      kind: "unbriefed",
      session: "claude-code:abc-123",
    });
  });

  it("refuses a receipt for an older brief and one another session holds", () => {
    const stale = receiptOf({ briefDigest: voiceBriefDigest({ brief: { ...BRIEF, shape: "old" } }) });
    const other = receiptOf({ session: "codex:abc-123" });

    expect(briefingVerdict({ brief: BRIEF, detection: CLAUDE, hatchIsOpen: false, receipt: stale }).kind).toBe(
      "unbriefed",
    );
    expect(briefingVerdict({ brief: BRIEF, detection: CLAUDE, hatchIsOpen: false, receipt: other }).kind).toBe(
      "unbriefed",
    );
  });

  it("admits under the open hatch, and when the owner configured no voice at all", () => {
    expect(briefingVerdict({ brief: BRIEF, detection: CLAUDE, hatchIsOpen: true, receipt: undefined })).toEqual({
      kind: "admitted",
      via: "hatch",
    });
    expect(briefingVerdict({ brief: NONE, detection: CLAUDE, hatchIsOpen: false, receipt: undefined })).toEqual({
      kind: "admitted",
      via: "unconfigured",
    });
  });

  it("admits a process with no visible session, and refuses one naming two", () => {
    const ambiguous: SupervisorSessionDetection = {
      kind: "ambiguous",
      sessions: [
        { host: "claude-code", id: "a" },
        { host: "codex", id: "b" },
      ],
    };

    expect(
      briefingVerdict({ brief: BRIEF, detection: { kind: "missing" }, hatchIsOpen: false, receipt: undefined }),
    ).toEqual({ kind: "admitted", via: "no-session" });
    expect(briefingVerdict({ brief: BRIEF, detection: ambiguous, hatchIsOpen: false, receipt: undefined })).toEqual({
      kind: "ambiguous-session",
    });
  });
});
