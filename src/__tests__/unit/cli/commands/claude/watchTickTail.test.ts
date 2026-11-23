/**
 * `recordAndFirePlanHealth` — what a `claude watch` keep-alive tick runs after its probes. Driven over a real plan
 * register and a real hand register in a temp home, through the REAL `monitor check` pass, with the note launcher a
 * counting function: a signed-out plan raises ONE note, a second tick seeing the same fault raises none, a probe that
 * reads the plan settles the card, and the fault coming back is a new card.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeRotationErrors } from "../../../../../claude/errors.js";
import type { ClaudePlanProbesPort } from "../../../../../claude/planProbes.js";
import type { SweptPlanProbe } from "../../../../../claude/recordPlanProbes.js";
import { firePlanHealth, recordAndFirePlanHealth } from "../../../../../cli/commands/claude/watchTickTail.js";
import type { MonitorDeps } from "../../../../../cli/commands/monitor/deps.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { appendHandRow, handRegisterPath, readHandRows, readOpenHandSteps } from "../../../../../hand/store.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryClaudePlanProbesPort } from "../../../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../../../codexFleetCapFixture.js";
import { memoryCodexSignInPort } from "../../../../codexSignInFixture.js";
import { memoryOrgHealthPort } from "../../../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../../../processesFake.js";

const NOW = "2026-11-04T01:00:00.000Z";
const EMAIL = "ada-owner-claude-2@slopweaver.ai";

let home = "";
let store = "";
let launches = 0;
let probesPort: ClaudePlanProbesPort = memoryClaudePlanProbesPort();
let monitorDeps: MonitorDeps | undefined;

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

/** The monitor seams over {@link home}: one plan register for every pass, the launcher counted, no page opened. */
function deps(): MonitorDeps {
  const quiet = (): void => undefined;
  return {
    claudeProbesPort: probesPort,
    claudeProjectsDir: join(home, "claude-projects"),
    cmuxConfigPath: join(home, "cmux.json"),
    fleetCapPort: memoryCodexFleetCapPort(),
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
      writeDiagnostic: quiet,
      writeOut: quiet,
    },
    now: () => NOW,
    openPage: async ({ url }) => err(`no page opens here: ${url}`),
    orgHealthPort: memoryOrgHealthPort(),
    pagePublished: memoryPagesPublished(),
    platform: "darwin",
    processes: NO_FSEVENTSD,
    registerPort: memoryPlanRegisterPort(),
    signInPort: memoryCodexSignInPort(),
    writeDiagnostic: quiet,
    writeOut: quiet,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "plan-health-"));
  store = join(home, "claude-accounts", "plan-two");
  mkdirSync(store, { recursive: true });
  writeFileSync(
    stateHomePaths({ home }).plansJson,
    JSON.stringify({
      rows: [{ alias: "plan-two", email: EMAIL, pinned: true, provider: "claude", storeDir: store }],
      version: 1,
    }),
    "utf8",
  );
  launches = 0;
  probesPort = memoryClaudePlanProbesPort();
  monitorDeps = deps();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One keep-alive tick at `nowIso` whose probe of plan-two read `signedOut` or its usage. */
async function tick({ nowIso, signedOut }: { nowIso: string; signedOut: boolean }): Promise<number> {
  const reading = signedOut ? err(ClaudeRotationErrors.storeNotReady({ alias: "plan-two" })) : ok({});
  return recordAndFirePlanHealth({
    deps: monitorDeps!,
    home,
    nowIso,
    probes: [{ alias: "plan-two", reading, storeDir: store }],
    probesPort,
    verb: "claude watch",
  });
}

/** Every `mon-claude-*` step id the hand register holds a posted row for, in posting order. */
function posted(): readonly string[] {
  const { rows } = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) }));
  return rows.flatMap((row) => (row.kind === "posted" && row.step.id.startsWith("mon-claude-") ? [row.step.id] : []));
}

/** The `mon-claude-*` steps still open. */
function open(): readonly string[] {
  return unwrap(readOpenHandSteps({ home }))
    .steps.map((step) => step.id)
    .filter((id) => id.startsWith("mon-claude-"));
}

