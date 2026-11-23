/**
 * `queue stopping`'s read of the console report: a report that reads is handed back whole, and every way it does not —
 * no console, a refusal, a shape this build does not read, a `complete` that disagrees with `unread` — is a typed error
 * naming why, never "nothing stops". The getter is a plain injected function, not a mock.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { stoppingExitCode } from "../../../cli/commands/queue/stoppingRun.js";
import { QUEUE_STOPPING_USAGE } from "../../../cli/commands/queue/stoppingUsage.js";
import type { ConsoleGet } from "../../../queueRefusals/report.js";
import { fetchQueueStopping, queueStoppingOutcome } from "../../../queueStopping/report.js";

const BASE = "http://localhost:3100";
const AT = "2026-10-19T12:00:00.000Z";

const REPORT = {
  complete: true,
  observedAtIso: AT,
  stopping: [
    {
      key: "ask:iso-blocker",
      kind: "ask",
      options: [{ letter: "A", sentence: "Approve it" }],
      problem: "ISO is blocked.",
      question: "Which way on iso-blocker?",
      reason: "blocks-focus",
    },
  ],
  unread: [],
};

/** A getter answering `status` with `body`, and recording the address it was asked. */
function answering({ status, body }: { status: number; body: unknown }): { get: ConsoleGet; asked: string[] } {
  const asked: string[] = [];
  const get: ConsoleGet = async ({ url }) => {
    asked.push(url);
    return { status, text: JSON.stringify(body) };
  };
  return { asked, get };
}

describe("fetchQueueStopping", () => {
  it("reads the report from the console's route, whole", async () => {
    const { get, asked } = answering({ body: REPORT, status: 200 });
    const read = await fetchQueueStopping({ consoleBase: BASE, get });
    expect([unwrap(read), asked]).toEqual([REPORT, [`${BASE}/api/queue-stopping`]]);
  });

  it("names a console that did not answer, one that refused, and a body it does not read", async () => {
    const down: ConsoleGet = async () => {
      throw new Error("ECONNREFUSED");
    };
    const errors = await Promise.all([
      fetchQueueStopping({ consoleBase: BASE, get: down }),
      fetchQueueStopping({ consoleBase: BASE, get: answering({ body: {}, status: 404 }).get }),
      fetchQueueStopping({ consoleBase: BASE, get: answering({ body: { ...REPORT, extra: 1 }, status: 200 }).get }),
      fetchQueueStopping({
        consoleBase: BASE,
        get: answering({ body: { ...REPORT, complete: false }, status: 200 }).get,
      }),
    ]);
    expect(errors.map((read) => unwrapErr(read).code)).toEqual([
      "CONSOLE_UNREACHABLE",
      "CONSOLE_REFUSED",
      "REPORT_UNREADABLE",
      "REPORT_UNREADABLE",
    ]);
    expect(unwrapErr(errors[1]).message).toContain("a build without that route");
  });
});

describe("the printed document and its exit code", () => {
  it("is 0 only for a complete report from a console that answered", async () => {
    const consoleUrl = `${BASE}/api/queue-stopping`;
    const whole = queueStoppingOutcome({
      consoleUrl,
      read: await fetchQueueStopping({ consoleBase: BASE, get: answering({ body: REPORT, status: 200 }).get }),
    });
    const partial = { ...whole, complete: false, unread: [{ source: "board", why: "timed out" }] };
    const down = queueStoppingOutcome({
      consoleUrl,
      read: await fetchQueueStopping({ consoleBase: BASE, get: answering({ body: {}, status: 500 }).get }),
    });
    expect([
      stoppingExitCode({ outcome: whole }),
      stoppingExitCode({ outcome: partial }),
      stoppingExitCode({ outcome: down }),
    ]).toEqual([0, 1, 1]);
  });

  it("documents exactly the one flag it parses", () => {
    expect(QUEUE_STOPPING_USAGE).toBe("usage: slopweaver queue stopping [--json]");
  });
});
