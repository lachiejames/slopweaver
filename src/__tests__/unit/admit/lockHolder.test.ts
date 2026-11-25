/**
 * Who may take a never-stale lease: only a process whose own start stamp `ps` gave, or one whose guardian still
 * vouches for it, so no live writer's record is one `heldReason` ages out on the ordinary window.
 */
import { describe, expect, it } from "vitest";

import { unstampedLeaseRefusal } from "../../../admit/lockHolder.js";
import type { ProcessGuardian } from "../../../admit/processGuardian.js";
import type { StartOf } from "../../../talk/relayLease.js";

const PATH = "/home/locks/hand-step-register";

const REFUSAL = `the lock at ${PATH} is never stale, and /bin/ps did not give this process's own start stamp — refusing rather than writing a record another process would age out while this one still holds it; run the command again`;

/** The worker's stamp as `ps` prints it: a space-padded day keeps both spaces. */
const GUARDIAN_START = "Wed Nov  5 09:01:02 2026";

const GUARDIAN: ProcessGuardian = { pid: 5151, start: GUARDIAN_START };

/**
 * A probe answering every pid as running with one stamp — a plain fake, not a mock.
 *
 * @returns the probe
 */
function answering({ start }: { start: string | undefined }): StartOf {
  return () => ({ running: true, start });
}

/** A probe answering every pid as gone. */
const GONE: StartOf = () => ({ running: false, start: undefined });

describe("unstampedLeaseRefusal", () => {
  it("refuses a never-stale lease to a process with no start stamp, naming the lock", () => {
    expect(unstampedLeaseRefusal({ path: PATH, staleAfterMs: Number.POSITIVE_INFINITY, start: undefined })).toBe(
      REFUSAL,
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

describe("unstampedLeaseRefusal with a guardian", () => {
  it("admits a never-stale lease to an unstamped writer whose guardian is live with its exact recorded stamp", () => {
    expect(
      unstampedLeaseRefusal({
        guardian: GUARDIAN,
        path: PATH,
        staleAfterMs: Number.POSITIVE_INFINITY,
        start: undefined,
        startOf: answering({ start: GUARDIAN_START }),
      }),
    ).toBeUndefined();
  });

  it("refuses it when the guardian's pid now names a process with a different stamp", () => {
    expect(
      unstampedLeaseRefusal({
        guardian: GUARDIAN,
        path: PATH,
        staleAfterMs: Number.POSITIVE_INFINITY,
        start: undefined,
        startOf: answering({ start: "Wed Nov  5 09:01:03 2026" }),
      }),
    ).toBe(REFUSAL);
  });

  it("refuses it when the guardian is gone", () => {
    expect(
      unstampedLeaseRefusal({
        guardian: GUARDIAN,
        path: PATH,
        staleAfterMs: Number.POSITIVE_INFINITY,
        start: undefined,
        startOf: GONE,
      }),
    ).toBe(REFUSAL);
  });

  it("admits it inside the sandbox, where the guardian answers signal 0 but ps gives no stamp to compare", () => {
    expect(
      unstampedLeaseRefusal({
        guardian: GUARDIAN,
        path: PATH,
        staleAfterMs: Number.POSITIVE_INFINITY,
        start: undefined,
        startOf: answering({ start: undefined }),
      }),
    ).toBeUndefined();
  });

  it("still refuses with no guardian, whatever the probe answers", () => {
    expect(
      unstampedLeaseRefusal({
        guardian: undefined,
        path: PATH,
        staleAfterMs: Number.POSITIVE_INFINITY,
        start: undefined,
        startOf: answering({ start: GUARDIAN_START }),
      }),
    ).toBe(REFUSAL);
  });
});
