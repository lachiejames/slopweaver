/**
 * `fireTurnSignedOut` — the one call `turn block` and `turn unblock` make so the "log into <host>" card and note
 * arrive with the block. Driven over a real ask log in a temp home through the REAL `monitor check` pass, with the
 * hand register's launcher and the work-Chrome opener as plain recording functions.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MonitorDeps } from "../../../../../cli/commands/monitor/deps.js";
import { fireTurnSignedOut } from "../../../../../cli/commands/turn/signInCard.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { handRegisterPath, readHandRows } from "../../../../../hand/store.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { appendAskLifecycleEvent } from "../../../../../live/ask/store.js";
import { signInSubjectKey } from "../../../../../monitor/resyncSignedOut.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryPlanHealthPorts } from "../../../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../../../processesFake.js";

const ADMIN = "https://admin.google.com";
const NOW = "2026-09-29T05:00:00.000Z";
const STEP = `mon-login-${signInSubjectKey({ origin: ADMIN })}`;
const IDENTITY = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

let home = "";
let opened: string[] = [];
let launches = 0;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sign-in-card-"));
  opened = [];
  launches = 0;
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Stamp every liveness file a raise wrote at {@link NOW}, so the note reads as started on the fake clock. */
function stampLiveAtNow(): void {
  const liveDir = join(stateHomePaths({ home }).handSteps, "live");
  if (!existsSync(liveDir)) {
    return;
  }
  for (const name of readdirSync(liveDir)) {
    utimesSync(join(liveDir, name), new Date(NOW), new Date(NOW));
  }
}

/** The monitor seams over {@link home}, recording each page opened and each note launched instead of doing either. */
function deps(): MonitorDeps {
  return {
    claudeProjectsDir: join(home, "claude-projects"),
    fleetCapPort: memoryCodexFleetCapPort(),
    orgHealthPort: memoryOrgHealthPort(),
    pagePublished: memoryPagesPublished(),
    registerPort: memoryPlanRegisterPort(),
    ...memoryPlanHealthPorts(),
    cmuxConfigPath: join(home, "cmux.json"),
    hand: {
      branchesDeclaring: () => [],
      consoleBase: () => "http://localhost:3000",
      lookAt: () => {
        throw new Error("the monitor lane posts through the store and looks at no page");
      },
      now: () => NOW,
      platform: "darwin",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: () => {
        launches += 1;
        stampLiveAtNow();
      },
      writeDiagnostic: () => undefined,
      writeOut: () => undefined,
    },
    now: () => NOW,
    openPage: async ({ url }) => {
      opened.push(url);
      return ok(url);
    },
    platform: "darwin",
    processes: NO_FSEVENTSD,
    writeDiagnostic: () => undefined,
    writeOut: () => undefined,
  };
}

/** Every step id the hand register holds a posted row for. */
function postedSteps(): readonly string[] {
  const { rows } = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) }));
  return rows.flatMap((row) => (row.kind === "posted" ? [row.step.id] : []));
}

describe("fireTurnSignedOut", () => {
  it("posts the one login card, opens the page in the owner's work Chrome and raises the note, exiting 0", async () => {
    appendAskLifecycleEvent({
      event: { ...IDENTITY, kind: "captured", surface: "channel", tsIso: "2026-09-29T04:10:00.000Z", userId: "U1" },
      home,
    });
    appendAskLifecycleEvent({
      event: {
        ...IDENTITY,
        kind: "blocked-on-human",
        need: "sign-in",
        signInOrigin: ADMIN,
        stepText: "Waiting on the owner: log into the Google Admin console",
        tsIso: "2026-09-29T04:19:00.000Z",
        what: "log into the Google Admin console",
      },
      home,
    });
    writeFileSync(stateHomePaths({ home }).chromePin, "#!/bin/sh\n");

    expect(await fireTurnSignedOut({ bySession: "turn block", deps: deps(), home, verb: "turn block" })).toBe(EXIT_OK);
    expect(postedSteps()).toEqual([STEP]);
    expect(opened).toEqual([ADMIN]);
    expect(launches).toBe(1);
  });

  it("posts nothing and opens nothing on a home with no blocked turn", async () => {
    expect(await fireTurnSignedOut({ bySession: "turn unblock", deps: deps(), home, verb: "turn unblock" })).toBe(
      EXIT_OK,
    );
    expect(postedSteps()).toEqual([]);
    expect(opened).toEqual([]);
  });
});
