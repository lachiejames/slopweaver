/**
 * The section-quality measurement, over cells rather than over files, so the reading the canon quotes has a
 * test rather than only a command.
 */
import { describe, expect, it } from "vitest";

import {
  type MeasuredCellReading,
  measureCell,
  measuredKinds,
  renderMeasurement,
} from "../../../measurement/briefingSectionQuality.js";

describe("one cell's reading", () => {
  it("counts its words and sentences and names the fleet word it never explained", () => {
    const reading = measureCell({ cell: { cell: "header lede", text: "The fill spawned it. Nothing else moved." } });

    expect(reading).toEqual({
      cell: "header lede",
      sentences: 2,
      unglossed: '"The fill spawned" (fill)',
      words: 7,
    });
  });

  it("reports no fleet word on a cell that explains the one it uses", () => {
    const text = "The fill spawned — the scan that starts unheld work — the audit.";

    expect(measureCell({ cell: { cell: "header lede", text } }).unglossed).toBeUndefined();
  });
});

describe("the roll-up by cell kind", () => {
  const reading = ({
    cell,
    words,
    unglossed,
  }: {
    cell: string;
    words: number;
    unglossed?: string;
  }): MeasuredCellReading => ({
    cell,
    sentences: 1,
    unglossed,
    words,
  });

  it("takes the median, the maximum and the count over the `what` cap", () => {
    const readings = [
      reading({ cell: "header lede", words: 10 }),
      reading({ cell: "header lede", words: 64 }),
      reading({ cell: "header lede", words: 155, unglossed: '"every tick" (tick)' }),
    ];

    expect(measuredKinds({ readings })).toEqual([
      {
        cell: "header lede",
        count: 3,
        examples: ['"every tick" (tick)'],
        maxWords: 155,
        medianWords: 64,
        overWhatCap: 2,
        unglossed: 1,
      },
    ]);
  });

  it("prints one line per kind, with the cap the reading is measured against named in it", () => {
    const readings = [reading({ cell: "header lede", words: 64 })];

    expect(renderMeasurement({ kinds: measuredKinds({ readings }) })).toEqual([
      "header lede              n=    1 median= 64 max=  64 over60w=    1 unglossed=    0  ",
    ]);
  });
});
