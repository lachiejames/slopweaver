/**
 * `recordRaise`: a fresh create leaves a checks-read row and names the command that discharges it, while a push
 * that only updated a pull request records and prints nothing. Split from `stackPushRun.test.ts` by behaviour.
 */
import { describe, expect, it } from "vitest";

import { recordRaise } from "../../../../../../cli/commands/github/stackPushReport.js";
import { unwrap } from "../../../../../../lib/result.js";
import { checksReadCommand, readChecksReadLedger } from "../../../../../../outbound/github/checksReadLedger.js";
import { LOCAL_SHA } from "./fixtures.js";
import { tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("recordRaise", () => {
  const PLAN = { facts: { branch: "feature" }, form: { target: { owner: "o", repo: "r" } } } as const;
  const NOW = new Date("2026-09-01T00:00:00.000Z");

  it("leaves a checks-read row behind a fresh create, and names the command that discharges it", () => {
    const home = tempHome();
    const lines: string[] = [];
    const created = { kind: "created", number: 42, url: "https://github.com/o/r/pull/42" } as const;
    recordRaise({
      deps: { now: () => NOW, out: ({ line }) => lines.push(line) },
      home,
      plan: PLAN,
      result: { headSha: LOCAL_SHA, outcome: created },
    });
    const row = {
      atIso: NOW.toISOString(),
      branch: "feature",
      headSha: LOCAL_SHA,
      kind: "raised",
      number: 42,
      repo: "o/r",
    } as const;
    expect(lines).toEqual([
      "NEXT: this pull request is not RAISED until its checks have been read once. Run:",
      `  ${checksReadCommand({ row })}`,
      "  `handover finish` and `handover settle` refuse on this branch until that read is on the record.",
    ]);
    expect(unwrap(readChecksReadLedger({ home })).map((recorded) => recorded.kind)).toEqual(["raised"]);
  });

  it("records nothing and says nothing when the push did not create a pull request", () => {
    const home = tempHome();
    const lines: string[] = [];
    const updated = { kind: "updated", number: 42, url: "https://github.com/o/r/pull/42" } as const;
    recordRaise({
      deps: { now: () => NOW, out: ({ line }) => lines.push(line) },
      home,
      plan: PLAN,
      result: { headSha: LOCAL_SHA, outcome: updated },
    });
    expect(lines).toEqual([]);
    expect(unwrap(readChecksReadLedger({ home }))).toEqual([]);
  });
});
