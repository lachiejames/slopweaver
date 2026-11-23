/**
 * `handover sign-off` and `handover amend` over a real temp board: each usage refusal paired with the near miss
 * that gets past it, so the exit code is shown to come from the flag under test. Every case stops before the
 * append, so no clock or cmux is reached, and the whole home is compared byte for byte.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  FINISH_OVERRIDE,
  runHandoverAmend,
  runHandoverSignOff,
} from "../../../../../cli/commands/handover/lifecycleRunVerbs.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../../../supervisor/session.js";
import {
  clearSessionEnv,
  journalEvents,
  lifecycleHome,
  restoreSessionEnv,
  STARTED,
  snapshotTree,
  verbArgv,
} from "./lifecycleRunFixture.js";

const SLUG = "verbs-run";
const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
  restoreSessionEnv();
});

describe("FINISH_OVERRIDE", () => {
  it("is the SLOPWEAVER_ALLOW_UNREVIEWED variable", () => {
    expect(FINISH_OVERRIDE).toBe("SLOPWEAVER_ALLOW_UNREVIEWED");
  });
});

describe("runHandoverSignOff", () => {
  it("answers 2 for a missing or blank --note, and 2 for a note with no --by outside a session", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });
    const run = async ({ flags }: { flags: readonly string[] }): Promise<number> =>
      runHandoverSignOff(verbArgv({ rest: [SLUG, "--home", home, ...flags], verb: "sign-off" }));

    const codes = [
      await run({ flags: [] }),
      await run({ flags: ["--note", "   "] }),
      await run({ flags: ["--note", "checked the diff"] }),
    ];

    expect(codes).toEqual([2, 2, 2]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });

  it("signs as --by when given, outside any session", async () => {
    clearSessionEnv();
    const { home, runsDir } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const code = await runHandoverSignOff(
      verbArgv({ rest: [SLUG, "--home", home, "--note", "checked the diff", "--by", "the owner"], verb: "sign-off" }),
    );
    expect(code).toBe(0);
    const signed = journalEvents({ runsDir, slug: SLUG }).at(-1)!;
    expect(signed.kind).toBe("signed-off");
    expect(signed).toMatchObject({ by: "the owner", note: "checked the diff" });
  });

  it("signs as the session this process runs in when --by is not given", async () => {
    clearSessionEnv();
    process.env[CLAUDE_CODE_SESSION_ID_ENV] = "5d1f7a52-1b51-4c55-9a1e-3f0e8c1d2b44";
    const { home, runsDir } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const code = await runHandoverSignOff(
      verbArgv({ rest: [SLUG, "--home", home, "--note", "checked the diff"], verb: "sign-off" }),
    );
    expect(code).toBe(0);
    expect(journalEvents({ runsDir, slug: SLUG }).at(-1)!).toMatchObject({
      by: "5d1f7a52-1b51-4c55-9a1e-3f0e8c1d2b44",
      kind: "signed-off",
    });
  });
});

describe("runHandoverAmend", () => {
  it("answers 2 without --why, and 1 with one on a run that is not open, writing nothing", async () => {
    clearSessionEnv();
    const abandoned: RunEvent = { atIso: "2026-10-01T09:10:00.000Z", kind: "abandoned", why: "gave up" };
    const { home } = lifecycleHome({ events: [STARTED, abandoned], homes, slug: SLUG });
    const before = snapshotTree({ root: home });

    const missing = await runHandoverAmend(verbArgv({ rest: [SLUG, "--home", home], verb: "amend" }));
    const closed = await runHandoverAmend(
      verbArgv({ rest: [SLUG, "--home", home, "--why", "the doc grew a probe"], verb: "amend" }),
    );

    expect([missing, closed]).toEqual([2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});
