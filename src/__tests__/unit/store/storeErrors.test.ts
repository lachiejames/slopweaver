/**
 * What a database failure is allowed to say, and what it must never repeat back.
 *
 * MEASURED, and the reason this file exists: a GitHub ingest of 1,200 records hit a real
 * constraint failure, and the refusal wrote **962,926 bytes** to the terminal — `postgres.js` builds its
 * message from the failed statement plus every bound parameter, so the store printed the verbatim bodies
 * of about a hundred pull requests on its way to saying what went wrong. A boundary whose error path
 * spills what it holds is not a boundary, and no reviewer catches it because the message is correct.
 */
import { describe, expect, it } from "vitest";

import { StoreErrors } from "../../../store/errors.js";

/** The shape Drizzle wraps a driver error in: the whole statement above, the real reason underneath. */
const wrapped = ({ reason, statement }: { reason: string; statement: string }): Error => {
  const driver = new Error(reason);
  return new Error(`Failed query: ${statement}\nparams: a body with a secret in it`, { cause: driver });
};

describe("a database failure names Postgres's reason", () => {
  const failure = StoreErrors.queryFailed({
    cause: wrapped({
      reason: 'duplicate key value violates unique constraint "uq_content_source_native"',
      statement: 'insert into "content" values ($1) -- a whole pull request body',
    }),
    what: "store ingest",
  });

  it("carries the reason a reader acts on", () => {
    expect(failure.message).toBe(
      'store ingest failed: duplicate key value violates unique constraint "uq_content_source_native"',
    );
  });

  it("repeats no part of the statement", () => {
    expect(failure.message.includes("insert into")).toBe(false);
  });

  it("repeats none of the bound parameters, which are the corpus", () => {
    expect(failure.message.includes("a body with a secret in it")).toBe(false);
  });

  it("keeps the cause, so a caller that wants the whole thing still has it", () => {
    expect(failure.cause instanceof Error).toBe(true);
  });
});

describe("a failure with nothing wrapped around it still reads", () => {
  it("uses a plain error's own message", () => {
    expect(StoreErrors.queryFailed({ cause: new Error("connection refused"), what: "store list" }).message).toBe(
      "store list failed: connection refused",
    );
  });

  it("takes only the first line of a multi-line message", () => {
    expect(StoreErrors.queryFailed({ cause: new Error("first\nsecond"), what: "store list" }).message).toBe(
      "store list failed: first",
    );
  });

  it("caps a single enormous line rather than printing it whole", () => {
    const message = StoreErrors.queryFailed({ cause: new Error("x".repeat(5000)), what: "store list" }).message;
    expect(message.length).toBe("store list failed: ".length + 301);
  });

  it("stringifies a thrown value that is not an error at all", () => {
    expect(StoreErrors.queryFailed({ cause: "socket hang up", what: "store list" }).message).toBe(
      "store list failed: socket hang up",
    );
  });

  it("names an UNREACHABLE database, whose own message is empty", () => {
    // MEASURED against an unreachable port: `postgres.js` reports a failed CONNECTION as an
    // `AggregateError` whose own `message` is "" and whose `errors` carry one entry per address family.
    // Before this arm every store verb answered `… failed: ` and named nothing — the one failure a caller
    // most needs told. Reproduce with
    // `SLOPWEAVER_STORE_URL=postgresql://postgres:x@localhost:55999/postgres slopweaver store status`.
    // The EMPTY message is the whole fixture: it is exactly the shape `postgres.js` builds for an
    // unreachable host, and a non-empty one would not test the arm under test.
    const addresses = [new Error("connect ECONNREFUSED ::1:55999"), new Error("connect ECONNREFUSED 127.0.0.1:55999")];
    // eslint-disable-next-line unicorn/error-message -- see above: the empty message IS the case.
    const refused = new AggregateError(addresses, "");
    expect(StoreErrors.queryFailed({ cause: refused, what: "store list" }).message).toBe(
      "store list failed: connect ECONNREFUSED ::1:55999",
    );
  });

  it("falls back to the error's own NAME rather than an empty string when nothing carries text", () => {
    // eslint-disable-next-line unicorn/error-message -- as above: an empty message IS the case under test.
    const nameless = new AggregateError([], "");
    expect(StoreErrors.queryFailed({ cause: nameless, what: "store list" }).message).toBe(
      "store list failed: AggregateError",
    );
  });
});
