/*
 * `turn answer --dispatch` and the dispatch generation: a durable record left over from a PRIOR re-dispatch of the
 * same ask is refused before cmux is ever touched.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnAnswer } from "../../../../../../cli/commands/turn/run.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { askIdentityOf } from "../../../../../../live/ask/identity.js";
import { appendAskLifecycleEvent, ensureCapturedAskLifecycle } from "../../../../../../live/ask/store.js";
import { dispatchIdOf } from "../../../../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../../../../live/turn/dispatchStore.js";
import { DECISION, FULL_BRIEF, fixtureDirs, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/**
 * `turn answer --dispatch <id>` reads its decision from the DURABLE dispatch record, never a `--decision`
 * flag — but that record itself can be left over from a PRIOR re-dispatch generation of the same ask (a
 * lease-expired fresh-visible-session, re-judged and re-dispatched under a different decision). This must
 * refuse before ever touching cmux, the same as `turn dispatch --poll`/`--sweep` already do.
 */
describe("turn answer — --dispatch mode generation binding", () => {
  it("refuses (never touching cmux) when the durable record belongs to a PRIOR dispatch generation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-turn-answer-dispatch-generation-"));
    fixtureDirs.push(dir);
    // A realistic (not toy) timestamp — the dispatch record's own askPermalink must round-trip through the
    // real Slack-permalink parser, which refuses anything shorter than a genuine Slack ts.
    const brief = {
      ...FULL_BRIEF,
      messageTs: "1785000000.000100",
      threadTs: "1785000000.000100",
      userId: "U0OWNER",
    };
    const briefPath = join(dir, "brief.json");
    writeFileSync(briefPath, JSON.stringify(brief), "utf8");

    const askIdentity = askIdentityOf({ source: brief });
    const dispatchId = dispatchIdOf({ askIdentity });
    ensureCapturedAskLifecycle({ askIdentity, home: dir, surface: "channel", userId: "U0OWNER" });
    // The CURRENT generation's lease — what a live re-dispatch would have just appended.
    appendAskLifecycleEvent({
      event: {
        ...askIdentity,
        decision: DECISION,
        kind: "dispatched",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        tier: "fresh-visible-session",
        tsIso: "2026-08-13T00:00:00.000Z",
      },
      home: dir,
    });
    // A STALE record left over from a PRIOR generation — a different lease, an unreachable fake locator.
    writeDispatchRecord({
      home: dir,
      record: {
        ...askIdentity,
        askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
        briefPath,
        decision: DECISION,
        dispatchId,
        execution: { mode: "single-turn", supervisorHost: "claude-code" },
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
        schemaVersion: 3,
        session: {
          host: "claude-code",
          surfaceId: "id-prior-generation-surface",
          surfaceRef: "prior-generation-surface",
          workspaceId: "id-prior-generation-workspace",
          workspaceRef: "prior-generation-workspace",
        },
      },
    });

    const code = await runTurnAnswer(["node", "slopweaver", "turn", "answer", "--dispatch", dispatchId, "--home", dir]);

    expect(code).toBe(EXIT_ERROR);
  });
});
