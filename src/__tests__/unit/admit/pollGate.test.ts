/**
 * The poll gate's pure decision: the 60-second window, the change token that lets a static file through it, the
 * break-glass, and the refusal's contents.
 */
import { describe, expect, it } from "vitest";

import { decidePoll, POLL_WINDOW_MS, pollRefusal } from "../../../admit/pollGate.js";
import type { PollShape } from "../../../admit/pollShape.js";

const SHAPE: PollShape = {
  kind: "poll",
  label: "log read",
  operands: [],
  paths: ["/tmp/x/validate.log"],
  target: "/tmp/x/validate.log",
};
const NOW = 1_000_000;
const TOKEN = "/tmp/x/validate.log\u0000120\u0000999000";
const GROWN = "/tmp/x/validate.log\u0000480\u0000999500";
const OTHER = "/tmp/x/other.log\u000064\u0000999000";

/** No change token on either side — the clock rule exactly as it stood before tokens existed. */
const NO_TOKENS = { fingerprint: undefined, lastFingerprint: undefined } as const;

describe("decidePoll on the clock", () => {
  it("allows and records a poll of a target never polled before", () => {
    expect(decidePoll({ ...NO_TOKENS, allowPoll: false, lastSeenMs: undefined, nowMs: NOW, shape: SHAPE })).toEqual({
      kind: "allow",
      record: true,
    });
  });

  it("refuses the same target polled 15 seconds ago when neither poll has a token", () => {
    expect(decidePoll({ ...NO_TOKENS, allowPoll: false, lastSeenMs: NOW - 15_000, nowMs: NOW, shape: SHAPE })).toEqual({
      kind: "block",
      message: pollRefusal({ label: "log read", secondsAgo: 15, target: "/tmp/x/validate.log" }),
    });
  });

  it("allows the same target exactly at the window edge", () => {
    expect(
      decidePoll({ ...NO_TOKENS, allowPoll: false, lastSeenMs: NOW - POLL_WINDOW_MS, nowMs: NOW, shape: SHAPE }),
    ).toEqual({ kind: "allow", record: true });
  });

  it("refuses one millisecond inside the window", () => {
    expect(
      decidePoll({ ...NO_TOKENS, allowPoll: false, lastSeenMs: NOW - POLL_WINDOW_MS + 1, nowMs: NOW, shape: SHAPE })
        .kind,
    ).toBe("block");
  });

  it("allows and still records under the break-glass", () => {
    expect(decidePoll({ ...NO_TOKENS, allowPoll: true, lastSeenMs: NOW - 1_000, nowMs: NOW, shape: SHAPE })).toEqual({
      kind: "allow",
      record: true,
    });
  });

  it("allows a non-poll without recording anything", () => {
    expect(
      decidePoll({ ...NO_TOKENS, allowPoll: false, lastSeenMs: NOW - 1_000, nowMs: NOW, shape: { kind: "not-poll" } }),
    ).toEqual({ kind: "allow", record: false });
  });

  it("honours a narrower window", () => {
    expect(
      decidePoll({
        ...NO_TOKENS,
        allowPoll: false,
        lastSeenMs: NOW - 5_000,
        nowMs: NOW,
        shape: SHAPE,
        windowMs: 4_000,
      }),
    ).toEqual({ kind: "allow", record: true });
  });
});

describe("decidePoll on the change token", () => {
  it("allows a re-read of a file whose token has not moved, inside the window, without moving the window", () => {
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: TOKEN,
        lastFingerprint: TOKEN,
        lastSeenMs: NOW - 4_000,
        nowMs: NOW,
        shape: SHAPE,
      }),
    ).toEqual({ kind: "allow", record: false });
  });

  it("lets a changed read through once the window from the FIRST read has passed, an unchanged read between", () => {
    // t=0 read, t=50s unchanged re-read (allowed, not recorded), t=70s changed: 70s from the record, so allowed.
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: GROWN,
        lastFingerprint: TOKEN,
        lastSeenMs: NOW - 70_000,
        nowMs: NOW,
        shape: SHAPE,
      }),
    ).toEqual({ kind: "allow", record: true });
  });

  it("refuses a file that grew since the last read — still being written", () => {
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: GROWN,
        lastFingerprint: TOKEN,
        lastSeenMs: NOW - 4_000,
        nowMs: NOW,
        shape: SHAPE,
      }),
    ).toEqual({
      kind: "block",
      message: pollRefusal({ label: "log read", secondsAgo: 4, target: "/tmp/x/validate.log" }),
    });
  });

  it("refuses when the file has no token now (missing, a directory, unreadable)", () => {
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: undefined,
        lastFingerprint: TOKEN,
        lastSeenMs: NOW - 4_000,
        nowMs: NOW,
        shape: SHAPE,
      }).kind,
    ).toBe("block");
  });

  it("allows a re-read naming fewer of the files the last read named, all untouched — one target, two sets", () => {
    // `grep x validate.log other.log` then `grep x validate.log`: both keyed by the first path.
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: TOKEN,
        lastFingerprint: `${TOKEN}\n${OTHER}`,
        lastSeenMs: NOW - 6_000,
        nowMs: NOW,
        shape: SHAPE,
      }),
    ).toEqual({ kind: "allow", record: false });
  });

  it("refuses a re-read naming a file the last read did not, though the target itself is untouched", () => {
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: `${TOKEN}\n${OTHER}`,
        lastFingerprint: TOKEN,
        lastSeenMs: NOW - 6_000,
        nowMs: NOW,
        shape: SHAPE,
      }).kind,
    ).toBe("block");
  });

  it("refuses when the last poll carried no token — a record written before tokens existed", () => {
    expect(
      decidePoll({
        allowPoll: false,
        fingerprint: TOKEN,
        lastFingerprint: undefined,
        lastSeenMs: NOW - 4_000,
        nowMs: NOW,
        shape: SHAPE,
      }).kind,
    ).toBe("block");
  });
});

describe("pollRefusal", () => {
  const message = pollRefusal({ label: "pid probe", secondsAgo: 12, target: "pid:4242" });

  it("names what was polled, how recently, and why it was not let through as unchanged", () => {
    expect(
      message.startsWith(
        "poll-gate: refused a pid probe of pid:4242 — the same target was polled 12s ago, and nothing shows it " +
          "unchanged since (a re-read of files that have not changed is let through; this one names a file that " +
          "changed, one the last read did not name, or something that is not a file).",
      ),
    ).toBe(true);
  });

  it("names all three replacement shapes and the break-glass", () => {
    expect(message).toContain("Monitor with timeout_ms");
    expect(message).toContain("run_in_background: true");
    expect(message).toContain("slopweaver github checks --wait");
    expect(message).toContain("SLOPWEAVER_ALLOW_POLL=1");
  });
});
