/**
 * The chair's read of the console's withheld-card report: a 200 with the report reads, and every other answer — no
 * console, a build without the route, a body that drifted — is a named failure, never an empty report.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";

import {
  type ConsoleGet,
  fetchQueueRefusals,
  type QueueRefusalReport,
  QueueRefusalsErrors,
  queueRefusalsOutcome,
  queueRefusalsOutcomeSchema,
} from "../../../queueRefusals/report.js";

const BASE = "http://localhost:3100";
const REPORT_URL = `${BASE}/api/queue-refusals`;

const REPORT: QueueRefusalReport = {
  complete: true,
  observedAtIso: "2026-10-09T06:00:00.000Z",
  unread: [],
  withheld: [{ key: "post:sd-e523766e", kind: "post", title: "Post this as you?", why: "names a call by its id" }],
};

/** A getter that answers `status` with `text`, recording the request it was given. */
function answering({ status, text, seen }: { status: number; text: string; seen: string[] }): ConsoleGet {
  return async ({ url, timeoutMs }) => {
    seen.push(`${url} ${String(timeoutMs)}`);
    return { status, text };
  };
}

describe("fetchQueueRefusals", () => {
  it("reads a 200 report from the console's route, within the read budget", async () => {
    const seen: string[] = [];
    const read = await fetchQueueRefusals({
      consoleBase: BASE,
      get: answering({ seen, status: 200, text: JSON.stringify(REPORT) }),
    });
    expect(unwrap(read)).toEqual(REPORT);
    expect(seen).toEqual([`${REPORT_URL} 100000`]);
  });

  it("names a console that did not answer, by its address", async () => {
    const read = await fetchQueueRefusals({
      consoleBase: BASE,
      get: async () => {
        throw new Error("fetch failed");
      },
    });
    const error = unwrapErr(read);
    expect([error.code, error.message]).toEqual([
      "CONSOLE_UNREACHABLE",
      `the console at ${REPORT_URL} did not answer: fetch failed`,
    ]);
  });

  it("names a 404 as a build that may lack the route", async () => {
    const read = await fetchQueueRefusals({ consoleBase: BASE, get: answering({ seen: [], status: 404, text: "" }) });
    expect(unwrapErr(read)).toEqual(QueueRefusalsErrors.refused({ status: 404, url: REPORT_URL }));
    expect(unwrapErr(read).message).toBe(
      `the console at ${REPORT_URL} answered 404, not the report — it may be serving a build without that route`,
    );
  });

  it("refuses a report that carries a field this build does not read", async () => {
    const drifted = JSON.stringify({ ...REPORT, total: 1 });
    const read = await fetchQueueRefusals({
      consoleBase: BASE,
      get: answering({ seen: [], status: 200, text: drifted }),
    });
    const error = unwrapErr(read);
    expect(error.code).toBe("REPORT_UNREADABLE");
    expect(error.message).toContain(`the console at ${REPORT_URL} answered a report this build does not read`);
  });

  it("refuses a report claiming completeness beside an unread register, rather than reading it as zero", async () => {
    const disagreeing = JSON.stringify({ ...REPORT, unread: [{ source: "board", why: "timed out" }], withheld: [] });
    const read = await fetchQueueRefusals({
      consoleBase: BASE,
      get: answering({ seen: [], status: 200, text: disagreeing }),
    });
    const error = unwrapErr(read);
    expect(error.code).toBe("REPORT_UNREADABLE");
    expect(error.message).toContain("complete disagrees with unread");
  });
});

describe("queueRefusalsOutcome", () => {
  it("prints the report beside its address when the console answered, and the schema reads it back", () => {
    const outcome = queueRefusalsOutcome({ consoleUrl: REPORT_URL, read: ok(REPORT) });
    expect(outcome).toEqual({ consoleUrl: REPORT_URL, reached: true, ...REPORT });
    expect(queueRefusalsOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it("prints why when the console did not answer — a document of its own, never an empty report", async () => {
    const read = await fetchQueueRefusals({ consoleBase: BASE, get: answering({ seen: [], status: 503, text: "" }) });
    const outcome = queueRefusalsOutcome({ consoleUrl: REPORT_URL, read });
    expect(outcome).toEqual({
      consoleUrl: REPORT_URL,
      reached: false,
      why: `the console at ${REPORT_URL} answered 503, not the report`,
    });
    expect(queueRefusalsOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it("refuses a captured document whose completeness disagrees with its unread registers, either way", () => {
    const claimsComplete = {
      ...REPORT,
      consoleUrl: REPORT_URL,
      reached: true,
      unread: [{ source: "board", why: "x" }],
    };
    const claimsIncomplete = { ...REPORT, complete: false, consoleUrl: REPORT_URL, reached: true };
    const messages = [claimsComplete, claimsIncomplete].map(
      (document) => queueRefusalsOutcomeSchema.safeParse(document).error!.issues.map((issue) => issue.message)[0],
    );
    expect(messages).toEqual([
      "complete disagrees with unread: a complete report names no unread register",
      "complete disagrees with unread: a complete report names no unread register",
    ]);
  });
});
