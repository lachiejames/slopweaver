/** `paceOnBoots`: a relaunch waits on boots in flight for a bound, and never refuses. */
import { describe, expect, it } from "vitest";

import { paceOnBoots } from "../../../../../../cli/commands/cmux/reseatPass.js";

describe("paceOnBoots", () => {
  it("returns at once, saying nothing, when no boot is in flight", async () => {
    const lines: string[] = [];
    let pauses = 0;

    const paced = await paceOnBoots({
      emit: ({ line }) => lines.push(line),
      holding: () => undefined,
      pause: () => {
        pauses += 1;
        return Promise.resolve();
      },
      polls: 3,
    });

    expect([paced, pauses, lines]).toStrictEqual(["clear", 0, []]);
  });

  it("waits while boots are in flight and goes once they clear", async () => {
    const lines: string[] = [];
    const readings = ["3 boots in flight", "3 boots in flight", undefined];

    const paced = await paceOnBoots({
      emit: ({ line }) => lines.push(line),
      holding: () => readings.shift(),
      pause: () => Promise.resolve(),
      polls: 5,
    });

    expect([paced, readings.length, lines]).toStrictEqual([
      "clear",
      0,
      ["3 boots in flight — pacing this relaunch on them, never holding it"],
    ]);
  });

  it("relaunches anyway once its bound passes, and never refuses", async () => {
    const lines: string[] = [];
    let pauses = 0;

    const paced = await paceOnBoots({
      emit: ({ line }) => lines.push(line),
      holding: () => "4 boots in flight",
      pause: () => {
        pauses += 1;
        return Promise.resolve();
      },
      polls: 2,
    });

    expect([paced, pauses, lines]).toStrictEqual([
      "bound",
      2,
      [
        "4 boots in flight — pacing this relaunch on them, never holding it",
        "4 boots in flight — relaunching anyway: a reseat replaces a session, it never adds one",
      ],
    ]);
  });
});
