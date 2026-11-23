import { describe, expect, it } from "vitest";

import { parseDeadline } from "../../../cli/commands/sessionStart/core.js";
import {
  ORGANISATION_CUT_SHORT_LINE,
  unverifiedPastDeadline,
  unverifiedWithoutOrganisation,
  verifyCutParts,
} from "../../../cli/commands/sessionStart/unverifiedPass.js";
import { VERIFY_CUT_SHORT_LINE, type VerifySeams, verifyRows } from "../../../cli/commands/sessionStart/verifyRows.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type BoardEntry, boardLeg } from "../../../sessionStart/boardLeg.js";
import {
  beforeDeadline,
  cutShortLine,
  deadlineMsOf,
  runDeadline,
  timerDelayMs,
} from "../../../sessionStart/deadline.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";

const NOW = "2026-09-01T09:00:00.000Z";
const DEADLINE_MS = Date.parse("2026-11-06T05:00:00.000Z");

/** A promise that never settles: a provider call still in flight, or a deadline never reached. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** One board row stopped on the owner, asking about one pull request. */
const row = ({ slug, number }: { slug: string; number: number }): BoardEntry => ({
  events: [
    { atIso: "2026-08-30T00:00:00.000Z", branch: "a-branch", docHash: "0123456789abcdef", kind: "started" },
    { atIso: "2026-08-31T00:00:00.000Z", kind: "question", question: `#${String(number)} needs a ruling` },
  ],
  holder: { kind: "live" },
  repo: "/repos/dev/work/acme-admin",
  slug,
  summary: "A row with one pull request to re-read.",
});

/**
 * Seams whose pull-request read answers `open` for every number but `stallOn`, which never answers — a provider
 * call the deadline has to abandon — and `mergedOn`, which answers merged.
 */
function seamsStallingOn({ stallOn, mergedOn }: { stallOn: number | undefined; mergedOn?: number }): {
  seams: VerifySeams;
  asked: number[];
} {
  const asked: number[] = [];
  return {
    asked,
    seams: {
      codeOwnerSlice: async () => ({ kind: "notChecked", reads: 0, reason: "no GitHub token is stored" }),
      linearStateType: async () => undefined,
      pullRequestState: async ({ number }) => {
        asked.push(number);
        if (number === stallOn) {
          return never();
        }
        return number === mergedOn ? { kind: "settled", state: "MERGED" } : { kind: "open" };
      },
      viewerLogin: async () => ({ kind: "notChecked", reason: "no GitHub token is stored" }),
    },
  };
}

describe("deadlineMsOf", () => {
  it("reads a UTC instant, with or without milliseconds", () => {
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00.000Z" })).toBe(DEADLINE_MS);
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00Z" })).toBe(DEADLINE_MS);
  });

  it("reads any number of fractional-second digits, truncated to the millisecond", () => {
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00.0000Z" })).toBe(DEADLINE_MS);
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00.5Z" })).toBe(DEADLINE_MS + 500);
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00.123456789Z" })).toBe(DEADLINE_MS + 123);
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00.Z" })).toBe(undefined);
  });

  it("refuses an offset, a bare date, a local time, a number, padding and a day that does not exist", () => {
    expect(deadlineMsOf({ raw: "2026-11-06T16:00:00+11:00" })).toBe(undefined);
    expect(deadlineMsOf({ raw: "2026-11-06" })).toBe(undefined);
    expect(deadlineMsOf({ raw: "2026-11-06T05:00:00" })).toBe(undefined);
    expect(deadlineMsOf({ raw: "300000" })).toBe(undefined);
    expect(deadlineMsOf({ raw: " 2026-11-06T05:00:00Z" })).toBe(undefined);
    expect(deadlineMsOf({ raw: "2026-02-30T05:00:00Z" })).toBe(undefined);
  });
});

describe("parseDeadline", () => {
  it("is absent when the flag was not passed", () => {
    expect(unwrap(parseDeadline({ raw: undefined }))).toBe(undefined);
  });

  it("refuses a value that is not a UTC instant, naming the flag", () => {
    expect(unwrapErr(parseDeadline({ raw: "in five minutes" })).message).toBe(
      "--deadline must be an ISO instant ending in Z, got in five minutes",
    );
  });
});

describe("beforeDeadline", () => {
  it("abandons work still in flight when the deadline arrives", async () => {
    const raced = await beforeDeadline({ deadline: runDeadline({ reached: Promise.resolve() }), work: never });
    expect(raced).toEqual({ kind: "cut" });
  });

  it("returns the work's value when the deadline never arrives", async () => {
    const raced = await beforeDeadline({ deadline: runDeadline({ reached: never() }), work: async () => 7 });
    expect(raced).toEqual({ kind: "done", value: 7 });
  });

  it("never starts work once the deadline has been reached", async () => {
    const deadline = runDeadline({ reached: Promise.resolve() });
    await deadline.reached;
    let started = 0;
    const raced = await beforeDeadline({
      deadline,
      work: async () => {
        started += 1;
        return 7;
      },
    });
    expect(raced).toEqual({ kind: "cut" });
    expect(started).toBe(0);
  });

  it("never starts work once the instant has passed, though a synchronous stretch kept its timer from firing", async () => {
    let started = 0;
    const raced = await beforeDeadline({
      deadline: runDeadline({ passed: () => true, reached: never() }),
      work: async () => {
        started += 1;
        return 7;
      },
    });
    expect(raced).toEqual({ kind: "cut" });
    expect(started).toBe(0);
  });
});

