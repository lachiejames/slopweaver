/*
 * `profile words` naming a supervisor read it could not make as a gap, never an empty chain: no chain at all, a
 * chain journal that will not read, a chain link or pin record holding a byte that is not UTF-8, and a live pin
 * with no readable instant, in a list and by one anchor.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { writeSupervisorPin } from "../../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { CHAIR, claudeHome, home, OTHER_TURN, run, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — a list", () => {
  it("exits 1 over a home with no supervisor chain, since no supervisor turn could be read", () => {
    rmSync(stateHomePaths({ home }).supervisorChainJsonl);
    rmSync(stateHomePaths({ home }).supervisorPinJson);

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines[1]).toBe(
      "  not read — supervisor: no supervisor chain is recorded, so no supervisor turn was read — `slopweaver supervisor chain --rescan`",
    );
  });

  it("names an unreadable supervisor chain journal as a gap rather than an empty chain", () => {
    rmSync(stateHomePaths({ home }).supervisorChainJsonl);
    mkdirSync(stateHomePaths({ home }).supervisorChainJsonl, { recursive: true });

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines[1]).toContain("  not read — supervisor: the supervisor chain journal would not read");
  });

  it("names a chain journal link holding a byte that is not UTF-8 as unread, never trusting it repaired", () => {
    const path = stateHomePaths({ home }).supervisorChainJsonl;
    const bytes = readFileSync(path);
    bytes[bytes.indexOf("ws-1") + 2] = 0xff;
    writeFileSync(path, bytes);

    const { code, lines } = run({ rest: [] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines.filter((line) => line.startsWith("  not read — supervisor: "))).toEqual([
      "  not read — supervisor: 1 line(s) of the supervisor chain journal do not parse",
      "  not read — supervisor: with the chain journal in doubt, only the chair holding the pin now was read — no chair before it",
    ]);
  });

  it("names a pin record holding a byte that is not UTF-8 as unread, never trusting it repaired", () => {
    const path = stateHomePaths({ home }).supervisorPinJson;
    const bytes = readFileSync(path);
    bytes[bytes.indexOf("ws-1") + 2] = 0xff;
    writeFileSync(path, bytes);

    const { code, lines } = run({ rest: [] });

    expect([code, lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [
        `  not read — supervisor: the supervisor pin record at ${path} would not read`,
        "  not read — supervisor: with the pin record unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on",
      ],
    ]);
  });

  it("reads no open tenure when the live pin names another chair with no readable instant, in a list or one anchor", () => {
    const path = stateHomePaths({ home }).supervisorPinJson;
    writeSupervisorPin({
      home,
      record: {
        session: { host: "claude-code", id: "6f708192-0314-4a5b-8c6d-7e8f90a1b2c3" },
        pinnedAtIso: "not-an-instant",
        workspaceId: "ws-2",
        workspaceRef: "w:2",
      },
    });
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      `${JSON.stringify({ message: { content: "ship the atlas" }, promptSource: "typed", timestamp: "2026-10-04T07:00:00.000Z", type: "user", uuid: OTHER_TURN })}\n`,
      "utf8",
    );

    const list = run({ rest: [] });
    const one = run({ rest: [`transcript:${CHAIR}#${OTHER_TURN}`] });

    expect([list.code, list.lines.slice(1)]).toEqual([
      EXIT_ERROR,
      [
        `  not read — supervisor: the supervisor pin record at ${path} carries no readable pinnedAtIso`,
        "  not read — supervisor: with the pin record unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on",
      ],
    ]);
    expect([one.code, one.lines.join("\n").includes("ship the atlas")]).toEqual([EXIT_ERROR, false]);
  });
});
