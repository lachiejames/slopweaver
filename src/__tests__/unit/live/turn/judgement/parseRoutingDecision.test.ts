/**
 * The strict schema `parseRoutingDecision` holds a routing decision to, field by field.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseRoutingDecision } from "../../../../../live/turn/judgement.js";
import { NO_RESPONSE } from "./harness.js";

describe("parseRoutingDecision", () => {
  it("accepts a well-formed no-response decision", () => {
    const result = parseRoutingDecision({ value: NO_RESPONSE });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(NO_RESPONSE);
  });

  it("accepts a well-formed respond decision", () => {
    const decision = {
      confidence: "high",
      needs: [{ capabilityId: "catalog", reason: "asked directly", requirement: "required" }],
      rationale: "a direct question",
      response: "respond",
      truthMode: "current",
      schemaVersion: 1,
      tier: "inline",
    };
    const result = parseRoutingDecision({ value: decision });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(decision);
  });

  it("accepts a respond decision that pins the worker's model — the judging session's right-sizing call", () => {
    const decision = unwrap(
      parseRoutingDecision({
        value: {
          confidence: "high",
          model: "sonnet",
          needs: [],
          rationale: "narrow ask, a scoped worker will do",
          response: "respond",
          schemaVersion: 1,
          tier: "fresh-visible-session",
          truthMode: "none",
        },
      }),
    );
    expect(decision.response).toBe("respond");
    expect((decision as Extract<typeof decision, { response: "respond" }>).model).toBe("sonnet");
  });

  it("refuses an empty model — a pin that names nothing is not a pin", () => {
    const result = parseRoutingDecision({
      value: {
        confidence: "high",
        model: "",
        needs: [],
        rationale: "x",
        response: "respond",
        schemaVersion: 1,
        tier: "fresh-visible-session",
        truthMode: "none",
      },
    });
    expect(unwrapErr(result)).toEqual(["Too small: expected string to have >=1 characters"]);
  });

  it("refuses a respond decision missing tier", () => {
    const result = parseRoutingDecision({
      value: { confidence: "high", needs: [], rationale: "x", response: "respond", schemaVersion: 1 },
    });
    expect(unwrapErr(result)).toEqual([
      'Invalid option: expected one of "inline"|"read-only-subagent"|"fresh-visible-session"',
      'Invalid option: expected one of "current"|"history"|"none"',
    ]);
  });

  it("refuses an unknown response value", () => {
    const result = parseRoutingDecision({
      value: { confidence: "high", rationale: "x", response: "maybe", schemaVersion: 1 },
    });
    expect(unwrapErr(result)).toEqual([
      "Invalid discriminator value. Expected 'no-response' | 'for-a-human' | 'respond'",
    ]);
  });

  it("accepts a well-formed for-a-human decision — a reply is owed and a person should give it", () => {
    const decision = { confidence: "high", rationale: "a lockout is IT's", response: "for-a-human", schemaVersion: 1 };
    expect(unwrap(parseRoutingDecision({ value: decision }))).toEqual(decision);
  });

  it("refuses `exclude` on a for-a-human decision — a message left for a person is never suppressed for good", () => {
    const result = parseRoutingDecision({
      value: { confidence: "high", exclude: true, rationale: "x", response: "for-a-human", schemaVersion: 1 },
    });
    expect(unwrapErr(result)).toEqual(['Unrecognized key: "exclude"']);
  });

  it("refuses an unknown extra field", () => {
    const result = parseRoutingDecision({ value: { ...NO_RESPONSE, extra: "field" } });
    expect(unwrapErr(result)).toEqual(['Unrecognized key: "extra"']);
  });

  it("refuses a bare string", () => {
    const result = parseRoutingDecision({ value: "not an object" });
    expect(unwrapErr(result)).toEqual(["Invalid input: expected object, received string"]);
  });
});
