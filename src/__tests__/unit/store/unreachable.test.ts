/**
 * The store's stack-is-down failure — the classification, and the one wording both callers share.
 *
 * With Docker stopped and the board itself living in the store, the fleet must fail loudly, since that
 * degrades everything. That rules out the tempting alternative — a silent fall back to the local files — so
 * these cases assert the message SAYS it does not do that, not merely that a failure happened.
 *
 * Pure: the classification is a predicate over the driver's own reason, and the message is a function of
 * it. No database, no connection, no clock.
 */
import { describe, expect, it } from "vitest";

import { driverReasonWithin, isUnreachableReason, StoreErrors, unreachableMessage } from "../../../store/errors.js";

describe("isUnreachableReason", () => {
  // MEASURED against a closed port, which is what a stopped `yarn store:start` leaves behind:
  // `SLOPWEAVER_STORE_URL=postgresql://127.0.0.1:59999/nope slopweaver store verify`.
  it("classifies a refused connection, the shape a stopped stack actually produces", () => {
    expect(isUnreachableReason({ reason: "connect ECONNREFUSED 127.0.0.1:59999" })).toBe(true);
  });

  it("classifies a host that does not resolve", () => {
    expect(isUnreachableReason({ reason: "getaddrinfo ENOTFOUND db.example.invalid" })).toBe(true);
  });

  // A container that is up but not accepting yet — the window right after `yarn store:start` returns.
  it("classifies a timed-out connection", () => {
    expect(isUnreachableReason({ reason: "connect ETIMEDOUT 127.0.0.1:55322" })).toBe(true);
  });

  // The other side of the line, and the reason this is a predicate rather than "any failure is loud": these
  // prove the database ANSWERED. Telling an operator to run `yarn store:start` because a constraint fired
  // would send them to fix something that is not broken.
  it("does not classify a constraint failure, which proves the database answered", () => {
    expect(isUnreachableReason({ reason: 'duplicate key value violates unique constraint "board_row_slug_key"' })).toBe(
      false,
    );
  });

  it("does not classify a permission failure", () => {
    expect(isUnreachableReason({ reason: 'permission denied for table "board_row"' })).toBe(false);
  });

  it("does not classify an empty reason", () => {
    expect(isUnreachableReason({ reason: "" })).toBe(false);
  });
});

describe("unreachableMessage", () => {
  it("carries the driver's own reason, so the failure stays diagnosable", () => {
    expect(unreachableMessage({ reason: "connect ECONNREFUSED 127.0.0.1:59999" })).toContain(
      "connect ECONNREFUSED 127.0.0.1:59999",
    );
  });

  it("names the remedy rather than only the symptom", () => {
    const message = unreachableMessage({ reason: "connect ECONNREFUSED 127.0.0.1:55322" });

    expect(message).toContain("yarn store:start");
    expect(message).toContain("yarn store:status");
  });

  // The rule itself, not a paraphrase of it: what is refused is a fleet that keeps going on stale local
  // state. A message that merely reported the error would pass every other case in this file.
  it("says out loud that nothing falls back to a local copy", () => {
    const message = unreachableMessage({ reason: "connect ECONNREFUSED 127.0.0.1:55322" });

    expect(message).toContain("nothing here falls back to a local copy");
    expect(message).toContain("owner ruling: fail loudly");
  });

  // `supabase/config.toml` puts this stack on 553xx, and 54323 is the port a project that never set one
  // would have. An operator sent to the default finds nothing listening and concludes the stack is broken.
  it("points at the ports this stack really binds, not the CLI defaults", () => {
    expect(unreachableMessage({ reason: "connect ECONNREFUSED 127.0.0.1:55322" })).toContain("553xx");
  });
});

describe("StoreErrors.unreachable", () => {
  it("builds the variant a caller branches on, carrying the same wording", () => {
    const error = StoreErrors.unreachable({ reason: "connect ECONNREFUSED 127.0.0.1:59999" });

    expect(error.code).toBe("STORE_UNREACHABLE");
    expect(error.reason).toBe("connect ECONNREFUSED 127.0.0.1:59999");
    expect(error.message).toBe(unreachableMessage({ reason: "connect ECONNREFUSED 127.0.0.1:59999" }));
  });

  // Separate from `STORE_QUERY_FAILED` on purpose: a query that failed proves the database is there and
  // said no, while this proves nothing was listening. A caller that cannot tell them apart cannot decide
  // whether to tell the operator to start Docker.
  // CAUGHT BY REVIEW: `connectStore` built the variant with
  // `reason` set to the whole composed paragraph, while the factory sets it to the driver's own line — so
  // the field's doc comment ("what the driver actually reported") was false on the path that actually runs.
  // The recovery is exercised here through the composed message a caller really receives.
  it("recovers the driver's own line when handed the message the lifecycle already composed", () => {
    const composed = unreachableMessage({ reason: "connect ECONNREFUSED 127.0.0.1:55322" });

    const error = StoreErrors.unreachable({ reason: driverReasonWithin({ message: composed }) });

    expect(error.reason).toBe("connect ECONNREFUSED 127.0.0.1:55322");
    expect(error.message).toBe(composed);
  });

  it("leaves a bare driver reason alone, since there is no prefix to strip", () => {
    expect(driverReasonWithin({ message: "connect ETIMEDOUT 127.0.0.1:55322" })).toBe(
      "connect ETIMEDOUT 127.0.0.1:55322",
    );
  });

  it("is a distinct code from a query the database answered no to", () => {
    const unreachable = StoreErrors.unreachable({ reason: "connect ECONNREFUSED 127.0.0.1:59999" });
    const answered = StoreErrors.queryFailed({ cause: new Error("permission denied"), what: "read the board" });

    expect(unreachable.code).not.toBe(answered.code);
    expect(answered.code).toBe("STORE_QUERY_FAILED");
  });
});
