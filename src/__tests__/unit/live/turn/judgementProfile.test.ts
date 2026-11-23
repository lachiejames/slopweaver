/**
 * Pure schema validation for the private judgement/voice profile.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseJudgementProfile } from "../../../../live/turn/judgementProfile.js";

const VALID_HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;

const VALID_PROFILE = {
  provenance: { minedAt: "2026-08-11T00:00:00.000Z", sourceManifestHash: VALID_HASH },
  routing: {
    counterexamples: [
      {
        example: { sourceHash: OTHER_HASH, text: "reply with a full investigation to a bare greeting" },
        whyRejected: "a greeting carries no request; investigating it wastes a turn and reads as odd",
      },
    ],
    examples: [{ sourceHash: VALID_HASH, text: "acknowledge and ask what is actually needed" }],
    principles: ["match the effort of a reply to the effort of the ask"],
  },
  schemaVersion: 1,
  voice: {
    examples: [{ sourceHash: VALID_HASH, text: "terse, outcome-first, no filler" }],
    principles: ["lead with the answer"],
  },
};

describe("parseJudgementProfile", () => {
  it("accepts a fully-formed profile", () => {
    const result = parseJudgementProfile({ value: VALID_PROFILE });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(VALID_PROFILE);
  });

  it("refuses the wrong schema version", () => {
    const result = parseJudgementProfile({ value: { ...VALID_PROFILE, schemaVersion: 2 } });
    expect(unwrapErr(result)).toEqual(["Invalid input: expected 1"]);
  });

  it("refuses a sourceHash that is not sha256:<64 hex>", () => {
    const result = parseJudgementProfile({
      value: {
        ...VALID_PROFILE,
        voice: { examples: [{ sourceHash: "not-a-hash", text: "x" }], principles: [] },
      },
    });
    expect(unwrapErr(result)).toEqual(["sourceHash must be sha256:<64 hex chars>"]);
  });

  it("refuses an unknown top-level field", () => {
    const result = parseJudgementProfile({ value: { ...VALID_PROFILE, extra: "field" } });
    expect(unwrapErr(result)).toEqual(['Unrecognized key: "extra"']);
  });

  it("refuses a routing section with no counterexamples field", () => {
    const { counterexamples: _dropped, ...routingWithoutCounterexamples } = VALID_PROFILE.routing;
    const result = parseJudgementProfile({ value: { ...VALID_PROFILE, routing: routingWithoutCounterexamples } });
    expect(unwrapErr(result)).toEqual(["Invalid input: expected array, received undefined"]);
  });

  it("refuses a non-datetime minedAt", () => {
    const result = parseJudgementProfile({
      value: { ...VALID_PROFILE, provenance: { ...VALID_PROFILE.provenance, minedAt: "not-a-date" } },
    });
    expect(unwrapErr(result)).toEqual(["Invalid ISO datetime"]);
  });

  it("still accepts the unlabelled shape a profile mined before decision labels carries", () => {
    // VALID_PROFILE has bare-string principles and no decision labels: an exported pre-label profile.
    expect(unwrap(parseJudgementProfile({ value: VALID_PROFILE })).routing.principles).toEqual([
      "match the effort of a reply to the effort of the ask",
    ]);
  });

  it("accepts decision-labelled routing principles, examples and counterexamples exactly", () => {
    const labelled = {
      ...VALID_PROFILE,
      routing: {
        counterexamples: [
          {
            example: { decision: "ask", sourceHash: OTHER_HASH, text: "asked before merging their own green PR" },
            expectedDecision: "act",
            whyRejected: "rule 1 already authorises it",
          },
        ],
        examples: [{ decision: "act", sourceHash: VALID_HASH, text: "rebased and landed it, then said so" }],
        principles: [{ decision: "act", text: "obvious to a session that knows the owner: do it, then record it" }],
      },
    };
    expect(unwrap(parseJudgementProfile({ value: labelled }))).toEqual(labelled);
  });

  it("refuses a decision label on a VOICE example", () => {
    const result = parseJudgementProfile({
      value: {
        ...VALID_PROFILE,
        voice: { examples: [{ decision: "act", sourceHash: VALID_HASH, text: "x" }], principles: [] },
      },
    });
    expect(unwrapErr(result)).toEqual(['Unrecognized key: "decision"']);
  });

  it("refuses a decision outside act / ask / refuse", () => {
    const result = parseJudgementProfile({
      value: {
        ...VALID_PROFILE,
        routing: {
          ...VALID_PROFILE.routing,
          examples: [{ decision: "escalate", sourceHash: VALID_HASH, text: "x" }],
        },
      },
    });
    expect(unwrapErr(result)).toEqual(['Invalid option: expected one of "act"|"ask"|"refuse"']);
  });

  it("refuses a bare object with no fields", () => {
    const result = parseJudgementProfile({ value: {} });
    expect(unwrapErr(result)).toEqual([
      "Invalid input: expected object, received undefined",
      "Invalid input: expected object, received undefined",
      "Invalid input: expected 1",
      "Invalid input: expected object, received undefined",
    ]);
  });
});
