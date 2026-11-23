/**
 * Who may take a never-stale lease: only a process whose own start stamp `ps` gave, so no live writer's record is
 * one `heldReason` ages out on the ordinary window.
 */
import { describe, expect, it } from "vitest";

import { unstampedLeaseRefusal } from "../../../admit/lockHolder.js";

const PATH = "/home/locks/hand-step-register";

describe("unstampedLeaseRefusal", () => {
  it("refuses a never-stale lease to a process with no start stamp, naming the lock", () => {
    expect(unstampedLeaseRefusal({ path: PATH, staleAfterMs: Number.POSITIVE_INFINITY, start: undefined })).toBe(
      `the lock at ${PATH} is never stale, and /bin/ps did not give this process's own start stamp — refusing rather than writing a record another process would age out while this one still holds it; run the command again`,
    );
  });

  it("admits a never-stale lease to a stamped process", () => {
    expect(
      unstampedLeaseRefusal({ path: PATH, staleAfterMs: Number.POSITIVE_INFINITY, start: "Sun Sep 27 10:00:00 2026" }),
    ).toBeUndefined();
  });

  it("admits an ageing lease to an unstamped process, which ages out on its own window either way", () => {
    expect(unstampedLeaseRefusal({ path: PATH, staleAfterMs: 900_000, start: undefined })).toBeUndefined();
  });
});
