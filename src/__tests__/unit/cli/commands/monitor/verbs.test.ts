import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvedHomeOf } from "../../../../../cli/commands/hand/deps.js";
import { runMonitorCheck } from "../../../../../cli/commands/monitor/check.js";
import { bySession, type MonitorDeps } from "../../../../../cli/commands/monitor/deps.js";
import { hookScriptPath, runMonitorFilter } from "../../../../../cli/commands/monitor/filter.js";
import { runMonitorList } from "../../../../../cli/commands/monitor/list.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../hand/note/raise.js";
import { appendHandRow } from "../../../../../hand/store.js";
import { slopweaverHome } from "../../../../../homeDir.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { appendRepairTake } from "../../../../../live/automation/repairTake.js";
import { RECIPE_STEERS } from "../../../../../live/automation/steers.js";
import { meetingPrepKey } from "../../../../../monitor/meetingPrepDue.js";
import { MONITORS } from "../../../../../monitor/registry.js";
import type { MeetingTag } from "../../../../../pages/meetingTag.js";
import { appendMeetingTag } from "../../../../../pages/meetingTagStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { supervisorTickStatsOf } from "../../../../../supervisor/tickSchema.js";
import { supervisorTickLedgerPath, supervisorTickLine } from "../../../../../supervisor/tickStore.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorJudgement,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../../../supervisor/tickTypes.js";
import { memoryPlanHealthPorts } from "../../../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../../../orgHealthStoreFixture.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../../../processesFake.js";
import { dailyRow, stampRecipeRuns, writeRecipeDefinitions } from "../../../live/automation/recipeHome.js";

const NOW = "2026-09-19T06:00:00.000Z";

let home = "";
let cmuxConfigPath = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
/** The pages the fake store holds — what `page publish` would have put there in this test. */
let publishedSlugs: string[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "monverb-"));
  cmuxConfigPath = join(home, "cmux.json");
  out = [];
  diagnostics = [];
  commands = [];
  publishedSlugs = [];
});

/**
 * Stamp every liveness file a raise wrote as written at {@link NOW}. The note protocol judges a note still
 * starting by comparing a file's time against the hand clock; the verbs never read the wall clock, so the fake
 * launcher stands in for it — exactly the stand-in `unit/cli/commands/hand/verbs/harness.ts` gives.
 */
