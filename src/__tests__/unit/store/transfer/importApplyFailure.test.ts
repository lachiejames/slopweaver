/**
 * What a thrown apply transaction means for its batch: a throw inside the body, or a commit the server refused, rolled
 * it back, so none of its rows was written; a commit nobody answered, or one answered with a code that does not settle
 * it, may have stood, so it is reported as unknown
 * (a lost COMMIT acknowledgement read as "none of its rows was written"). Pure.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  applyTransactionFailure,
  commitRefused,
  settleThrownApply,
} from "../../../../store/transfer/importApplyFailure.js";

const BATCH = "0f1e2d3c-4b5a-4968-8776-655443322110";

/** An error as the Postgres server sends one: its SQLSTATE and severity beside the message. */
function serverError({ code, message }: { code: string; message: string }): Error {
  return Object.assign(new Error(message), { code, severity: "ERROR" });
}

/** An error as drizzle throws one, wrapping the driver's under "Failed query". */
function failedQuery({ cause }: { cause: Error }): Error {
  return new Error("Failed query: commit", { cause });
}

describe("commitRefused", () => {
  it("finds a rollback-class SQLSTATE under drizzle's wrapper", () => {
    const cause = failedQuery({ cause: serverError({ code: "23505", message: "duplicate key value" }) });
    expect(commitRefused({ cause })).toBe(true);
  });

  it("reads every rollback class, and class 40's four rollback codes, as refused", () => {
    const codes = ["22012", "23503", "P0001", "40000", "40001", "40002", "40P01"];
    expect(codes.map((code) => commitRefused({ cause: serverError({ code, message: code }) }))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("reads every code whose outcome the server does not settle as unsettled", () => {
    const codes = ["08007", "08006", "40003", "25P02", "57P01", "53100"];
    expect(codes.map((code) => commitRefused({ cause: serverError({ code, message: code }) }))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("reads a dropped connection as no refusal, though its code is five capitals", () => {
    const dropped = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(commitRefused({ cause: failedQuery({ cause: dropped }) })).toBe(false);
  });

  it("reads a severity beside a code that is no SQLSTATE as no refusal", () => {
    const closed = Object.assign(new Error("connection closed"), { code: "CONNECTION_CLOSED", severity: "FATAL" });
    expect(commitRefused({ cause: closed })).toBe(false);
  });

  it("reads a thrown non-Error as no refusal", () => {
    expect(commitRefused({ cause: "socket hang up" })).toBe(false);
  });
});

describe("applyTransactionFailure", () => {
  it("calls a throw inside the body a failure that wrote none of the batch's rows", () => {
    const refusal = applyTransactionFailure({
      batchId: BATCH,
      bodyFinished: false,
      cause: failedQuery({ cause: new Error("connection reset") }),
    });
    expect(refusal).toEqual({
      batchId: BATCH,
      code: "IMPORT_APPLICATION_FAILED",
      message: `batch ${BATCH} did not apply, and none of its rows was written: the store: connection reset`,
      register: "the store",
    });
  });

  it("calls a commit the server refused a failure that wrote none of the batch's rows", () => {
    const refusal = applyTransactionFailure({
      batchId: BATCH,
      bodyFinished: true,
      cause: failedQuery({ cause: serverError({ code: "40001", message: "could not serialize access" }) }),
    });
    expect(refusal).toEqual({
      batchId: BATCH,
      code: "IMPORT_APPLICATION_FAILED",
      message: `batch ${BATCH} did not apply, and none of its rows was written: the store's commit: could not serialize access`,
      register: "the store's commit",
    });
  });

  it("calls a commit nobody answered unknown, and says what running it again does", () => {
    const refusal = applyTransactionFailure({
      batchId: BATCH,
      bodyFinished: true,
      cause: Object.assign(new Error("write CONNECTION_CLOSED 127.0.0.1:5432"), { code: "CONNECTION_CLOSED" }),
    });
    expect(refusal).toEqual({
      batchId: BATCH,
      code: "IMPORT_COMMIT_UNCONFIRMED",
      message:
        `batch ${BATCH} ran to its end but its commit went unanswered, or was answered with a code that does not say ` +
        "it rolled back, so whether its rows were written is unknown: write CONNECTION_CLOSED 127.0.0.1:5432; the same " +
        "apply, run again against the same store, reports it already applied if the commit stood, and otherwise tries " +
        "the batch again",
    });
  });

  it("calls a commit the server answered with 08007 or 40003 unknown, never none written", () => {
    const codes = ["08007", "40003"];
    const refusals = codes.map(
      (code) =>
        applyTransactionFailure({
          batchId: BATCH,
          bodyFinished: true,
          cause: failedQuery({ cause: serverError({ code, message: "completion unknown" }) }),
        }).code,
    );
    expect(refusals).toEqual(["IMPORT_COMMIT_UNCONFIRMED", "IMPORT_COMMIT_UNCONFIRMED"]);
  });

  it("cuts a long unanswered cause to the bound every apply message keeps", () => {
    const refusal = applyTransactionFailure({ batchId: BATCH, bodyFinished: true, cause: new Error("x".repeat(500)) });
    expect(refusal.message).toContain(`unknown: ${"x".repeat(399)}…; the same apply`);
  });
});

describe("settleThrownApply", () => {
  const dropped = Object.assign(new Error("write CONNECTION_CLOSED 127.0.0.1:5432"), { code: "CONNECTION_CLOSED" });

  it("keeps an already-applied body's outcome when its COMMIT goes unanswered", () => {
    const finished = { batchId: BATCH, outcome: "already-applied", planDigest: "sha256:plan", writes: 0 } as const;
    expect(unwrap(settleThrownApply({ batchId: BATCH, cause: dropped, finished }))).toEqual(finished);
  });

  it("calls an applying body's unanswered COMMIT unknown", () => {
    const finished = { batchId: BATCH, outcome: "applied" } as const;
    expect(unwrapErr(settleThrownApply({ batchId: BATCH, cause: dropped, finished })).code).toBe(
      "IMPORT_COMMIT_UNCONFIRMED",
    );
  });

  it("calls a throw before the body returned a failure that wrote nothing", () => {
    const settled = settleThrownApply<{ readonly outcome: "applied" }>({
      batchId: BATCH,
      cause: dropped,
      finished: undefined,
    });
    expect(unwrapErr(settled).code).toBe("IMPORT_APPLICATION_FAILED");
  });
});
