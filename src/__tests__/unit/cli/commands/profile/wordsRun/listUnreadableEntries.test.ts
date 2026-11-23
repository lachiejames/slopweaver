/*
 * `profile words` naming an entry it cannot safely read as unread, never blocking on it nor quoting it repaired:
 * a journal, ledger or index that is a FIFO, a relay, call line and chair transcript holding a byte that is not
 * UTF-8, and a talk anchor whose turn file is a FIFO.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { callIndexPath } from "../../../../../../talk/callStore.js";
import { CHAIR, claudeHome, home, OTHER_TURN, run, stage, TURN, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — a list", () => {
  it.each([
    ["the supervisor chain journal", (): string => stateHomePaths({ home }).supervisorChainJsonl, "supervisor"],
    ["the relay ledger", (): string => stateHomePaths({ home }).talkRelaysJsonl, "console-relays"],
    ["the call index", (): string => callIndexPath({ home }), "console-calls"],
  ])("names %s as unread when it is a FIFO, never blocking on it", (_what, pathOf, source) => {
    const path = pathOf();
    mkdirSync(dirname(path), { recursive: true });
    rmSync(path, { force: true });
    execFileSync("mkfifo", [path]);

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(
      lines.filter((line) => line.startsWith(`  not read — ${source}: `) && line.includes("not a regular file")).length,
    ).toBe(1);
  });

  it("names a relay, a call line and a chair transcript holding a byte that is not UTF-8, never quoting it repaired", () => {
    const damage = ({ text }: { text: string }): Buffer => {
      const bytes = Buffer.from(text, "utf8");
      bytes[bytes.indexOf("PLACE")] = 0xff;
      return bytes;
    };
    stage({ atIso: "2026-10-04T09:00:00.000Z", heard: "PLACE the atlas", turnId: TURN, typed: true });
    const turnFile = join(stateHomePaths({ home }).talkTurns, `${TURN}.json`);
    writeFileSync(turnFile, damage({ text: readFileSync(turnFile, "utf8") }));
    const call = "5d6e7f80-9102-4a3b-8c4d-5e6f70819203";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      damage({
        text: `${JSON.stringify({ atIso: "2026-10-04T08:00:00.000Z", final: true, id: "s-1", kind: "segment", text: "PLACE it", who: "owner" })}\n`,
      }),
    );
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      damage({
        text: `${JSON.stringify({ message: { content: "PLACE it" }, promptSource: "typed", timestamp: "2026-10-04T07:00:00.000Z", type: "user", uuid: OTHER_TURN })}\n`,
      }),
    );

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines.filter((line) => line.includes("�"))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("  not read — ")).map((line) => line.split(":")[0])).toEqual([
      "  not read — console-calls",
      "  not read — console-relays",
      "  not read — supervisor",
    ]);
  });

  it("refuses a talk anchor whose turn file is a FIFO, never blocking on it", () => {
    mkdirSync(stateHomePaths({ home }).talkTurns, { recursive: true });
    execFileSync("mkfifo", [join(stateHomePaths({ home }).talkTurns, `${TURN}.json`)]);

    const { code, lines } = run({ rest: [`talk:${TURN}`] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("not a regular file");
  });
});