function stampLiveAtNow(): void {
  const liveDir = join(stateHomePaths({ home }).handSteps, "live");
  if (!existsSync(liveDir)) {
    return;
  }
  for (const name of readdirSync(liveDir)) {
    utimesSync(join(liveDir, name), new Date(NOW), new Date(NOW));
  }
}

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The seams, with both output channels recorded instead of written, and the console at `consoleBase`. */
function deps({ consoleBase = "http://localhost:3000" }: { consoleBase?: string } = {}): MonitorDeps {
  return {
    claudeProjectsDir: join(home, "claude-projects"),
    fleetCapPort: memoryCodexFleetCapPort(),
    orgHealthPort: memoryOrgHealthPort(),
    pagePublished: async ({ slug }) => ok(publishedSlugs.includes(slug)),
    registerPort: memoryPlanRegisterPort(),
    ...memoryPlanHealthPorts(),
    processes: NO_FSEVENTSD,
    cmuxConfigPath,
    hand: {
      branchesDeclaring: () => [],
      consoleBase: () => consoleBase,
      lookAt: () => {
        throw new Error("the monitor lane posts through the store and looks at no page");
      },
      now: () => NOW,
      platform: "darwin",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: (command) => {
        commands.push(command);
        stampLiveAtNow();
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    now: () => NOW,
    // No card these verb tests post carries a page to open, so an open reaching here is a failure.
    openPage: async ({ url }) => err(`no page opens in a verb test: ${url}`),
    platform: "darwin",
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
}

/** The only argv every verb here needs: point it at this test's own home. */
function atHome({ tail = [] }: { tail?: readonly string[] } = {}): readonly string[] {
  return ["--home", home, ...tail];
}

describe("runMonitorList", () => {
  it("prints one JSON row per declared monitor and opens no file", () => {
    expect(runMonitorList({ deps: deps(), rest: atHome({ tail: ["--json"] }) })).toBe(EXIT_OK);
    expect(out.map((line) => JSON.parse(line).id)).toEqual(MONITORS.map((monitor) => monitor.id));
  });

  it("names the source and the clearing condition in the human report", () => {
    runMonitorList({ deps: deps(), rest: atHome() });
    expect(out).toContain("    clears when the next heartbeat reports the socket connected");
  });

  it("names each monitor's delivery, so the notice that asks nothing is told apart from a card", () => {
    runMonitorList({ deps: deps(), rest: atHome({ tail: ["--json"] }) });
    const delivers = new Map(out.map((line) => [JSON.parse(line).id, JSON.parse(line).delivers]));
    expect([delivers.get("recipe-repairing"), delivers.get("recipe-stopped"), delivers.get("prs-backed-up")]).toEqual([
      "a floating note that asks nothing — on no queue",
      "a card that floats its own note under --fire",
      "a card, announced by --push",
    ]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(runMonitorList({ deps: deps(), rest: ["--nope"] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("--nope");
  });
});

describe("runMonitorCheck", () => {
  it("reports every reading, including the clear ones, over an empty home", async () => {
    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--json", "--now", NOW] }) })).toBe(EXIT_OK);
    const report = JSON.parse(out[0]!);
    expect(report.readings.map((reading: { monitorId: string }) => reading.monitorId)).toEqual(
      MONITORS.map((monitor) => monitor.id),
    );
  });

  it("writes nothing into the register without --fire", async () => {
    await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--json", "--now", NOW] }) });
    expect(existsSync(join(home, "hand-steps"))).toBe(false);
  });

  it("runs only the monitor --only names", async () => {
    expect(
      await runMonitorCheck({
        deps: deps(),
        rest: atHome({ tail: ["--json", "--only", "fleet-runs-dry", "--now", NOW] }),
      }),
    ).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).readings.map((reading: { monitorId: string }) => reading.monitorId)).toEqual([
      "fleet-runs-dry",
    ]);
  });

  it("refuses an --only naming no declared monitor, before reading anything", async () => {
    expect(
      await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--only", "fleet-runs-wet", "--now", NOW] }) }),
    ).toBe(EXIT_USAGE);
    expect(diagnostics).toEqual([
      "monitor check: --only fleet-runs-wet is no declared monitor — `slopweaver monitor list` names them",
    ]);
  });

  it("refuses an instant it cannot parse rather than judging at the wall clock", async () => {
    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--now", "yesterday"] }) })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("yesterday");
  });

  it("posts the cards that ARRIVED when fired, and nothing on the second pass", async () => {
    const argv = atHome({ tail: ["--json", "--fire", "--now", NOW, "--by-session", "workspace:29"] });
    expect(await runMonitorCheck({ deps: deps(), rest: argv })).toBe(EXIT_OK);
    const first = JSON.parse(out[0]!).actions.filter((action: { kind: string }) => action.kind === "posted");
    expect(first.length).toBeGreaterThan(0);
    out = [];
    await runMonitorCheck({ deps: deps(), rest: argv });
    expect(JSON.parse(out[0]!).actions.filter((action: { kind: string }) => action.kind === "posted")).toEqual([]);
  });
});

describe("runMonitorCheck — the owner's Done lands before a fired pass judges", () => {
  /* Publish a page and tag it to a meeting starting at `startIso`, as `page publish` then `page tag` leave the home. */
  function taggedMeeting({ slug, startIso }: { slug: string; startIso: string }): string {
    publishedSlugs.push(slug);
    const tag: MeetingTag = {
      calendarId: "primary",
      eventId: `${slug}_event`,
      schemaVersion: 1,
      slug,
      startIso,
      startWall: startIso.slice(11, 16),
      summary: slug,
      taggedIso: "2026-09-18T00:00:00.000Z",
    };
    unwrap(appendMeetingTag({ home, tag }));
    return `mon-prep-${meetingPrepKey({ tag })}`;
  }

  /* One fired pass of meeting-prep-due alone at `nowIso`, returning the ids it posted. */
  async function postedAt({ nowIso }: { nowIso: string }): Promise<readonly string[]> {
    out = [];
    const argv = atHome({ tail: ["--json", "--fire", "--only", "meeting-prep-due", "--now", nowIso] });
    expect(await runMonitorCheck({ deps: deps(), rest: argv })).toBe(EXIT_OK);
    return JSON.parse(out[0]!)
      .actions.filter((action: { kind: string }) => action.kind === "posted")
      .map((action: { stepId: string }) => action.stepId);
  }

  it("keeps the card the owner closed closed when a sooner meeting falls due before any hand verb ran", async () => {
    const later = taggedMeeting({ slug: "later", startIso: "2026-09-19T06:30:00.000Z" });
    expect(await postedAt({ nowIso: NOW })).toEqual([later]);
    const dismissDir = stateHomePaths({ home }).handNoteDismiss;
    mkdirSync(dismissDir, { recursive: true });
    writeFileSync(join(dismissDir, `${later}.done`), `${NOW}\n`);
    const sooner = taggedMeeting({ slug: "sooner", startIso: "2026-09-19T06:15:00.000Z" });
    expect(await postedAt({ nowIso: "2026-09-19T06:05:00.000Z" })).toEqual([sooner]);
    expect(await postedAt({ nowIso: "2026-09-19T06:16:00.000Z" })).toEqual([]);
  });

  it("keeps it closed when the owner's Done is stamped in the same millisecond the sooner card goes up", async () => {
    const later = taggedMeeting({ slug: "later", startIso: "2026-09-19T06:30:00.000Z" });
    expect(await postedAt({ nowIso: "2026-09-19T05:45:00.000Z" })).toEqual([later]);
    const dismissDir = stateHomePaths({ home }).handNoteDismiss;
    mkdirSync(dismissDir, { recursive: true });
    writeFileSync(join(dismissDir, `${later}.done`), `${NOW}\n`);
    const sooner = taggedMeeting({ slug: "sooner", startIso: "2026-09-19T06:15:00.000Z" });
    // The hand clock reads NOW too, so the reconcile's Done and the sooner posting share one instant.
    expect(await postedAt({ nowIso: NOW })).toEqual([sooner]);
    expect(await postedAt({ nowIso: "2026-09-19T06:16:00.000Z" })).toEqual([]);
  });

  it("holds the owner's Later like their Done when a sooner meeting moves the card off and then starts", async () => {
    const later = taggedMeeting({ slug: "later", startIso: "2026-09-19T06:30:00.000Z" });
    expect(await postedAt({ nowIso: "2026-09-19T05:45:00.000Z" })).toEqual([later]);
    const dismissDir = stateHomePaths({ home }).handNoteDismiss;
    mkdirSync(dismissDir, { recursive: true });
    writeFileSync(join(dismissDir, `${later}.later`), `${NOW}\n`);
    const sooner = taggedMeeting({ slug: "sooner", startIso: "2026-09-19T06:15:00.000Z" });
    expect(await postedAt({ nowIso: "2026-09-19T06:05:00.000Z" })).toEqual([sooner]);
    expect(await postedAt({ nowIso: "2026-09-19T06:16:00.000Z" })).toEqual([]);
  });

  it("holds the owner's Done on a card that came back, even stamped before the pass moved its first card off", async () => {
    const later = taggedMeeting({ slug: "later", startIso: "2026-09-19T06:30:00.000Z" });
    expect(await postedAt({ nowIso: "2026-09-19T05:45:00.000Z" })).toEqual([later]);
    const sooner = taggedMeeting({ slug: "sooner", startIso: "2026-09-19T06:15:00.000Z" });
    expect(await postedAt({ nowIso: "2026-09-19T06:05:00.000Z" })).toEqual([sooner]);
    expect(await postedAt({ nowIso: "2026-09-19T06:16:00.000Z" })).toEqual([`${later}.2`]);
    const dismissDir = stateHomePaths({ home }).handNoteDismiss;
    mkdirSync(dismissDir, { recursive: true });
    // The hand clock reads NOW, 06:00, so the owner's Done carries an instant before the 06:05 departure.
    writeFileSync(join(dismissDir, `${later}.2.done`), `${NOW}\n`);
    expect(await postedAt({ nowIso: "2026-09-19T06:17:00.000Z" })).toEqual([]);
  });
});

describe("runMonitorCheck — a meeting note gone without the owner's press comes back", () => {
  /* A tagged meeting at 06:30 whose card the 05:45 pass posted, its note drawn once. */
  async function postedMeeting(): Promise<string> {
    publishedSlugs.push("later");
    const tag: MeetingTag = {
      calendarId: "primary",
      eventId: "later_event",
      schemaVersion: 1,
      slug: "later",
      startIso: "2026-09-19T06:30:00.000Z",
      startWall: "06:30",
      summary: "later",
      taggedIso: "2026-09-18T00:00:00.000Z",
    };
    unwrap(appendMeetingTag({ home, tag }));
    const argv = atHome({ tail: ["--fire", "--only", "meeting-prep-due", "--now", "2026-09-19T05:45:00.000Z"] });
    expect(await runMonitorCheck({ deps: deps(), rest: argv })).toBe(EXIT_OK);
    return `mon-prep-${meetingPrepKey({ tag })}`;
  }

  /*
   * One fired pass at 05:50, returning each `noted` action's step id. No panel runs here, so a note drawn at the hand
   * clock reads gone once its 30-second startup window has passed: this pass's hand clock reads a minute on.
   */
  async function notedAt({ platform = "darwin" }: { platform?: string } = {}): Promise<readonly string[]> {
    out = [];
    commands = [];
    const minuteOn = deps();
    const later = { ...minuteOn, hand: { ...minuteOn.hand, now: () => "2026-09-19T06:01:00.000Z", platform } };
    const argv = atHome({
      tail: ["--json", "--fire", "--only", "meeting-prep-due", "--now", "2026-09-19T05:50:00.000Z"],
    });
    expect(await runMonitorCheck({ deps: later, rest: argv })).toBe(EXIT_OK);
    return JSON.parse(out[0]!)
      .actions.filter((action: { kind: string }) => action.kind === "noted")
      .map((action: { stepId: string }) => action.stepId);
  }

  it("raises the open card's note again on the next fired pass, at the meeting-prep level", async () => {
    const card = await postedMeeting();
    expect(await notedAt()).toEqual([card]);
    const opened = commands.filter((command) => command.file === "open");
    expect(opened.length).toBe(1);
    const panel = readFileSync(join(opened[0]!.args[2]!, "Contents", "Resources", "panel.js"), "utf8");
    expect(panel.split("\n")[0]).toContain('"cascadeFromLeft":true');
    expect(panel.split("\n")[0]).toContain('"levelOffset":1');
  });

  it("holds the owner's Later on every later pass, though an earlier check in the tick consumed its marker", async () => {
    const card = await postedMeeting();
    const dismissDir = stateHomePaths({ home }).handNoteDismiss;
    mkdirSync(dismissDir, { recursive: true });
    writeFileSync(join(dismissDir, `${card}.later`), `${NOW}\n`);
    const first = atHome({ tail: ["--fire", "--only", "fleet-runs-dry", "--now", "2026-09-19T05:50:00.000Z"] });
    expect(await runMonitorCheck({ deps: deps(), rest: first })).toBe(EXIT_OK);
    expect(existsSync(join(dismissDir, `${card}.later`))).toBe(false);
    expect(await notedAt()).toEqual([]);
    expect(await notedAt()).toEqual([]);
    expect(commands).toEqual([]);
  });

  it("raises nothing off macOS, where there is no note to have lost", async () => {
    await postedMeeting();
    expect(await notedAt({ platform: "linux" })).toEqual([]);
  });

  it("raises nothing on a rehearsal", async () => {
    await postedMeeting();
    out = [];
    commands = [];
    const argv = atHome({ tail: ["--json", "--only", "meeting-prep-due", "--now", "2026-09-19T05:50:00.000Z"] });
    expect(await runMonitorCheck({ deps: deps(), rest: argv })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).actions).toEqual([]);
    expect(commands).toEqual([]);
  });
});

describe("runMonitorCheck — recipe-stopped reaches the owner's screen", () => {
  /** Two daily rows whose slots have gone by unrun since this watermark. */
  const STALE = "2026-09-15T09:30:00.000Z";

  beforeEach(() => {
    writeRecipeDefinitions({ home, rows: [dailyRow(), dailyRow({ recipeId: "resync-atlas-datadog" })] });
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": STALE, "vulnfix-digest-acme-admin": STALE } });
  });

  /** The `open` launches — each one is a floating note drawn. */
  function notesDrawn(): readonly NoteCommand[] {
    return commands.filter((command) => command.file === "open");
  }

  /** The recipe-stopped actions one `--json` pass reported. */
  function recipeActions(): readonly { kind: string; detail: string }[] {
    return JSON.parse(out[0]!).actions.filter((action: { monitorId: string }) => action.monitorId === "recipe-stopped");
  }

  it("--fire floats ONE note for the stopped set's one card, however many rows stopped", async () => {
    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--json", "--fire", "--now", NOW] }) })).toBe(
      EXIT_OK,
    );
    expect(notesDrawn().length).toBe(1);
    expect(
      recipeActions()
        .filter((action) => action.kind === "noted")
        .map((action) => action.detail),
    ).toEqual(["floating, top right in the cascade (slot 0)"]);
  });

  it("gives each posted card its own queue link, on whatever console base the install configured", async () => {
    const configured = deps({ consoleBase: "https://console.example.org" });
    expect(await runMonitorCheck({ deps: configured, rest: atHome({ tail: ["--fire", "--now", NOW] }) })).toBe(EXIT_OK);
    const posted = readFileSync(join(stateHomePaths({ home }).handSteps, "steps.jsonl"), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((row: { kind: string }) => row.kind === "posted")
      .map((row: { step: { id: string; url: string } }) => row.step);
    expect(posted.length).toBeGreaterThan(0);
    expect(
      posted.filter(
        (step: { id: string; url: string }) =>
          !step.url.startsWith(`https://console.example.org/queue?open=hand%3A${encodeURIComponent(step.id)}`),
      ),
    ).toEqual([]);
  });

  it("a rehearsal raises nothing and writes nothing", async () => {
    await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--json", "--now", NOW] }) });
    expect(commands).toEqual([]);
    expect(existsSync(join(home, "hand-steps"))).toBe(false);
  });

  it("--push banners once and does not draw a second panel for the note the pass already raised", async () => {
    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--json", "--push", "--now", NOW] }) })).toBe(
      EXIT_OK,
    );
    expect(notesDrawn().length).toBe(1);
    expect(commands.filter((command) => command.file === "osascript").length).toBe(1);
  });
});

describe("runMonitorCheck — a stop the owner already chose for", () => {
  it("prints a stopped corpus resync as on the corpus card and writes no recipe card for it", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow({ kind: "resync", recipeId: "resync-corpus-github" })] });
    stampRecipeRuns({ home, stamps: { "resync-corpus-github": "2026-09-15T09:30:00.000Z" } });

    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--fire", "--now", NOW] }) })).toBe(EXIT_OK);

    expect(out.slice(0, 3)).toEqual([
      "automation-held-on-you  clear",
      "recipe-stopped  STEERED — nothing to ask the owner",
      "    1 stopped, each a corpus resync — each is on the corpus-sync-stopped card",
    ]);
    const steps = readFileSync(join(home, "hand-steps", "steps.jsonl"), "utf8");
    expect(steps).not.toContain("mon-recipe-");
    expect(steps).toContain("mon-corpus-");
  });

  it("posts the recipe card for a stopped row a recorded steer covers — a steer never silences a stop", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow({ kind: "resync", recipeId: "resync-atlas-datadog" })] });
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": "2026-09-15T09:30:00.000Z" } });

    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--fire", "--now", NOW] }) })).toBe(EXIT_OK);

    expect(RECIPE_STEERS.map((steer) => steer.id)).toEqual(["resync-restart"]);
    expect(out.slice(0, 2)).toEqual(["automation-held-on-you  clear", "recipe-stopped  FIRING over 1"]);
    expect(readFileSync(join(home, "hand-steps", "steps.jsonl"), "utf8")).toContain("mon-recipe-resync-atlas-datadog");
  });

  it("prints a stop a seat has taken as taken, never as the owner's steer, and floats the note naming the seat", async () => {
    const paths = stateHomePaths({ home });
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": "2026-09-15T09:30:00.000Z" } });
    mkdirSync(paths.handovers, { recursive: true });
    mkdirSync(paths.runs, { recursive: true });
    writeFileSync(join(paths.handovers, "fix-the-digest.md"), "---\nslug: fix-the-digest\nstatus: ready\n---\n# fix\n");
    writeFileSync(
      join(paths.runs, "fix-the-digest.jsonl"),
      `${JSON.stringify({ atIso: NOW, branch: "b", docHash: "h", kind: "started" })}\n`,
    );
    unwrap(
      appendRepairTake({ home, take: { recipeId: "vulnfix-digest-acme-admin", row: "fix-the-digest", takenIso: NOW } }),
    );

    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--fire", "--now", NOW] }) })).toBe(EXIT_OK);

    expect(out.slice(0, 5)).toEqual([
      "automation-held-on-you  clear",
      "recipe-stopped  STEERED — nothing to ask the owner",
      "    1 stopped, each taken by a seat — a seat is repairing it, named on the recipe-repairing note",
      "recipe-repairing  FIRING over 1",
      "    vulnfix-digest-acme-admin — vulnfix-digest-acme-admin → seat fix-the-digest",
    ]);
    expect(commands.filter((command) => command.file === "open").length).toBe(1);
  });

  it("prints a stop the supervisor recorded a hold on as held, and writes no recipe card for it", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": "2026-09-15T09:30:00.000Z" } });
    const ledger = supervisorTickLedgerPath({ home });
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(ledger, `${supervisorTickLine({ row: heldTick({ recipeId: "vulnfix-digest-acme-admin" }) })}\n`);

    expect(
      await runMonitorCheck({
        deps: deps(),
        rest: atHome({ tail: ["--fire", "--only", "recipe-stopped", "--now", NOW] }),
      }),
    ).toBe(EXIT_OK);

    expect(out.slice(0, 2)).toEqual([
      "recipe-stopped  STEERED — nothing to ask the owner",
      "    1 stopped, each held by the supervisor — the supervisor holds it, its reason on the Automations page",
    ]);
    expect(existsSync(join(home, "hand-steps", "steps.jsonl"))).toBe(false);
    expect(commands).toEqual([]);
  });

  it("holds a stopped set the owner pressed Done on at the next tick, rather than posting it again", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": "2026-09-15T09:30:00.000Z" } });
    const tick = atHome({ tail: ["--fire", "--only", "recipe-stopped", "--now", NOW] });
    expect(await runMonitorCheck({ deps: deps(), rest: tick })).toBe(EXIT_OK);
    const register = join(stateHomePaths({ home }).handSteps, "steps.jsonl");
    const postedIds = (): readonly string[] =>
      readFileSync(register, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((row: { kind: string }) => row.kind === "posted")
        .map((row: { step: { id: string } }) => row.step.id);
    const [card] = postedIds();
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "owner", did: "Done — read it", id: card!, kind: "settled", settledIso: NOW },
      }),
    );
    out = [];

    expect(await runMonitorCheck({ deps: deps(), rest: tick })).toBe(EXIT_OK);

    expect(postedIds()).toEqual([card]);
    expect(out.slice(0, 2)).toEqual([
      "recipe-stopped  STEERED — nothing to ask the owner",
      "    1 stopped, closed by the owner — you closed this card, and none of its recipes has run since",
    ]);
  });

  it("settles a larger set's card when a hold shrinks it back to a set the owner closed, and posts nothing over their Done", async () => {
    const stoppedSince = "2026-09-15T09:30:00.000Z";
    writeRecipeDefinitions({ home, rows: [dailyRow()] });
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": stoppedSince } });
    const tick = atHome({ tail: ["--fire", "--only", "recipe-stopped", "--now", NOW] });
    expect(await runMonitorCheck({ deps: deps(), rest: tick })).toBe(EXIT_OK);
    const register = join(stateHomePaths({ home }).handSteps, "steps.jsonl");
    const registerRows = (): readonly { kind: string; id?: string; step?: { id: string } }[] =>
      readFileSync(register, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
    const postedIds = (): readonly string[] =>
      registerRows()
        .filter((row) => row.kind === "posted")
        .map((row) => row.step!.id);
    const settledIds = (): readonly string[] =>
      registerRows()
        .filter((row) => row.kind === "settled")
        .map((row) => row.id!);
    const [alone] = postedIds();
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "owner", did: "Done — read it", id: alone!, kind: "settled", settledIso: NOW },
      }),
    );
    writeRecipeDefinitions({ home, rows: [dailyRow(), dailyRow({ recipeId: "bump-drive-acme-admin" })] });
    stampRecipeRuns({
      home,
      stamps: { "bump-drive-acme-admin": stoppedSince, "vulnfix-digest-acme-admin": stoppedSince },
    });
    expect(await runMonitorCheck({ deps: deps(), rest: tick })).toBe(EXIT_OK);
    const [, larger] = postedIds();
    const ledger = supervisorTickLedgerPath({ home });
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(ledger, `${supervisorTickLine({ row: heldTick({ recipeId: "bump-drive-acme-admin" }) })}\n`);

    expect(await runMonitorCheck({ deps: deps(), rest: tick })).toBe(EXIT_OK);

    expect(postedIds()).toEqual([alone!, larger!]);
    expect(settledIds()).toEqual([alone!, larger!]);
  });
});

