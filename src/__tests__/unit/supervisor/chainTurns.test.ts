/**
 * The light chain read the console voice's `supervisor_history` rides: only the owner's turns across the chain,
 * and every chair in the window it could not read whole named rather than dropped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSupervisorChain, readSupervisorChainJournal } from "../../../supervisor/chainStore.js";
import { readSupervisorChainIntake, readSupervisorChainTurns } from "../../../supervisor/intakeRead.js";
import { TranscriptSourceErrors } from "../../../transcripts/errors.js";
import {
  CHAIN,
  claudeHome,
  cleanScratch,
  linkFor,
  NEW,
  NEW_ASK,
  NO_DOCS,
  NOW,
  OLD,
  OLD_ASK,
  read,
  stateHome,
  userLine,
} from "./chainReadHarness.js";

afterEach(cleanScratch);

describe("readSupervisorChainTurns", () => {
  it("reads the predecessor's turn and the successor's, oldest first, across a floor spanning both", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const { turns, unreadChairs } = readSupervisorChainTurns({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      home,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(turns.map((turn) => turn.turnUuid)).toEqual([OLD_ASK, NEW_ASK]);
    expect(unreadChairs).toEqual([]);
  });

  it("names a chair in the window whose transcript is gone, and still returns the turns it could read", () => {
    const claude = claudeHome();
    const gone = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const home = stateHome({ links: [...CHAIN, linkFor({ at: "2026-09-05T06:00:00.000Z", session: gone })] });

    const { turns, unreadChairs } = readSupervisorChainTurns({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      home,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(turns.map((turn) => turn.turnUuid)).toEqual([OLD_ASK, NEW_ASK]);
    expect(unreadChairs).toEqual([
      `chair ${gone}: ${TranscriptSourceErrors.sessionNotFound({ sessionId: gone }).message}`,
    ]);
  });

  it("names a readable chair's torn line and its turn with no id, and still returns the turns it could read", () => {
    const claude = claudeHome();
    const torn = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const project = join(claude, "projects", "-torn");
    mkdirSync(project, { recursive: true });
    const lines = [
      userLine({
        text: "named turn",
        timestamp: "2026-09-05T07:00:00.000Z",
        uuid: "c0c0c0c0-0000-4000-8000-000000000001",
      }),
      '{"type":"user","message":',
      userLine({ text: "turn with no id", timestamp: "2026-09-05T07:10:00.000Z", uuid: "" }),
    ];
    writeFileSync(join(project, `${torn}.jsonl`), `${lines.join("\n")}\n`, "utf8");
    const home = stateHome({ links: [...CHAIN, linkFor({ at: "2026-09-05T06:00:00.000Z", session: torn })] });

    const { turns, unreadChairs } = readSupervisorChainTurns({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      home,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(turns.map((turn) => turn.text)).toEqual(["the corpus refresh needs a lock", "brief me", "named turn"]);
    expect(unreadChairs).toEqual([
      `chair ${torn}: 1 line(s) would not parse (first: line 2, not-json), so an owner turn may be among them`,
      `chair ${torn}: 1 owner turn(s) have no anchor of their own (first: line 3, no uuid), so they are not listed`,
    ]);
  });

  it("names a turn an unclosed wrapper cut short, and keeps the head it could read", () => {
    const claude = claudeHome();
    const cut = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const project = join(claude, "projects", "-cut");
    mkdirSync(project, { recursive: true });
    const line = userLine({
      text: "keep this <system-reminder>unterminated",
      timestamp: "2026-09-05T07:00:00.000Z",
      uuid: "c0c0c0c0-0000-4000-8000-000000000002",
    });
    writeFileSync(join(project, `${cut}.jsonl`), `${line}\n`, "utf8");
    const home = stateHome({ links: [...CHAIN, linkFor({ at: "2026-09-05T06:00:00.000Z", session: cut })] });

    const { turns, unreadChairs } = readSupervisorChainTurns({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      home,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(turns.map((turn) => turn.text).at(-1)).toBe("keep this");
    expect(unreadChairs).toEqual([
      `chair ${cut}: 1 owner turn(s) lost their tail to an unclosed wrapper (first: line 1), so each is shown in part`,
    ]);
  });

  it("names a Claude chair that retook the pin, whose later stretch the walk never reads (A → B → A)", () => {
    const claude = claudeHome();
    const retook = "2026-09-05T06:00:00.000Z";
    const home = stateHome({ links: [...CHAIN, linkFor({ at: retook, session: OLD })] });

    // The raw journal, as `readOwnerTurnWindow` passes it: `readSupervisorChain` has already collapsed the retake.
    const { unreadChairs } = readSupervisorChainTurns({
      chain: readSupervisorChainJournal({ home }).links,
      claudeHome: claude,
      home,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(unreadChairs).toEqual([
      `chair ${OLD}: held the pin again from ${retook}, and only its first stretch was walked, so an owner turn from then may be missing`,
    ]);
  });

  it("names no later stretch when that stretch ended before the floor", () => {
    const claude = claudeHome();
    const home = stateHome({
      links: [
        ...CHAIN,
        linkFor({ at: "2026-09-05T03:00:00.000Z", session: OLD }),
        linkFor({ at: "2026-09-05T04:00:00.000Z", session: NEW }),
      ],
    });

    const { unreadChairs } = readSupervisorChainTurns({
      chain: readSupervisorChainJournal({ home }).links,
      claudeHome: claude,
      home,
      sinceIso: "2026-09-05T05:00:00.000Z",
    });

    expect(unreadChairs).toEqual([]);
  });

  it("drops a chair whose successor took the pin before the floor, and the turn typed into it afterwards", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const { turns } = readSupervisorChainTurns({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      home,
      sinceIso: "2026-09-05T02:30:00.000Z",
    });

    expect(turns.map((turn) => turn.turnUuid)).toEqual([NEW_ASK]);
  });

  it("returns the same turns the full intake read witnesses, so the lighter read loses none of the owner's words", () => {
    const claude = claudeHome();
    const home = stateHome({
      links: [...CHAIN, linkFor({ at: "2026-09-05T06:00:00.000Z", session: "ffffffff-ffff-4fff-8fff-ffffffffffff" })],
    });
    const shared = {
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      home,
      sinceIso: "2026-08-28T00:00:00.000Z",
    };

    const light = readSupervisorChainTurns(shared).turns;
    const full = read({ report: readSupervisorChainIntake({ ...shared, docs: NO_DOCS, marks: [], nowIso: NOW }) });

    expect(light.map((turn) => turn.turnUuid)).toEqual([OLD_ASK, NEW_ASK]);
    expect(full.turns.map((item) => item.turn.turnUuid)).toEqual([OLD_ASK, NEW_ASK]);
  });
});