describe("recordAndFirePlanHealth", () => {
  it("raises ONE note on a signed-out plan, and none on the next tick that sees the same fault", async () => {
    expect(await tick({ nowIso: "2026-11-04T00:50:00.000Z", signedOut: true })).toBe(EXIT_OK);
    expect([posted().length, open().length, launches]).toEqual([1, 1, 1]);
    const card = unwrap(readOpenHandSteps({ home })).steps.find((step) => step.id === open()[0])!;
    expect([card.what, card.literal]).toEqual([
      `Sign in as ${EMAIL} on Claude (plan-two) — paste the copied command into your terminal`,
      `CLAUDE_SECURESTORAGE_CONFIG_DIR=${store} claude auth login --email ${EMAIL}`,
    ]);

    expect(await tick({ nowIso: "2026-11-04T00:55:00.000Z", signedOut: true })).toBe(EXIT_OK);
    expect([posted().length, open().length, launches]).toEqual([1, 1, 1]);
  });

  it("settles the card the tick a probe reads the plan, and posts a NEW one when the fault comes back", async () => {
    await tick({ nowIso: "2026-11-04T00:50:00.000Z", signedOut: true });
    const first = open();

    expect(await tick({ nowIso: "2026-11-04T00:55:00.000Z", signedOut: false })).toBe(EXIT_OK);
    expect([open(), launches]).toEqual([[], 1]);

    await tick({ nowIso: "2026-11-04T00:58:00.000Z", signedOut: true });
    expect([posted().length, open().length, open()[0] === first[0], launches]).toEqual([2, 1, false, 2]);
  });

  it("settles a recovered plan's card in the same pass that holds another plan's Done", async () => {
    const storeOne = join(home, "claude-accounts", "plan-one");
    mkdirSync(storeOne, { recursive: true });
    const rows = [
      { alias: "plan-one", email: "ada-owner-claude-1@slopweaver.ai", provider: "claude", storeDir: storeOne },
      { alias: "plan-two", email: EMAIL, pinned: true, provider: "claude", storeDir: store },
    ];
    writeFileSync(stateHomePaths({ home }).plansJson, JSON.stringify({ rows, version: 1 }), "utf8");
    const signedOut = err(ClaudeRotationErrors.storeNotReady({ alias: "plan-one" }));
    const both: readonly SweptPlanProbe[] = [
      { alias: "plan-one", reading: signedOut, storeDir: storeOne },
      { alias: "plan-two", reading: err(ClaudeRotationErrors.storeNotReady({ alias: "plan-two" })), storeDir: store },
    ];
    const fire = (options: { nowIso: string; probes: readonly SweptPlanProbe[] }): Promise<number> =>
      recordAndFirePlanHealth({ ...options, deps: monitorDeps!, home, probesPort, verb: "claude watch" });
    expect(await fire({ nowIso: "2026-11-04T00:50:00.000Z", probes: both })).toBe(EXIT_OK);
    const [planOneCard, planTwoCard] = open().toSorted();
    const done = await appendHandRow({
      home,
      nowIso: "2026-11-04T00:52:00.000Z",
      row: {
        bySession: "owner-done",
        did: "done",
        id: planTwoCard!,
        kind: "settled",
        settledIso: "2026-11-04T00:52:00Z",
      },
    });
    expect(unwrap(done).appended).toBe(true);

    // Only plan-one is probed again, and it reads: plan-two's Done is held on its last probe, and plan-one's card goes.
    const recovered = [{ alias: "plan-one", reading: ok({}), storeDir: storeOne }];
    expect(await fire({ nowIso: "2026-11-04T00:55:00.000Z", probes: recovered })).toBe(EXIT_OK);
    expect([planOneCard!.includes("plan-one"), open(), posted().length, launches]).toEqual([true, [], 2, 2]);
  });

  it("raises nothing for a plan whose probe reads its usage", async () => {
    expect(await tick({ nowIso: "2026-11-04T00:50:00.000Z", signedOut: false })).toBe(EXIT_OK);
    expect([posted(), launches]).toEqual([[], 0]);
  });
});

describe("firePlanHealth", () => {
  it("floats ONE register note while the register does not read, and settles it the pass it reads again", async () => {
    const unread = { ...monitorDeps!, registerPort: unavailablePlanRegisterPort() };
    expect(await firePlanHealth({ deps: unread, home, verb: "claude watch" })).toBe(EXIT_OK);
    const card = unwrap(readOpenHandSteps({ home })).steps.find((step) => step.id === open()[0])!;
    expect([open().length, launches, card.what]).toEqual([
      1,
      1,
      "Ask on this card for a plans register repair — the store holding the plans register cannot be opened",
    ]);

    expect(await firePlanHealth({ deps: unread, home, verb: "claude watch" })).toBe(EXIT_OK);
    expect([posted().length, launches]).toEqual([1, 1]);

    expect(await tick({ nowIso: "2026-11-04T00:55:00.000Z", signedOut: false })).toBe(EXIT_OK);
    expect([open(), launches]).toEqual([[], 1]);
  });
});
