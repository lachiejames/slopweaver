/**
 * REPLAY LANE, SYNTHETIC — a hold on a deadline-steered run, re-run with the steer on the row. The owner's deadline
 * was hours away. The seat parked itself on a clock behind a door rule, and nothing told the owner: they found out
 * by reading the supervisor chat. A deadline at risk needs the owner told early, with the uncertainty named, by a
 * floating note and a voice cut-in (`docs/doctrine-rationale/explicit-steer.md`).
 *
 * **Why synthetic.** `turn freeze` freezes a Slack turn's record set, and this incident is a RUN journal. So the
 * stopped world is that journal's first five lines (`runs/sup-4293-next-cut-as-a-linear-document-in-rosa-s-shape.jsonl`
 * on the operator's home), redacted by hand to the fields the decoder reads — session ids synthetic, worktrees and
 * the screen tail dropped — plus the ONE line the mechanism adds: the chair's `handover rule --explicit-steer
 * --deliver-by <instant>`, which did not exist then. It is frozen THROUGH the park, the state the
 * real verbs must behave correctly over. Everything else is shipped: the `monitor check` verb body, the hand
 * register, the note raiser, and the tick close's rehearsal read and gate. The two seams faked are the two that
 * leave the process — the macOS launcher and Chrome — so no test here opens a window.
 *
 * **The falsifiable witnesses.** The fire is asserted on the hand register ON DISK, read back by the shipped reader,
 * and on the launcher being called; the gate's refusal is asserted before the note is up and its silence after. Two
 * mutations of the same world must fire nothing: the same journal with no steer on it, and with the park on CI
 * rather than a clock.
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
import { runMonitorCheck } from "../../../cli/commands/monitor/check.js";
import type { MonitorDeps } from "../../../cli/commands/monitor/deps.js";
import { readSteerRiskLive, steerRiskRefusal } from "../../../cli/commands/supervisor/steerRiskRead.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../hand/note/raise.js";
import { handRegisterPath, readOpenHandSteps } from "../../../hand/store.js";
import { err, unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { steerRiskNoticesOf } from "../../../talk/steerRisk.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

const SLUG = "sup-4293-next-cut-as-a-linear-document-in-rosa-s-shape";
const SEAT = "00000000-0000-4000-8000-000000000001";
const CHAIR = "00000000-0000-4000-8000-000000000002";
const PARKED_AT = "2026-10-22T04:01:11.997Z";

/** The first tick after the park: the instant the risk was knowable, fifty-nine minutes before the owner's deadline. */
const TICK = "2026-10-22T04:01:12.000Z";

/** The journal through the park, redacted, with the steer the chair would now record. */
const STARTED = { atIso: "2026-10-22T03:50:39.735Z", branch: SLUG, docHash: "6cebb758c21ec1c2", kind: "started" };
const LAUNCHED = {
  atIso: "2026-10-22T03:50:39.735Z",
  host: "claude-code",
  kind: "launched",
  pid: 1,
  sessionId: SEAT,
  worktree: "/redacted/worktree",
};
const DISPATCHED = { atIso: "2026-10-22T03:51:12.149Z", by: CHAIR, kind: "dispatched", target: "workspace:787" };
const STEER = {
  anchor: "transcript:redacted#owner-turn",
  atIso: "2026-10-22T03:51:30.000Z",
  decidedIso: "2026-10-22T03:42:00.000Z",
  explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" },
  kind: "ruling",
  ruling: "overriding the previous guidance: post the next cut on SUP-4293 by 4pm, raw if the verb is not there",
};
const AMENDED = {
  atIso: "2026-10-22T04:00:49.144Z",
  docHash: "4cfce6af9e45ca79",
  kind: "amended",
  why: "drafted the body; blocked on the linear document verb row before writing to Linear",
};
const CLOCK_PARK = {
  atIso: PARKED_AT,
  branch: SLUG,
  kind: "parked",
  screenTail: "",
  sessionId: SEAT,
  wake: { atIso: "2026-10-22T04:50:00Z", kind: "at" },
  workspaceRef: "workspace:787",
  worktree: "/redacted/worktree",
};

