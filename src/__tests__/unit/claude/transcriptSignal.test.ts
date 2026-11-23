import { describe, expect, it } from "vitest";

import { classifyLimitLine, classifyLimitRecord } from "../../../claude/transcriptSignal.js";

/** Build a transcript record in the shape Claude Code actually writes for an API error. */
function apiError({ status, text }: { status: unknown; text: string }): unknown {
  return {
    apiErrorStatus: status,
    isApiErrorMessage: true,
    message: { content: [{ text, type: "text" }], role: "assistant" },
  };
}

describe("classifyLimitRecord", () => {
  it("rotates on the session-limit refusal measured 80 times on this machine", () => {
    const signal = classifyLimitRecord({
      record: apiError({ status: 429, text: "You've hit your session limit · resets 4:50am (Australia/Melbourne)" }),
    });
    expect(signal.kind).toBe("plan-limit");
    expect(signal.claim).toBe("five_hour");
  });

  it("rotates on the weekly-limit refusal", () => {
    const signal = classifyLimitRecord({
      record: apiError({
        status: 429,
        text: "You've hit your weekly limit · resets Sep 4 at 5pm (Australia/Melbourne)",
      }),
    });
    expect(signal.kind).toBe("plan-limit");
    expect(signal.claim).toBe("seven_day");
  });

  it("never rotates on a 529 overloaded, which outnumbered real weekly limits four to one", () => {
    const signal = classifyLimitRecord({
      record: apiError({ status: 529, text: "API Error: 529 Overloaded. This is a server-side issue" }),
    });
    expect(signal.kind).toBe("ignored");
    expect(signal.reason).toContain("529");
  });

  it("never rotates on an individual spend limit", () => {
    const signal = classifyLimitRecord({
      record: apiError({ status: 429, text: "You've hit your individual spend limit · run /usage-credits" }),
    });
    expect(signal.kind).toBe("ignored");
    expect(signal.reason).toContain("different budget");
  });

  it("REPORTS a model-scoped cap with its claim rather than swallowing it", () => {
    // It was swallowed as "ignored" for an hour, which made the supervisor-chair rule unreachable: the
    // claim never reached the trigger, so the chair would have sat on a spent Fable budget. What to DO
    // about this claim is `claimResponse.ts`'s decision and depends on the seat.
    const signal = classifyLimitRecord({
      record: apiError({ status: 429, text: "You've reached your Fable limit. Run /usage-credits to continue" }),
    });
    expect(signal.kind).toBe("plan-limit");
    expect(signal.claim).toBe("seven_day_opus");
    expect(signal.reason).toContain("model-scoped");
  });

  it("classifies a 401 from a bad rotation as ignored, not as a plan limit", () => {
    const signal = classifyLimitRecord({
      record: apiError({ status: 401, text: "Failed to authenticate. API Error: 401 Invalid bearer token" }),
    });
    expect(signal.kind).toBe("ignored");
  });

  it("reads prose only after the structural gate, so discussing a limit is not a limit", () => {
    const signal = classifyLimitRecord({
      record: { message: { content: "we hit your session limit yesterday", role: "assistant" }, type: "assistant" },
    });
    expect(signal.kind).toBe("none");
    expect(signal.reason).toBe("not an API error record");
  });

  it("reads a string content field as well as a block array", () => {
    const signal = classifyLimitRecord({
      record: {
        apiErrorStatus: 429,
        content: "You've hit your session limit · resets 2:30pm",
        isApiErrorMessage: true,
      },
    });
    expect(signal.claim).toBe("five_hour");
  });

  it("treats an unrecognised 429 as ignored rather than guessing it is a plan limit", () => {
    const signal = classifyLimitRecord({ record: apiError({ status: 429, text: "something new and unlabelled" }) });
    expect(signal.kind).toBe("ignored");
    expect(signal.reason).toContain("does not recognise");
  });

  it("returns none for a value that is not a record at all", () => {
    expect(classifyLimitRecord({ record: 7 }).kind).toBe("none");
  });
});

describe("classifyLimitLine", () => {
  it("classifies a raw JSONL line", () => {
    const line = JSON.stringify(apiError({ status: 429, text: "You've hit your weekly limit · resets Sep 4 at 5pm" }));
    expect(classifyLimitLine({ line }).claim).toBe("seven_day");
  });

  it("tolerates an unparseable line rather than throwing mid-sweep", () => {
    const signal = classifyLimitLine({ line: '{"truncated": ' });
    expect(signal.kind).toBe("none");
    expect(signal.reason).toBe("unparseable transcript line");
  });
});
