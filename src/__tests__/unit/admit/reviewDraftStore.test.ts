import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendReviewDraftEvent,
  mintReviewDraftId,
  readReviewDraftLines,
  reviewDraftLogPath,
} from "../../../admit/reviewDraftStore.js";
import { parseReviewDraftLog } from "../../../outbound/github/reviewDraft.js";

describe("the review-draft store", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "review-draft-store-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a home that never parked a review as no lines, not as a failure", () => {
    expect(readReviewDraftLines({ home })._unsafeUnwrap()).toEqual([]);
  });

  it("appends events that read back in order, in a file only the owner can read", () => {
    const first = { id: "rd-1", kind: "dropped" as const, note: "one", tsIso: "2026-09-28T00:00:00.000Z" };
    const second = { id: "rd-2", kind: "dropped" as const, note: "two", tsIso: "2026-09-28T01:00:00.000Z" };

    expect(appendReviewDraftEvent({ event: first, home })._unsafeUnwrap()).toBe(true);
    expect(appendReviewDraftEvent({ event: second, home })._unsafeUnwrap()).toBe(true);

    const log = parseReviewDraftLog({ lines: readReviewDraftLines({ home })._unsafeUnwrap() });
    expect(log.events).toEqual([first, second]);
    const path = reviewDraftLogPath({ home });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });

  it("returns a write failure rather than throwing when the register cannot be written", () => {
    // A directory where the log file should be makes the append fail on every platform.
    mkdirSync(reviewDraftLogPath({ home }), { recursive: true });
    const event = { id: "rd-1", kind: "dropped" as const, note: "x", tsIso: "2026-09-28T00:00:00.000Z" };

    expect(appendReviewDraftEvent({ event, home })._unsafeUnwrapErr().code).toBe("REVIEW_DRAFT_WRITE_FAILED");
    expect(readReviewDraftLines({ home })._unsafeUnwrapErr().code).toBe("REVIEW_DRAFT_READ_FAILED");
  });

  it("refuses a log it cannot reach rather than reading it as a home that never parked a review", () => {
    // A FILE where the queue directory should be: `existsSync` answers false for the log beneath it (ENOTDIR), which
    // is not absence.
    writeFileSync(dirname(reviewDraftLogPath({ home })), "");

    expect(readReviewDraftLines({ home })._unsafeUnwrapErr().code).toBe("REVIEW_DRAFT_READ_FAILED");
  });

  it("mints short ids that cannot be mistaken for a Slack draft's", () => {
    expect(mintReviewDraftId()).toMatch(/^rd-[0-9a-f]{8}$/);
  });
});
