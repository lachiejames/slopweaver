/**
 * The finding gate's effectful shell, against a real temp home — a board row on disk and a run journal
 * beside it, exactly what a door reads in production — and the in-memory autonomy ledger port for the row an
 * internal door writes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isAutonomyActionId } from "../../../../../autonomy/fields.js";
import type { AutonomyLedgerPort } from "../../../../../autonomy/port.js";
import { foldAutonomy } from "../../../../../autonomy/query.js";
import type { AutonomyAction } from "../../../../../autonomy/types.js";
import { bareReferenceErrors } from "../../../../../briefing/autonomyActRefs.js";
import {
  createFindingGateRefused,
  findingRulingGateRefused,
  internalFindingActionId,
} from "../../../../../cli/commands/github/findingRulingGate.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  heldAutonomyRecords,
  memoryAutonomyLedgerPort,
  memoryAutonomyStore,
  unavailableAutonomyLedgerPort,
} from "../../../../autonomyLedgerFixture.js";

const homes: string[] = [];
afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "finding-gate-home-"));
  homes.push(home);
  return home;
}

/** A finding row on the board, unruled unless `ruled`, with an optional run journal naming its branch. */
function seedFinding({
  home,
  ruled = false,
  journalBranch,
  evidence = ["owner/repo#16360"],
}: {
  home: string;
  ruled?: boolean;
  journalBranch?: string;
  evidence?: readonly string[];
}): void {
  const dir = join(home, "handovers");
  mkdirSync(dir, { recursive: true });
  const text = askRowText({
    anchor: undefined,
    ask: "watchPr.sh dies silent",
    askedIso: "2026-09-02T06:14:01Z",
    checkedIso: "2026-08-30T23:10:00Z",
    branch: undefined,
    dispatch: false,
    finding: { evidence, observedBy: "session-40" },
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug: "watchpr-dies",
  });
  const withRuling = ruled
    ? text.replace("origin: finding\n", 'origin: finding\nruling: "yes"\nrulingAnchor: https://example.invalid/p9\n')
    : text;
  writeFileSync(join(dir, "watchpr-dies.md"), withRuling, "utf8");
  if (journalBranch !== undefined) {
    const runs = join(home, "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      join(runs, "watchpr-dies.jsonl"),
      `${JSON.stringify({ atIso: "2026-09-02T07:45:09Z", branch: journalBranch, docHash: "abc", kind: "started" })}\n`,
      "utf8",
    );
  }
}

describe("findingRulingGateRefused", () => {
  it("leaves the door open on a home with no board at all", async () => {
    const lines: string[] = [];
    const refused = await findingRulingGateRefused({
      action: "open a pull request on staging",
      autonomy: memoryAutonomyLedgerPort(),
      head: "feature",
      home: tempHome(),
      out: ({ line }) => lines.push(line),
    });
    expect(refused).toBe(false);
    expect(lines).toEqual([]);
  });

  it("refuses an unruled finding whose slug is the head branch", async () => {
    const home = tempHome();
    seedFinding({ home });
    const lines: string[] = [];
    const refused = await findingRulingGateRefused({
      action: "open a pull request on staging",
      autonomy: memoryAutonomyLedgerPort(),
      head: "watchpr-dies",
      home,
      out: ({ line }) => lines.push(line),
    });
    expect(refused).toBe(true);
    expect(lines[0]).toBe(
      "refused: finding-unruled: cannot open a pull request on staging for watchpr-dies until the owner has ruled on it",
    );
  });

  it("finds the row through the branch its run journal recorded", async () => {
    const home = tempHome();
    seedFinding({ home, journalBranch: "wt/watchpr-fix" });
    const refused = await findingRulingGateRefused({
      action: "x",
      autonomy: memoryAutonomyLedgerPort(),
      head: "wt/watchpr-fix",
      home,
      out: () => {},
    });
    expect(refused).toBe(true);
  });

  it("proceeds, saying so, once the row carries the owner's ruling", async () => {
    const home = tempHome();
    seedFinding({ home, ruled: true });
    const lines: string[] = [];
    const refused = await findingRulingGateRefused({
      action: "x",
      autonomy: memoryAutonomyLedgerPort(),
      head: "watchpr-dies",
      home,
      out: ({ line }) => lines.push(line),
    });
    expect(refused).toBe(false);
    expect(lines).toEqual([
      "finding gate: watchpr-dies carries the owner's ruling (https://example.invalid/p9) — proceeding",
    ]);
  });
});

