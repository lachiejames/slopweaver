/**
 * `cmux spawn`'s one launch through the session harness seam: the spawn outcome comes back in cmux's own shapes, and
 * the recording launcher writes the session's `spawned` row under the home it was given. The act on that row is the
 * one the run journal reads AT DELIVERY: under cmux `open` and `resume` are one launch, so which method the
 * preflight's read called is not observable, and the row's act is the only place the choice lands.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { launchSpawnThroughSeam } from "../../../../../cli/commands/cmux/spawnLaunch.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { parseSessionLog } from "../../../../../sessions/session.js";
import { readSessionLogTextStrict } from "../../../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { fakeClient } from "../../../cmux/spawn/fakeClient.js";
import { deps, PLAN } from "../../../cmux/spawn/harness.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/**
 * Spawn `a-doc` through the seam under `home`, the preflight having read an empty journal.
 *
 * @returns the workspace the spawn opened, and the act and key of every row the ledger holds after it
 */
async function spawnUnder({ home }: { home: string }): Promise<{
  workspaceRef: string;
  rows: readonly { harness: string | undefined; kind: string; openedBy: string | undefined; sessionKey: string }[];
}> {
  const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
  const { deps: spawnDeps } = deps({ client });
  const outcome = await launchSpawnThroughSeam({
    deps: spawnDeps,
    doc: { path: "/handovers/a-doc.md", slug: "a-doc" },
    harness: "cmux",
    home,
    // A cmux spawn continues no app session: the plan carries none, and the journal alone picks the act.
    plan: { ...PLAN, continuingAppSessionId: undefined },
    runEvents: [],
  });
  const { events } = parseSessionLog({ text: readSessionLogTextStrict({ home }) });
  return {
    rows: events.map((event) => ({
      harness: event.kind === "spawned" ? event.harness : undefined,
      kind: event.kind,
      openedBy: event.kind === "spawned" ? event.openedBy : undefined,
      sessionKey: event.sessionKey,
    })),
    workspaceRef: unwrap(outcome).workspaceRef,
  };
}

describe("launchSpawnThroughSeam", () => {
  it("writes a first seat's one `spawned` row as `open`, through the cmux harness, when no run has started", async () => {
    const home = mkdtempSync(join(tmpdir(), "spawn-launch-"));
    homes.push(home);

    const spawned = await spawnUnder({ home });

    expect(spawned.workspaceRef).toBe("workspace:1");
    expect(spawned.rows).toEqual([{ harness: "cmux", kind: "spawned", openedBy: "open", sessionKey: "a-doc" }]);
  });

  it("writes `resume` when the run started after the preflight read, since the delivery re-read decides", async () => {
    const home = mkdtempSync(join(tmpdir(), "spawn-launch-"));
    homes.push(home);
    appendRunEvent({
      event: { atIso: "2026-10-01T00:00:00.000Z", branch: "a-branch", docHash: "abc123", kind: "started" },
      runsDir: stateHomePaths({ home }).runs,
      slug: "a-doc",
    });

    const spawned = await spawnUnder({ home });

    expect(spawned.workspaceRef).toBe("workspace:1");
    expect(spawned.rows).toEqual([{ harness: "cmux", kind: "spawned", openedBy: "resume", sessionKey: "a-doc" }]);
  });
});
