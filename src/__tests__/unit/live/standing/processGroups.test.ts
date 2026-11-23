/**
 * `parseProcessGroups`: each pid's process group and its tty's foreground group off a `ps -o pid=,pgid=,tpgid=`
 * listing, a line that is not three integers skipped and a repeated pid kept at its first row.
 */
import { describe, expect, it } from "vitest";

import { parseProcessGroups } from "../../../../live/standing/processGroups.js";

/**
 * MEASURED on cmux 0.65.2, `ps -o pid=,pgid=,tpgid= -p 40171,40159,914`: a live tab's `claude` (914),
 * a bare tab's `login` (40159) and its shell (40171).
 */
const MEASURED = ["  914   914  914", "40159 40159 40171", "40171 40171 40171", ""].join("\n");

describe("parseProcessGroups", () => {
  it("reads each row's pid, group and tty foreground group as measured on a bare and a live tab", () => {
    expect([...parseProcessGroups({ text: MEASURED })]).toEqual([
      [914, { pgid: 914, tpgid: 914 }],
      [40159, { pgid: 40159, tpgid: 40171 }],
      [40171, { pgid: 40171, tpgid: 40171 }],
    ]);
  });

  it("skips a line that is not three integers, keeps a repeated pid's first row, and reads a negative foreground", () => {
    const odd = ["5 5 5", "ps: no such process", "5 9 9", "7 7 -1", "8 8", ""].join("\n");

    expect([...parseProcessGroups({ text: odd })]).toEqual([
      [5, { pgid: 5, tpgid: 5 }],
      [7, { pgid: 7, tpgid: -1 }],
    ]);
  });

  it("reads an empty listing as no groups", () => {
    expect([...parseProcessGroups({ text: "" })]).toEqual([]);
  });
});