describe("createFindingGateRefused", () => {
  it("gates an unruled finding whatever the base branch is called, a personal-looking one included", async () => {
    const home = tempHome();
    seedFinding({ home });
    const lines: string[] = [];
    const refused = await createFindingGateRefused({
      autonomy: memoryAutonomyLedgerPort(),
      base: "v2-ada-owner-work-console",
      head: "watchpr-dies",
      home,
      out: ({ line }) => lines.push(line),
    });
    expect(refused).toBe(true);
    expect(lines[0]).toBe(
      "refused: finding-unruled: cannot open a pull request on v2-ada-owner-work-console for watchpr-dies until the owner has ruled on it",
    );
  });

  it("gates a pull request on a team-reviewed base", async () => {
    const home = tempHome();
    seedFinding({ home });
    const lines: string[] = [];
    const refused = await createFindingGateRefused({
      autonomy: memoryAutonomyLedgerPort(),
      base: "staging",
      head: "watchpr-dies",
      home,
      out: ({ line }) => lines.push(line),
    });
    expect(refused).toBe(true);
    expect(lines[0]).toBe(
      "refused: finding-unruled: cannot open a pull request on staging for watchpr-dies until the owner has ruled on it",
    );
  });
});

describe("an INTERNAL door writes the judgement down instead of holding the branch", () => {
  /** Every act the ledger holds, read back through the port the door was handed. */
  async function acts({ port }: { port: AutonomyLedgerPort }): Promise<readonly AutonomyAction[]> {
    return unwrap(foldAutonomy({ records: await heldAutonomyRecords({ port }) }));
  }

  it("proceeds on an unruled finding and leaves one autonomy-ledger row naming why", async () => {
    const home = tempHome();
    seedFinding({ home });
    const port = memoryAutonomyLedgerPort();

    const refused = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: port,
      head: "watchpr-dies",
      home,
      internal: true,
      out: () => {},
    });

    expect(refused).toBe(false);
    const rows = await acts({ port });
    expect(rows.length).toBe(1);
    const row = rows[0]!.action;
    expect(row.actionId).toBe("finding-pr.watchpr-dies");
    expect(row.kind).toBe("open-internal-finding-pull-request");
    expect(row.subject).toBe("watchpr-dies");
    expect(row.run).toBe("watchpr-dies");
    expect(row.why).toBe(
      "watchpr-dies is an unruled fleet finding whose work reaches nobody but the owner, so rule 10 hands it to " +
        "this session's judgement. Observed by session-40 from owner/repo#16360.",
    );
    expect(row.witness).toBe(
      "open a pull request on main: finding gate: watchpr-dies is an unruled fleet finding, and this door " +
        "reaches nobody but the owner — · proceeding on this session's judgement under rule 10, recorded in the " +
        "autonomy ledger · watchpr-dies is a fleet finding, not something the owner asked for — observed by " +
        "session-40 from owner/repo#16360",
    );
  });

  it("writes a bare #N its own evidence links as owner/repo#N, so the briefing renders the act", async () => {
    const home = tempHome();
    seedFinding({ evidence: ["acme/widgets#2914 merged", "the same read on #2913 lagged its merge"], home });
    const port = memoryAutonomyLedgerPort();

    const refused = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: port,
      head: "watchpr-dies",
      home,
      internal: true,
      out: () => {},
    });

    expect(refused).toBe(false);
    const row = (await acts({ port }))[0]!.action;
    expect(row.why).toBe(
      "watchpr-dies is an unruled fleet finding whose work reaches nobody but the owner, so rule 10 hands it to " +
        "this session's judgement. Observed by session-40 from acme/widgets#2914 merged, the same read on " +
        "acme/widgets#2913 lagged its merge.",
    );
    expect(bareReferenceErrors({ entry: (await acts({ port }))[0]! })).toEqual([]);
  });

  it("REFUSES a bare #N its own evidence cannot resolve, naming it, and writes nothing", async () => {
    const home = tempHome();
    seedFinding({ evidence: ["the same read on #2913 lagged its merge"], home });
    const port = memoryAutonomyLedgerPort();
    const lines: string[] = [];

    const refused = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: port,
      head: "watchpr-dies",
      home,
      internal: true,
      out: ({ line }) => lines.push(line),
    });

    expect(refused).toBe(true);
    expect(await heldAutonomyRecords({ port })).toEqual([]);
    expect(lines.at(-2)).toContain(
      "refused: could not record the judgement in the autonomy ledger: the act would carry a reference onto the briefing as plain text",
    );
    expect(lines.at(-2)).toContain('"#2913"');
  });

  it("says on stdout that it is proceeding, on whose judgement, and where the row went", async () => {
    const home = tempHome();
    seedFinding({ home });
    const lines: string[] = [];

    await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: memoryAutonomyLedgerPort(),
      head: "watchpr-dies",
      home,
      internal: true,
      out: ({ line }) => lines.push(line),
    });

    expect(lines[1]).toBe("  proceeding on this session's judgement under rule 10, recorded in the autonomy ledger");
    expect(lines[3]).toBe("  recorded as finding-pr.watchpr-dies in the autonomy ledger");
  });

  it("records ONE act per finding — a second push of the same branch is the same act, nothing written", async () => {
    const home = tempHome();
    seedFinding({ home });
    const store = memoryAutonomyStore();
    const port = memoryAutonomyLedgerPort({ store });
    const first = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: port,
      head: "watchpr-dies",
      home,
      internal: true,
      out: () => {},
    });
    const lines: string[] = [];

    const second = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: port,
      head: "watchpr-dies",
      home,
      internal: true,
      out: ({ line }) => lines.push(line),
    });

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(lines[3]).toBe("  already recorded as finding-pr.watchpr-dies — nothing written");
    expect((await acts({ port })).length).toBe(1);
    expect(store.inserts).toBe(1);
  });

  it("REFUSES when the ledger cannot be reached, because the row is what replaces the owner's word", async () => {
    const home = tempHome();
    seedFinding({ home });
    const lines: string[] = [];

    const refused = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: unavailableAutonomyLedgerPort(),
      head: "watchpr-dies",
      home,
      internal: true,
      out: ({ line }) => lines.push(line),
    });

    expect(refused).toBe(true);
    expect(lines[3]).toBe(
      `refused: could not record the judgement in the autonomy ledger: ${AUTONOMY_FIXTURE_OUTAGE.message}`,
    );
    expect(lines.at(-1)).toBe(
      "  the ledger row IS what replaces the owner's word here, so a door that cannot write one stays shut",
    );
  });

  it("REFUSES when the write itself is refused, never proceeding unrecorded", async () => {
    const home = tempHome();
    seedFinding({ home });
    const lines: string[] = [];
    // The read answers an empty ledger and the write refuses — the outage arriving between the two calls.
    const refusing: AutonomyLedgerPort = {
      appendRecord: (request) => unavailableAutonomyLedgerPort().appendRecord(request),
      readRecords: (request) => memoryAutonomyLedgerPort().readRecords(request),
    };

    const refused = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: refusing,
      head: "watchpr-dies",
      home,
      internal: true,
      out: ({ line }) => lines.push(line),
    });

    expect(refused).toBe(true);
    expect(lines[3]).toBe(
      `refused: could not record the judgement in the autonomy ledger: ${AUTONOMY_FIXTURE_OUTAGE.message}`,
    );
  });

  it("writes NO row on a team-facing door, which still refuses", async () => {
    const home = tempHome();
    seedFinding({ home });
    const store = memoryAutonomyStore();

    const refused = await findingRulingGateRefused({
      action: "open a pull request on staging",
      autonomy: memoryAutonomyLedgerPort({ store }),
      head: "watchpr-dies",
      home,
      out: () => {},
    });

    expect(refused).toBe(true);
    expect(store.inserts).toBe(0);
    expect(store.opened).toBe(0);
  });

  it("writes NO row when the owner already ruled — that is their word, not the session's judgement", async () => {
    const home = tempHome();
    seedFinding({ home, ruled: true });
    const store = memoryAutonomyStore();

    const refused = await findingRulingGateRefused({
      action: "open a pull request on main",
      autonomy: memoryAutonomyLedgerPort({ store }),
      head: "watchpr-dies",
      home,
      internal: true,
      out: () => {},
    });

    expect(refused).toBe(false);
    expect(store.inserts).toBe(0);
    expect(store.opened).toBe(0);
  });
});

describe("internalFindingActionId", () => {
  it("keeps a slug the register already accepts exactly as written", () => {
    expect(internalFindingActionId({ slug: "watchpr-dies" })).toBe("finding-pr.watchpr-dies");
  });

  it("folds a slug carrying capitals into an id the register accepts, instead of shutting the door", () => {
    const slug = "a-killed-doneWhen-probe-reports-an-exit-code-instead-of-timed-out";

    const actionId = internalFindingActionId({ slug });

    expect(isAutonomyActionId({ actionId })).toBe(true);
    expect(actionId.startsWith("finding-pr.a-killed-donewhen-probe-reports-")).toBe(true);
  });

  it("never opens the id on a separator, however the slug begins, nor leaves it empty", () => {
    expect(isAutonomyActionId({ actionId: internalFindingActionId({ slug: "_Leading-underscore" }) })).toBe(true);
    expect(isAutonomyActionId({ actionId: internalFindingActionId({ slug: "___" }) })).toBe(true);
  });

  it("keeps two slugs that differ only by case apart", () => {
    expect(internalFindingActionId({ slug: "Fix-It" })).not.toBe(internalFindingActionId({ slug: "fix-it" }));
  });
});