/**
 * One finalised supervisor tick recording a hold on a recipe, every source unread.
 *
 * @param recipeId the recipe the hold names as its subject
 * @returns the ledger row
 */
function heldTick({ recipeId }: { recipeId: string }): SupervisorTickRow {
  const startedIso = "2026-09-19T05:00:00.000Z";
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: startedIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  const judgement: SupervisorJudgement = {
    claim: "Held on the owner's word until the queue drains.",
    judgementId: "j1",
    kind: "hold-rationale",
    recordedIso: "2026-09-19T05:00:30.000Z",
    subject: { id: recipeId, kind: "recipe", label: recipeId },
    whyNotDerived: "operational-context",
    witness: { kind: "command", ref: "slopweaver automation due" },
  };
  const parts = {
    actions: [],
    judgements: [judgement],
    ownerTurns: {
      coverage: { earliestIso: undefined, linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read" as const,
      turns: [],
    },
    sources,
  };
  return {
    ...parts,
    finalisedIso: "2026-09-19T05:01:00.000Z",
    handoff: "handoff-9300",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId: "held",
    workspace: "workspace:1",
  } as unknown as SupervisorTickRow;
}

describe("bySession", () => {
  it("names the session it was given", () => {
    expect(bySession({ values: { "by-session": "chair" } })).toBe("chair");
  });

  it("cuts a value past the register's cap to it, rather than every card being refused", () => {
    expect(bySession({ values: { "by-session": "x".repeat(201) } })).toBe("x".repeat(200));
  });

  it("takes the default for a blank value, which the hand register would refuse on every card", () => {
    expect([bySession({ values: { "by-session": "" } }), bySession({ values: { "by-session": "  " } })]).toEqual([
      "unnamed-session",
      "unnamed-session",
    ]);
  });
});

describe("resolvedHomeOf, the hand register's own, as every monitor verb reads its home", () => {
  it("takes an explicit --home as given", () => {
    expect(resolvedHomeOf({ values: { home } })).toBe(home);
  });

  it("falls to this install's own home when --home is absent or not a string", () => {
    expect([resolvedHomeOf({ values: {} }), resolvedHomeOf({ values: { home: true } })]).toEqual([
      slopweaverHome(),
      slopweaverHome(),
    ]);
  });
});

describe("hookScriptPath", () => {
  it("takes --hook-script over anything the config says", () => {
    writeFileSync(cmuxConfigPath, '{"notifications":{"hooks":[{"command":"/from/config.sh"}]}}', "utf8");
    expect(hookScriptPath({ configPath: cmuxConfigPath, values: { "hook-script": "/named.sh" } })).toEqual({
      path: "/named.sh",
    });
  });

  it("discovers the single hook the config declares", () => {
    writeFileSync(cmuxConfigPath, '{"notifications":{"hooks":[{"command":"/from/config.sh"}]}}', "utf8");
    expect(hookScriptPath({ configPath: cmuxConfigPath, values: {} })).toEqual({ path: "/from/config.sh" });
  });

  it("will not guess between two hooks", () => {
    writeFileSync(cmuxConfigPath, '{"notifications":{"hooks":[{"command":"/a.sh"},{"command":"/b.sh"}]}}', "utf8");
    const found = hookScriptPath({ configPath: cmuxConfigPath, values: {} });
    expect(found).toEqual({ problem: expect.stringContaining("declares 2 notification hooks") });
  });

  it("says to name one when the config cannot be read at all", () => {
    const found = hookScriptPath({ configPath: join(home, "absent.json"), values: {} });
    expect(found).toEqual({ problem: expect.stringContaining("--hook-script") });
  });
});

describe("runMonitorFilter", () => {
  it("shows the script without writing anything", () => {
    expect(runMonitorFilter({ deps: deps(), rest: ["show", ...atHome()] })).toBe(EXIT_OK);
    expect(out[0]).toContain("#!/bin/sh");
    expect(existsSync(join(home, "hooks"))).toBe(false);
  });

  it("installs the filter and a shim at the hook path, backing up what was there", () => {
    const hookPath = join(home, "cmux-hook.sh");
    writeFileSync(hookPath, "#!/bin/sh\ncat\n", "utf8");
    expect(
      runMonitorFilter({ deps: deps(), rest: ["install", ...atHome({ tail: ["--hook-script", hookPath, "--json"] })] }),
    ).toBe(EXIT_OK);
    const receipt = JSON.parse(out[0]!);
    expect(readFileSync(receipt.backupPath, "utf8")).toBe("#!/bin/sh\ncat\n");
    expect(readFileSync(hookPath, "utf8")).toContain(receipt.filterPath);
  });

  it("reports the filter as not installed before an install has run", () => {
    const hookPath = join(home, "cmux-hook.sh");
    runMonitorFilter({ deps: deps(), rest: ["status", ...atHome({ tail: ["--hook-script", hookPath, "--json"] })] });
    expect(JSON.parse(out[0]!).installed).toBe(false);
  });

  it("reports it installed, having judged nothing, right after an install", () => {
    const hookPath = join(home, "cmux-hook.sh");
    const tail = ["--hook-script", hookPath, "--json"];
    runMonitorFilter({ deps: deps(), rest: ["install", ...atHome({ tail })] });
    out = [];
    runMonitorFilter({ deps: deps(), rest: ["status", ...atHome({ tail })] });
    const status = JSON.parse(out[0]!);
    expect(status.installed).toBe(true);
    expect(status.decisions).toBe(undefined);
  });

  it("refuses an action it does not know instead of picking one", () => {
    expect(runMonitorFilter({ deps: deps(), rest: ["enable", ...atHome()] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("install, show, status");
  });

  it("refuses an install whose hook path it cannot discover", () => {
    expect(runMonitorFilter({ deps: deps(), rest: ["install", ...atHome()] })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("could not be read");
  });
});

describe("EXIT_ERROR is reachable", () => {
  it("fails rather than exiting 0 when the register itself cannot be read", async () => {
    writeFileSync(join(home, "hand-steps"), "not a directory", "utf8");
    expect(await runMonitorCheck({ deps: deps(), rest: atHome({ tail: ["--now", NOW] }) })).toBe(EXIT_ERROR);
  });
});
