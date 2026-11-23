/*
 * `parseAnswerArm` end to end on a figure: an asserted one owes a measurement naming the command that settles
 * it, past only by this session's live unmeasured-figures grant, and an unused or duplicated measurement is
 * refused with no way past. It moved here when `parseAnswerArm.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";
// register-class: outbound-figure-asserted-with-no-measurement

import { unwrap } from "../../../../../lib/result.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import { answerRaw, envGranting, envWithoutGrant, NO_CONTEXT, useHomes } from "./harness.js";

useHomes();

describe("parseAnswerArm — a figure carries the measurement that settles it", () => {
  const CLEAN_FIGURE_ENV: Readonly<Record<string, string | undefined>> = {};

  /** One `answer` arm asserting a figure in its body, with whatever measurements a case declares. */
  function figureAnswer({ measurements }: { measurements: readonly unknown[] }): unknown {
    return {
      ...(answerRaw({
        bodyText: "227 monitors have never fired once",
        leadText: "the fleet is noisier than it looks",
      }) as Record<string, unknown>),
      measurements,
    };
  }

  it("REFUSES an asserted figure with no measurement behind it, and names the journalled hatch", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: CLEAN_FIGURE_ENV,
      raw: figureAnswer({ measurements: [] }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("body.0:");
    expect(errors[0]).toContain('"227" is asserted here with nothing saying how it was measured');
    expect(errors[0]).toContain("slopweaver hatch open unmeasured-figures");
  });

  it("accepts the same answer once a measurement covers the figure", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: NO_CONTEXT,
        env: CLEAN_FIGURE_ENV,
        raw: figureAnswer({
          measurements: [
            {
              figures: ["227"],
              repro: "slopweaver atlas datadog --monitors --unfired",
              takenAtIso: "2026-09-20T07:00:00.000Z",
            },
          ],
        }),
      }),
    );
    expect(answer.measurements).toEqual([
      {
        figures: ["227"],
        repro: "slopweaver atlas datadog --monitors --unfired",
        takenAtIso: "2026-09-20T07:00:00.000Z",
      },
    ]);
  });

  it("sends it unchanged under a live unmeasured-figures grant", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: NO_CONTEXT,
        env: envGranting({ hatchIds: ["unmeasured-figures"] }),
        raw: figureAnswer({ measurements: [] }),
      }),
    );
    expect(answer.measurements).toEqual([]);
  });

  it("still refuses with the old variable set and no grant", () => {
    const env = envWithoutGrant({ variables: { SLOPWEAVER_ALLOW_UNMEASURED_FIGURES: "1" } });
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env,
      raw: figureAnswer({ measurements: [] }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('"227" is asserted here with nothing saying how it was measured');
  });

  it("REFUSES a measurement naming a figure the answer never asserts, with no override in the line", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: envGranting({ hatchIds: ["unmeasured-figures"] }),
      raw: figureAnswer({
        measurements: [
          {
            figures: ["999"],
            repro: "slopweaver atlas datadog --monitors --unfired",
            takenAtIso: "2026-09-20T07:00:00.000Z",
          },
        ],
      }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("measurements.0.figures.0:");
    expect(errors[0]).toContain('"999" is measured here and asserted nowhere in the answer');
    expect(errors[0]).not.toContain("slopweaver hatch open");
  });

  it("REFUSES a second entry covering a figure an earlier one covers, with no override in the line", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: envGranting({ hatchIds: ["unmeasured-figures"] }),
      raw: figureAnswer({
        measurements: [
          { figures: ["227"], repro: "slopweaver atlas datadog --unfired", takenAtIso: "2026-09-20T07:00:00.000Z" },
          { figures: ["227"], repro: "slopweaver atlas datadog --again", takenAtIso: "2026-09-20T07:05:00.000Z" },
        ],
      }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("measurements.1.figures.0:");
    expect(errors[0]).toContain('"227" is already covered by an earlier `measurements` entry');
    expect(errors[0]).not.toContain("slopweaver hatch open");
  });

  it("REFUSES an entry with an empty figures list at the schema, before any scan runs", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: CLEAN_FIGURE_ENV,
      raw: figureAnswer({
        measurements: [{ figures: [], repro: "a command", takenAtIso: "2026-09-20T07:00:00.000Z" }],
      }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("measurements.0.figures");
  });
});
