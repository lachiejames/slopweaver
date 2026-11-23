/**
 * `fireSteerAtRiskIfSteered` — the call every risk writer (`handover risk|ask|park|abandon|reap|rule`, `session
 * close-done`) makes after writing. Driven over a real
 * journal in a temp home through the REAL `monitor check` pass, with the note launcher a recording function: an
 * unsteered row runs no pass at all, and a steered row parked on a clock posts its card at once — reporting on the
 * host verb's stderr, never its stdout.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireSteerAtRiskIfSteered } from "../../../../../cli/commands/handover/steerRiskCard.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { readOpenHandSteps } from "../../../../../hand/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { type RecordingMonitorDeps, recordingMonitorDeps } from "../../../../monitorDepsFixture.js";

const SLUG = "steered-row";
const SEAT = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-10-22T04:01:12.000Z";
const STARTED = { atIso: "2026-10-22T03:50:39.735Z", branch: SLUG, docHash: "6cebb758c21ec1c2", kind: "started" };
const LAUNCHED = {
  atIso: "2026-10-22T03:50:39.735Z",
  host: "claude-code",
  kind: "launched",
  pid: 1,
  sessionId: SEAT,
  worktree: "/redacted/worktree",
};
const RULING = {
  anchor: "transcript:redacted#their-turn",
  atIso: "2026-10-22T03:51:30.000Z",
  kind: "ruling",
  ruling: "overriding the previous guidance: post the next cut by 4pm",
};
const PARK = {
  atIso: "2026-10-22T04:01:11.997Z",
  branch: SLUG,
  kind: "parked",
  screenTail: "",
  sessionId: SEAT,
  wake: { atIso: "2026-10-22T04:50:00Z", kind: "at" },
  workspaceRef: "workspace:787",
  worktree: "/redacted/worktree",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "steer-card-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the row's document and its journal of `lines`. */
function world({ lines }: { lines: readonly Record<string, unknown>[] }): void {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.runs, { recursive: true });
  mkdirSync(paths.handovers, { recursive: true });
  writeFileSync(join(paths.runs, `${SLUG}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  writeFileSync(
    join(paths.handovers, `${SLUG}.md`),
    ["---", `slug: ${SLUG}`, "summary: a steered row", "status: ready", "---", ""].join("\n"),
  );
}

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

/** The monitor seams: every clock at {@link NOW}, both channels and the launcher recorded. */
function seams(): RecordingMonitorDeps {
  return recordingMonitorDeps({ nowIso: NOW, onLaunch: stampLiveAtNow });
}

/** The open steer cards on the hand register. */
function steerCards(): readonly string[] {
  return unwrap(readOpenHandSteps({ home }))
    .steps.map((step) => step.id)
    .filter((id) => id.startsWith("mon-steer-"));
}

describe("fireSteerAtRiskIfSteered", () => {
  it("runs no pass on a row whose standing ruling is not a steer", async () => {
    world({ lines: [STARTED, LAUNCHED, RULING, PARK] });
    const recorded = seams();
    const fired = await fireSteerAtRiskIfSteered({ deps: recorded.deps, home, slug: SLUG, verb: "handover park" });
    expect({ fired, launches: recorded.launches() }).toEqual({ fired: { kind: "not-steered" }, launches: 0 });
  });

  it("reports a journal line it cannot decode as unreadable rather than as no steer", async () => {
    world({ lines: [STARTED, LAUNCHED, RULING, PARK] });
    appendFileSync(join(stateHomePaths({ home }).runs, `${SLUG}.jsonl`), '{"kind":"ruling","explicitSteer":\n');
    const recorded = seams();
    const fired = await fireSteerAtRiskIfSteered({ deps: recorded.deps, home, slug: SLUG, verb: "handover risk" });
    expect(fired.kind).toBe("unreadable");
    expect(JSON.stringify(fired)).toContain("1 line(s) of steered-row's journal would not decode");
    expect(recorded.launches()).toBe(0);
  });

  it("reports a journal gone between the write and the reread as unreadable rather than as no steer", async () => {
    const recorded = seams();
    const fired = await fireSteerAtRiskIfSteered({ deps: recorded.deps, home, slug: SLUG, verb: "handover risk" });
    expect(fired.kind).toBe("unreadable");
    expect(JSON.stringify(fired)).toContain("steered-row's journal read back empty straight after a write");
    expect(recorded.launches()).toBe(0);
  });

  it("posts the card at once when a steered row parks on a clock", async () => {
    world({
      lines: [STARTED, LAUNCHED, { ...RULING, explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" } }, PARK],
    });
    const recorded = seams();
    const fired = await fireSteerAtRiskIfSteered({ deps: recorded.deps, home, slug: SLUG, verb: "handover park" });
    expect(fired).toEqual({ exitCode: EXIT_OK, kind: "fired" });
    expect(steerCards().length).toBe(1);
    expect(recorded.launches()).toBe(1);
  });

  it("reports the firing pass on the host verb's stderr and leaves its stdout empty", async () => {
    world({
      lines: [STARTED, LAUNCHED, { ...RULING, explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" } }, PARK],
    });
    const recorded = seams();
    await fireSteerAtRiskIfSteered({ deps: recorded.deps, home, slug: SLUG, verb: "session close-done" });
    expect(recorded.out).toEqual([]);
    expect(recorded.diagnostics).toContain("steer-at-risk  FIRING over 1");
  });
});