let home: string;
let launched: NoteCommand[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-replay-steer-"));
  launched = [];
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Materialise the stopped world: the row's document and its journal of `lines`, under `slug`. */
function world({ lines, slug = SLUG }: { lines: readonly Record<string, unknown>[]; slug?: string }): void {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.runs, { recursive: true });
  mkdirSync(paths.handovers, { recursive: true });
  writeFileSync(join(paths.runs, `${slug}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  writeFileSync(
    join(paths.handovers, `${slug}.md`),
    ["---", `slug: ${slug}`, "summary: SUP-4293 next cut as a Linear document", "status: ready", "---", ""].join("\n"),
  );
}

/**
 * Stand in for the wall clock the raise's liveness files were written on: every one is stamped at the tick, so each
 * note raised reads as still starting — notes stack, and none displaces another.
 */
function stampLiveAtTick(): void {
  const liveDir = join(stateHomePaths({ home }).handSteps, "live");
  if (!existsSync(liveDir)) {
    return;
  }
  for (const name of readdirSync(liveDir)) {
    utimesSync(join(liveDir, name), new Date(TICK), new Date(TICK));
  }
}

/** The verb's seams: every clock at the tick, the launcher recorded, Chrome refused. */
function deps(): MonitorDeps {
  const quiet = (): void => undefined;
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
      now: () => TICK,
      platform: "darwin",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: (command) => {
        launched.push(command);
        stampLiveAtTick();
      },
      writeDiagnostic: quiet,
      writeOut: quiet,
    },
    now: () => TICK,
    openPage: async ({ url }) => err(`no page opens in a replay: ${url}`),
    platform: "darwin",
    processes: NO_FSEVENTSD,
    writeDiagnostic: quiet,
    writeOut: quiet,
  };
}

/** The tick's own fire of `steer-at-risk`, exactly as `fleetReadings.ts` runs it. */
function fire(): Promise<number> {
  return runMonitorCheck({
    deps: deps(),
    rest: ["--home", home, "--only", "steer-at-risk", "--fire", "--by-session", "supervisor", "--now", TICK],
  });
}

/** The open steer cards on the hand register, read back by the shipped reader. */
function steerCards(): readonly string[] {
  return unwrap(readOpenHandSteps({ home }))
    .steps.map((step) => step.id)
    .filter((id) => id.startsWith("mon-steer-"));
}

/** The tick close's steer-risk gate over this home, with the hatch shut. */
async function gate(): Promise<readonly (readonly string[])[]> {
  return steerRiskRefusal({
    hatchIsOpen: () => false,
    read: await readSteerRiskLive({ home, noteClock: () => TICK, nowIso: TICK }),
  });
}

describe("the SUP-4293 hold, with the owner's steer on the row", () => {
  it("refuses a tick close that read the risk and left the note down", async () => {
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK] });
    const refused = await gate();
    expect(refused.length).toBe(1);
    expect(refused[0]!.join("\n")).toContain("its seat closed until 2026-10-22T04:50:00Z, so nobody is working it");
  });

  it("raises one floating note at the first tick after the park, and the gate then lets the close through", async () => {
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK] });
    expect(await fire()).toBe(EXIT_OK);
    const cards = steerCards();
    expect(cards.length).toBe(1);
    expect(cards[0]).toMatch(/^mon-steer-sup-4293-/);
    expect(launched.length).toBe(1);
    expect(await gate()).toEqual([]);
  });

  // The half the register cannot see: a seat still RUNNING that knows it is in trouble names it with `handover risk`.
  it("raises a note for a risk the running seat named, and settles it once the seat clears it", async () => {
    const named = { atIso: "2026-10-22T04:00:50.000Z", kind: "steer-risk", standing: "at-risk", why: "no Linear verb" };
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, named] });
    expect(await fire()).toBe(EXIT_OK);
    const raised = steerCards();
    const cleared = { ...named, atIso: "2026-10-22T04:01:00.000Z", standing: "cleared", why: "posted it raw" };
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, named, cleared] });
    expect(await fire()).toBe(EXIT_OK);
    expect({ after: steerCards(), raised: raised.length }).toEqual({ after: [], raised: 1 });
  });

  // Notes stack, so two rows at risk are two notes up at once, and each is owed.
  it("lets the close through with two steered rows at risk once both notes are up, stacked", async () => {
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK] });
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK], slug: "sup-4294-second-steered-row" });
    expect((await gate()).length).toBe(1);
    expect(await fire()).toBe(EXIT_OK);
    expect({ cards: steerCards().length, gate: await gate(), launched: launched.length }).toEqual({
      cards: 2,
      gate: [],
      launched: 2,
    });
  });

  // The falsifying half: a note that went down without the owner's press is owed again, another row's note up or not.
  it("refuses the close with two steered rows at risk when one of the two notes is gone", async () => {
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK] });
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK], slug: "sup-4294-second-steered-row" });
    expect(await fire()).toBe(EXIT_OK);
    const liveDir = join(stateHomePaths({ home }).handSteps, "live");
    const firstWant = readdirSync(liveDir).find((name) => name.endsWith(".want"))!;
    utimesSync(join(liveDir, firstWant), new Date(0), new Date(0));
    expect((await gate()).length).toBe(1);
  });

  // A register line that will not read may be this row's own card, so a close over it never saw the set.
  it("refuses the close once the note is up if a hand-register line will not read", async () => {
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, CLOCK_PARK] });
    expect(await fire()).toBe(EXIT_OK);
    expect(await gate()).toEqual([]);
    appendFileSync(handRegisterPath({ home }), "{ not a register line\n");
    const refused = await gate();
    expect(refused.length).toBe(1);
    expect(refused[0]!.join("\n")).toContain("1 hand-register line(s) would not read");
  });

  it("fires nothing over the same journal with no steer on it", async () => {
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, AMENDED, CLOCK_PARK] });
    expect(await fire()).toBe(EXIT_OK);
    expect({ cards: steerCards(), gate: await gate(), launched: launched.length }).toEqual({
      cards: [],
      gate: [],
      launched: 0,
    });
  });

  // The vulnfix top-up: a note once read "nothing waits on you — it is stopped on a question to
  // you", and the voice said "The fleet's still on it". The note on the register, and the line the voice reads off it.
  it("raises a note on the owner's question that says it waits on them and names the Queue, as the voice reads it too", async () => {
    const question =
      "acme-admin#19364 needs one approver in both team-a and team-b: A name one, B withhold, C skip it?";
    const asked = { atIso: "2026-10-22T04:00:55.000Z", kind: "question", question };
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, asked] });
    expect(await fire()).toBe(EXIT_OK);
    const steps = unwrap(readOpenHandSteps({ home })).steps.filter((step) => step.id.startsWith("mon-steer-"));
    const voice = steerRiskNoticesOf({ answered: new Set(), stepIds: new Set(steps.map((step) => step.id)), steps });
    expect({
      launched: launched.length,
      note: steps.map((step) => [step.notice, step.url, step.unblocks, step.unaddressed]),
      voice: voice.notices.map((notice) => notice.why),
    }).toEqual({
      launched: 1,
      note: [
        [
          true,
          undefined,
          `waiting on you: ${question} — answer it on your Queue`,
          "waiting on you — answer the question on your Queue",
        ],
      ],
      voice: [`waiting on you: ${question} — answer it on your Queue`],
    });
  });

  it("fires nothing when the seat parked on its own CI rather than a clock, since that is work in motion", async () => {
    const onChecks = { ...CLOCK_PARK, wake: { kind: "checks", number: 2602, repo: "lachiejames/slopweaver" } };
    world({ lines: [STARTED, LAUNCHED, DISPATCHED, STEER, AMENDED, onChecks] });
    expect(await fire()).toBe(EXIT_OK);
    expect({ cards: steerCards(), gate: await gate(), launched: launched.length }).toEqual({
      cards: [],
      gate: [],
      launched: 0,
    });
  });
});
