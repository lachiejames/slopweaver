/*
 * `profile words` naming a console relay it could not read as a gap, never as no steer: a record that will not
 * read, a receipted steer whose turn file is gone or will not read, the two gaps a window ending before them leaves
 * out, a turn file claiming another turn's anchor, and a receipted turn file under a capitalised name.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { home, OTHER_TURN, run, stage, TURN, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — a list", () => {
  it("exits 1 when nothing matched but a record would not read, and names it", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship it", turnId: TURN, typed: true });
    writeFileSync(join(stateHomePaths({ home }).talkTurns, `${OTHER_TURN}.json`), "{", "utf8");

    const { code, lines } = run({ rest: ["--phrase", "nowhere"] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain(`  not read — console-relays: `);
    expect(lines[1]).toContain(OTHER_TURN);
  });

  it("names a receipted steer whose turn file is gone, rather than reading it as no steer", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    writeFileSync(
      stateHomePaths({ home }).talkRelaysJsonl,
      `${JSON.stringify(JSON.parse(readFileSync(turnFile, "utf8")))}\n`,
    );
    rmSync(turnFile);

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [`  not read — console-relays: talk:${TURN} is receipted in the relay ledger but its turn file is gone`],
    ]);
  });

  it("leaves a receipted steer whose turn file is gone out of a window that ends before it was staged", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    writeFileSync(
      stateHomePaths({ home }).talkRelaysJsonl,
      `${JSON.stringify(JSON.parse(readFileSync(turnFile, "utf8")))}\n`,
    );
    rmSync(turnFile);

    const { code } = run({ rest: ["--since", "2026-09-30T00:00:00.000Z", "--until", "2026-10-01T00:00:00.000Z"] });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("leaves a relay holding none of the owner's words out of a window that ends before it was staged", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: false });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    const { heard: _heard, ...legacy } = JSON.parse(readFileSync(turnFile, "utf8")) as Record<string, unknown>;
    writeFileSync(turnFile, JSON.stringify(legacy), "utf8");

    const inside = run({ rest: [] });
    const before = run({ rest: ["--since", "2026-09-30T00:00:00.000Z", "--until", "2026-10-01T00:00:00.000Z"] });

    expect([inside.code, before.code]).toEqual([EXIT_ERROR, EXIT_EXPECTED_EMPTY]);
  });

  it("names a receipted steer whose turn file is there but will not read once, by its read failure", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    writeFileSync(
      stateHomePaths({ home }).talkRelaysJsonl,
      `${JSON.stringify(JSON.parse(readFileSync(turnFile, "utf8")))}\n`,
    );
    writeFileSync(turnFile, "{", "utf8");

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain(TURN);
    expect(lines[1]).not.toContain("is gone");
  });

  it("never lists one turn file's words under the anchor of another turn it claims to be", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "first", turnId: TURN, typed: true });
    stage({ atIso: "2026-10-04T09:05:00.000Z", heard: "second", turnId: OTHER_TURN, typed: true });
    const turns = stateHomePaths({ home }).talkTurns;
    const claimed = JSON.parse(readFileSync(join(turns, `${TURN}.json`), "utf8")) as Record<string, unknown>;
    writeFileSync(
      join(turns, `${TURN}.json`),
      JSON.stringify({ ...claimed, anchor: `talk:${OTHER_TURN}`, turnId: OTHER_TURN }),
      "utf8",
    );

    const list = run({ rest: ["--full"] });
    const one = run({ rest: [`talk:${OTHER_TURN}`] });

    expect(list.code).toBe(EXIT_OK);
    expect(list.lines.filter((line) => line.includes("first"))).toEqual([]);
    expect(list.lines.filter((line) => line.startsWith("  not read — console-relays: ")).length).toBe(1);
    expect(list.lines.find((line) => line.startsWith("  not read — console-relays: "))).toContain(
      `holds turn ${OTHER_TURN} (talk:${OTHER_TURN}), not its own`,
    );
    expect(one.lines.join("\n")).toContain("second");
  });

  it("names a receipted turn file under a capitalised name once, never listing an anchor that would not reopen it", () => {
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "ship the atlas", turnId: TURN, typed: true });
    const turns = stateHomePaths({ home }).talkTurns;
    writeFileSync(
      stateHomePaths({ home }).talkRelaysJsonl,
      `${JSON.stringify(JSON.parse(readFileSync(join(turns, `${TURN}.json`), "utf8")))}\n`,
    );
    const capitalised = join(turns, `${TURN.toUpperCase()}.json`);
    renameSync(join(turns, `${TURN}.json`), capitalised);

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [
        `  not read — console-relays: could not read ${capitalised}: its name is not lowercase, so no talk: anchor reopens it on a case-sensitive disk`,
      ],
    ]);
  });
});
