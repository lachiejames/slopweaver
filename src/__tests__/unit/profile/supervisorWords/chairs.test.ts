/**
 * Which chairs `readSupervisorWords` reads, and over which tenures: each chair only while it held the pin
 * (A → B → A included), only the live pin's chair or only closed tenures when the journal or the pin is in doubt,
 * no chain said rather than read as silence, and a chair outside the window never looked up.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readSupervisorWords } from "../../../../profile/supervisorWords.js";
import { writeSupervisorPin } from "../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { appendSupervisorLink } from "../../../../supervisor/chainStore.js";
import {
  A,
  A_FIRST,
  B,
  B_AFTER,
  B_TURN,
  claudeHomeWith,
  GONE,
  pin,
  seat,
  temp,
  userLine,
  useTempDirs,
} from "./harness.js";

const A_DURING_B = "5863a44b-2326-4b7e-bb5c-52f47acb42a9";
const A_AGAIN = "4b0d9c77-6f21-4d3e-9a58-7c2e5b1f80aa";

useTempDirs();

describe("readSupervisorWords", () => {
  it("reads A's two tenures and B's one across A → B → A, each chair only while it held the pin", () => {
    const home = temp({ prefix: "words-home-" });
    seat({
      home,
      links: [
        pin({ at: "2026-09-04T22:00:00.000Z", session: A }),
        pin({ at: "2026-09-05T02:00:00.000Z", session: B }),
        pin({ at: "2026-09-05T06:00:00.000Z", session: A }),
      ],
    });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          userLine({ text: "the corpus refresh needs a lock", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST }),
          userLine({ text: "typed into a retired chair", timestamp: "2026-09-05T03:00:00.000Z", uuid: A_DURING_B }),
          userLine({ text: "back on A", timestamp: "2026-09-05T07:00:00.000Z", uuid: A_AGAIN }),
        ],
        [B]: [
          userLine({ text: "brief me", timestamp: "2026-09-05T04:00:00.000Z", uuid: B_TURN }),
          userLine({ text: "B after A took it back", timestamp: "2026-09-05T08:00:00.000Z", uuid: B_AFTER }),
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.problems).toEqual([]);
    expect(read.turns.map((turn) => turn.text).toSorted()).toEqual([
      "back on A",
      "brief me",
      "the corpus refresh needs a lock",
    ]);
  });

  it("drops a turn typed into a scan-only chair after the next chair took over", () => {
    const home = temp({ prefix: "words-home-" });
    appendSupervisorLink({ home, link: { ...pin({ at: "2026-09-04T22:00:00.000Z", session: A }), source: "scan" } });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-05T02:00:00.000Z", session: B }) });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST }),
          userLine({ text: "after B took over", timestamp: "2026-09-05T03:00:00.000Z", uuid: A_DURING_B }),
        ],
        [B]: [],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T00:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns.map((turn) => turn.text)).toEqual(["while A held it"]);
  });

  it("reads only the live pin's chair when a journal line will not decode, since it may be a lost hand-over", () => {
    const home = temp({ prefix: "words-home-" });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-04T22:00:00.000Z", session: A }) });
    writeFileSync(stateHomePaths({ home }).supervisorChainJsonl, `{"claudeSessionId":"${GONE}"}\n`, { flag: "a" });
    writeSupervisorPin({
      home,
      record: {
        pinnedAtIso: "2026-09-05T06:00:00.000Z",
        session: { host: "claude-code", id: B },
        workspaceId: "ws-b",
        workspaceRef: "w:1",
      },
    });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [userLine({ text: "after the lost hand-over", timestamp: "2026-09-05T03:00:00.000Z", uuid: A_DURING_B })],
        [B]: [userLine({ text: "to the live chair", timestamp: "2026-09-05T07:00:00.000Z", uuid: B_AFTER })],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T00:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns.map((turn) => turn.text)).toEqual(["to the live chair"]);
    expect(read.problems).toEqual([
      "1 line(s) of the supervisor chain journal do not parse",
      "with the chain journal in doubt, only the chair holding the pin now was read — no chair before it",
      "the supervisor chain starts at 2026-09-05T06:00:00.000Z, so no supervisor turn before it was read — `slopweaver supervisor chain --rescan`",
    ]);
  });

  it("says no supervisor turn was read when no chain is recorded, rather than reading it as silence", () => {
    const read = readSupervisorWords({
      claudeHome: claudeHomeWith({ transcripts: {} }),
      home: temp({ prefix: "words-home-" }),
      sinceIso: "2026-09-04T00:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns).toEqual([]);
    expect(read.problems).toEqual([
      "no supervisor chain is recorded, so no supervisor turn was read — `slopweaver supervisor chain --rescan`",
    ]);
  });

  it("says a pin record that is there and will not read", () => {
    const home = temp({ prefix: "words-home-" });
    const path = stateHomePaths({ home }).supervisorPinJson;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{", "utf8");

    const read = readSupervisorWords({
      claudeHome: claudeHomeWith({ transcripts: {} }),
      home,
      sinceIso: "2026-09-04T00:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.problems).toEqual([
      `the supervisor pin record at ${path} would not read`,
      "with the pin record unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on",
      "no supervisor chain is recorded, so no supervisor turn was read — `slopweaver supervisor chain --rescan`",
    ]);
  });

  it("reads only closed tenures when the pin will not read, since it may be a hand-over the journal never got", () => {
    const home = temp({ prefix: "words-home-" });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-04T22:00:00.000Z", session: A }) });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-05T02:00:00.000Z", session: B }) });
    const path = stateHomePaths({ home }).supervisorPinJson;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{", "utf8");
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST })],
        [B]: [
          userLine({ text: "B, perhaps after it handed over", timestamp: "2026-09-05T08:00:00.000Z", uuid: B_AFTER }),
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns.map((turn) => turn.text)).toEqual(["while A held it"]);
    expect(read.problems).toEqual([
      `the supervisor pin record at ${path} would not read`,
      "with the pin record unreadable, who holds the pin now is unknown, so the journal's last chair was not read from its last link on",
    ]);
  });

  it("reads only closed tenures when no pin is recorded, since nothing says the last chair still holds it", () => {
    const home = temp({ prefix: "words-home-" });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-04T22:00:00.000Z", session: A }) });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-05T02:00:00.000Z", session: B }) });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST })],
        [B]: [userLine({ text: "B, perhaps after it let go", timestamp: "2026-09-05T08:00:00.000Z", uuid: B_AFTER })],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns.map((turn) => turn.text), read.problems]).toEqual([
      ["while A held it"],
      [
        "with no pin record, nothing says the journal's last chair still holds the pin, so it was not read from its last link on",
      ],
    ]);
  });

  it("names a chair inside the window whose transcript is gone, and never looks up one outside it", () => {
    const home = temp({ prefix: "words-home-" });
    seat({
      home,
      links: [
        pin({ at: "2026-08-01T00:00:00.000Z", session: "a0000006-0000-4000-8000-000000000007" }),
        pin({ at: "2026-09-04T22:00:00.000Z", session: GONE }),
        pin({ at: "2026-09-05T02:00:00.000Z", session: B }),
      ],
    });
    const claudeHome = claudeHomeWith({
      transcripts: { [B]: [userLine({ text: "brief me", timestamp: "2026-09-05T04:00:00.000Z", uuid: B_TURN })] },
    });

    // The August chair handed over at 22:00, before this floor, so it is never looked up; GONE held it at 23:00.
    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T23:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns.map((turn) => turn.text)).toEqual(["brief me"]);
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]).toContain(`chair ${GONE} would not read`);
  });
});
