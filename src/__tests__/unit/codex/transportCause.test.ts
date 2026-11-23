import { describe, expect, it } from "vitest";
import { formatTransportCause, transportFaultCause, transportFaultQuota } from "../../../codex/transportCause.js";
import { toIngestError } from "../../../lib/ingestError.js";

/** Codex's own words for a spend cap, from its rollout log's `task_complete.error.message`. */
const SPEND_CAP =
  "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.";

/** The shape the SDK throws when `codex exec` exits non-zero. */
const EXIT_ERROR = toIngestError({
  error: new Error("Codex Exec exited with code 1: Reconnecting... 1/5"),
  operation: "codex.run",
  provider: "codex",
});

describe("transportFaultCause", () => {
  it("keeps the stream's report AND the thrown message, and classifies the spend cap as a usage limit", () => {
    // `usage-limit`, not `credits-out`: Codex's own reached type for this sentence is
    // `workspace_member_usage_limit_reached` on all 85 of its events, and one classifier now answers for
    // every reader. Neither kind self-clears, so only the label moved.
    expect(transportFaultCause({ error: EXIT_ERROR, reported: SPEND_CAP })).toEqual({
      quota: "usage-limit",
      reported: SPEND_CAP,
      thrown: "Codex Exec exited with code 1: Reconnecting... 1/5",
    });
  });

  it("classifies the measured out-of-credits wording too", () => {
    const cause = transportFaultCause({
      error: EXIT_ERROR,
      reported: "Your workspace is out of credits. Ask your workspace owner to refill in order to continue.",
    });
    expect(cause.quota).toBe("credits-out");
  });

  it("classifies from the thrown message when the stream reported nothing", () => {
    const thrown = toIngestError({ error: new Error(`turn failed: ${SPEND_CAP}`), operation: "codex.run" });
    expect(transportFaultCause({ error: thrown, reported: undefined })).toEqual({
      quota: "usage-limit",
      reported: null,
      thrown: `turn failed: ${SPEND_CAP}`,
    });
  });

  it("treats a blank report as no report, so the thrown message stands instead", () => {
    expect(transportFaultCause({ error: EXIT_ERROR, reported: "   " }).reported).toBe(null);
  });

  it("does NOT guess a quota state from an HTTP 429 or unrecognised wording", () => {
    const rateLimited = toIngestError({
      error: Object.assign(new Error("usage_limit_exceeded"), { status: 429 }),
      operation: "codex.run",
    });
    expect(transportFaultCause({ error: rateLimited, reported: "you have hit a limit" })).toEqual({
      quota: null,
      reported: "you have hit a limit",
      status: 429,
      thrown: "usage_limit_exceeded",
    });
  });

  it("carries a code and a zero retry hint through, rather than dropping a falsy value", () => {
    const withHints = toIngestError({
      error: Object.assign(new Error("reset"), { code: "ECONNRESET", retryAfter: 0 }),
      operation: "codex.run",
    });
    expect(transportFaultCause({ error: withHints, reported: undefined })).toEqual({
      code: "ECONNRESET",
      quota: null,
      reported: null,
      retryAfterMs: 0,
      thrown: "reset",
    });
  });
});

describe("formatTransportCause", () => {
  it("leads with the stream's words and brackets every fact that is really there", () => {
    expect(
      formatTransportCause({
        cause: { code: "E", quota: "credits-out", reported: SPEND_CAP, retryAfterMs: 0, status: 429, thrown: "x" },
      }),
    ).toBe(`${SPEND_CAP} [quota: credits-out, HTTP 429, code E, retry after 0ms]`);
  });

  it("names OpenAI's cyber-policy refusal as its own class, not an unlabelled fault", () => {
    const refused = "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing.";
    expect(formatTransportCause({ cause: { quota: null, reported: refused, thrown: refused } })).toBe(
      `${refused} [refusal: cyber-policy]`,
    );
  });

  it("falls back to the thrown message when the stream reported nothing", () => {
    expect(formatTransportCause({ cause: { quota: null, reported: null, thrown: "spawn codex ENOENT" } })).toBe(
      "spawn codex ENOENT",
    );
  });

  it("collapses a multi-line stderr onto one line and bounds it at 200 characters", () => {
    const line = formatTransportCause({ cause: { quota: null, reported: null, thrown: `a\n\n${"b".repeat(300)}` } });
    expect(line).toBe(`a ${"b".repeat(197)}…`);
  });

  it("says an absent cause predates the field, and a malformed one is unreadable — never blank", () => {
    expect(formatTransportCause({ cause: undefined })).toBe("cause not recorded (this record predates that field)");
    expect(formatTransportCause({ cause: { reported: "x" } })).toBe(
      "cause unreadable (the recorded cause is malformed)",
    );
  });

  it("names a cause whose every message is blank as giving no message", () => {
    expect(formatTransportCause({ cause: { quota: null, reported: "", thrown: " " } })).toBe(
      "the transport gave no message",
    );
  });
});

describe("transportFaultQuota", () => {
  it("reads a recorded quota and refuses anything that is not one of the two known kinds", () => {
    // A cause recorded under the pre-rename spelling still reads as the kind it named.
    expect(transportFaultQuota({ cause: { quota: "weekly-limit" } })).toBe("window-limit");
    expect(transportFaultQuota({ cause: { quota: "window-limit" } })).toBe("window-limit");
    expect(transportFaultQuota({ cause: { quota: "spend-cap" } })).toBe(null);
    expect(transportFaultQuota({ cause: undefined })).toBe(null);
  });
});
