/**
 * `slopweaver plans lapse`, driven through the real run function over injected seams: a malformed `--on` is
 * refused before the register is read or written, and a strict instant becomes exactly one `set-lapse` mutation
 * carrying the instant as typed — an offset kept, never normalised.
 */
import { describe, expect, it } from "vitest";

import { plansUsage } from "../../../../../cli/commands/plans/plansUsage.js";
import { runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { fresh, recordingDeps } from "./plansRunFixtures.js";

describe("plans lapse", () => {
  it("refuses an --on that is not a strict instant before any register read or write", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--on", "1763337600"],
      verb: "lapse",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics).toStrictEqual([
      "--on must be an ISO-8601 instant, such as 2026-11-17T00:00:00Z; got 1763337600",
      plansUsage({ verb: "lapse" }),
    ]);
    expect(recording.homes).toStrictEqual([]);
    expect(recording.mutations).toStrictEqual([]);
  });

  it("refuses a missing --on with the usage line", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one"],
      verb: "lapse",
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recording.diagnostics).toStrictEqual(["--on is required", plansUsage({ verb: "lapse" })]);
    expect(recording.mutations).toStrictEqual([]);
  });

  it("records one set-lapse on the named row, the instant kept exactly as typed, in the requested home", async () => {
    const recording = fresh();
    const code = await runPlansVerb({
      deps: recordingDeps({ recording }),
      rest: ["--provider", "claude", "--plan", "plan-one", "--on", "2026-11-17T00:00:00+11:00", "--home", "/h"],
      verb: "lapse",
    });

    expect(code).toBe(EXIT_OK);
    expect(recording.mutations).toStrictEqual([
      { alias: "plan-one", kind: "set-lapse", lapsesAtIso: "2026-11-17T00:00:00+11:00", provider: "claude" },
    ]);
    expect(recording.homes).toStrictEqual(["/h"]);
    expect(recording.out).toStrictEqual([
      "plans: recorded that claude/plan-one's paid subscription lapses at 2026-11-17T00:00:00+11:00 — 1 destination(s) now registered",
    ]);
  });
});