describe("timerDelayMs", () => {
  it("waits the time left, none once it has passed, and never past what one Node timer honours", () => {
    expect(timerDelayMs({ deadlineMs: DEADLINE_MS, nowMs: DEADLINE_MS - 5_000 })).toBe(5_000);
    expect(timerDelayMs({ deadlineMs: DEADLINE_MS, nowMs: DEADLINE_MS + 5_000 })).toBe(0);
    expect(timerDelayMs({ deadlineMs: DEADLINE_MS, nowMs: DEADLINE_MS - 60 * 86_400_000 })).toBe(2_147_483_647);
  });
});

describe("runDeadline release", () => {
  it("stops what settles the deadline, once, when the live work is over", () => {
    let released = 0;
    const deadline = runDeadline({
      reached: never(),
      release: () => {
        released += 1;
      },
    });
    deadline.release();
    expect(released).toBe(1);
  });
});

describe("cutShortLine", () => {
  it("names what was skipped and the deadline that skipped it", () => {
    expect(cutShortLine({ deadlineMs: DEADLINE_MS, part: "your mail" })).toBe(
      "not read, your mail: this run reached its --deadline of 2026-11-06T05:00:00.000Z first, so the list is cut short",
    );
  });
});

describe("verifyRows under a deadline", () => {
  const inputs = boardLeg({
    entries: [row({ number: 11, slug: "first-row" }), row({ number: 22, slug: "second-row" })],
    nowIso: NOW,
  });

  it("abandons the row whose read is in flight at the deadline, keeping it and every later row unread", async () => {
    const { seams, asked } = seamsStallingOn({ stallOn: 11 });
    let reach = (): void => undefined;
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    const pass = verifyRows({ deadline: runDeadline({ reached }), inputs, organisation: ACME_ORGANISATION, seams });
    reach();
    const verified = await pass;
    expect(asked).toEqual([11]);
    expect(verified.cutShort).toBe(true);
    expect(verified.inputs.map((one) => one.item.nativeId)).toEqual(["first-row", "second-row"]);
    expect(verified.couldNotSee).toEqual([VERIFY_CUT_SHORT_LINE]);
  });

  it("drops a row the live read settled before the cut, as a whole pass would, and keeps the cut row unread", async () => {
    const { seams, asked } = seamsStallingOn({ mergedOn: 11, stallOn: 22 });
    let reach = (): void => undefined;
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    const pass = verifyRows({ deadline: runDeadline({ reached }), inputs, organisation: ACME_ORGANISATION, seams });
    // Let the first row's read settle before the deadline arrives on the second.
    await new Promise((resolve) => setImmediate(resolve));
    reach();
    const verified = await pass;
    expect(asked).toEqual([11, 22]);
    expect(verified.cutShort).toBe(true);
    expect(verified.inputs.map((one) => one.item.nativeId)).toEqual(["second-row"]);
    expect(verified.origins.map((one) => one.nativeId)).toEqual(["second-row"]);
  });

  it("keeps every row unread, and names the organisation read as cut, when the deadline arrives during it", () => {
    const verified = unverifiedPastDeadline({ inputs });
    expect(verified.cutShort).toBe(true);
    expect(verified.reads).toBe(0);
    expect(verified.inputs.map((one) => one.item.nativeId)).toEqual(["first-row", "second-row"]);
    expect(verified.origins).toEqual(inputs.map((one) => one.item));
    expect(verified.couldNotSee).toEqual([ORGANISATION_CUT_SHORT_LINE]);
    expect(verifyCutParts({ verified })).toEqual(["the live re-read, its organisation read unfinished"]);
  });

  it("names only the live re-read when the pass was cut mid-row, and nothing when it was not cut or not asked", async () => {
    const { seams } = seamsStallingOn({ stallOn: 11 });
    const pass = verifyRows({
      deadline: runDeadline({ reached: Promise.resolve() }),
      inputs,
      organisation: ACME_ORGANISATION,
      seams,
    });
    expect(verifyCutParts({ verified: await pass })).toEqual(["the live re-read"]);
    expect(verifyCutParts({ verified: unverifiedWithoutOrganisation({ inputs, refusal: "no organisation" }) })).toEqual(
      [],
    );
    expect(verifyCutParts({ verified: undefined })).toEqual([]);
  });

  it("reads every row and is not cut short when the deadline never arrives", async () => {
    const { seams, asked } = seamsStallingOn({ stallOn: undefined });
    const verified = await verifyRows({
      deadline: runDeadline({ reached: never() }),
      inputs,
      organisation: ACME_ORGANISATION,
      seams,
    });
    expect(asked).toEqual([11, 22]);
    expect(verified.cutShort).toBe(false);
    expect(verified.couldNotSee).toEqual([]);
  });
});
