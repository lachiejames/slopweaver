/**
 * The supervisor chain journal as `profile words` reads it: an absent journal is no chain and no problem, every
 * line that will not decode is counted, and a journal that is there and will not read is said rather than read
 * as empty.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stateHomePaths } from "../../../../stateHome.js";
import { appendSupervisorLink, readSupervisorChainJournal } from "../../../../supervisor/chainStore.js";
import { A, B, pin, temp, useTempDirs } from "./harness.js";

useTempDirs();

describe("readSupervisorChainJournal", () => {
  it("reads an absent journal as no chain and no problem", () => {
    expect(readSupervisorChainJournal({ home: temp({ prefix: "words-home-" }) })).toEqual({ links: [], problems: [] });
  });

  it("counts every line that will not decode", () => {
    const home = temp({ prefix: "words-home-" });
    appendSupervisorLink({ home, link: pin({ at: "2026-09-04T22:00:00.000Z", session: A }) });
    const path = stateHomePaths({ home }).supervisorChainJsonl;
    writeFileSync(path, `{"torn\n${JSON.stringify(pin({ at: "2026-09-05T02:00:00.000Z", session: B }))}\nnope\n`, {
      flag: "a",
    });

    const read = readSupervisorChainJournal({ home });

    expect(read.links.map((link) => link.session.id)).toEqual([A, B]);
    expect(read.problems).toEqual(["2 line(s) of the supervisor chain journal do not parse"]);
  });

  it("says a journal that is there and will not read, rather than reading it as empty", () => {
    const home = temp({ prefix: "words-home-" });
    mkdirSync(stateHomePaths({ home }).supervisorChainJsonl, { recursive: true });

    const read = readSupervisorChainJournal({ home });

    expect(read.links).toEqual([]);
    expect(read.problems.length).toBe(1);
    expect(read.problems[0]).toContain("the supervisor chain journal would not read");
  });
});
