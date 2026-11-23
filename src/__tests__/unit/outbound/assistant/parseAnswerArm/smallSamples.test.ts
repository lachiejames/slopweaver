/*
 * `parseAnswerArm` end to end on a small sample: a declared figure under the threshold is refused unless its
 * own sentence states its n, with no way past, and an unused or duplicated declaration is refused too. It
 * moved here when `parseAnswerArm.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";
// register-class: outbound-small-sample-figure-stated-without-its-n

import { unwrap } from "../../../../../lib/result.js";
import { parseAnswerArm } from "../../../../../outbound/assistant/answerForm.js";
import { answerRaw, NO_CONTEXT } from "./harness.js";

describe("parseAnswerArm — a small-sample figure states its n in the same sentence", () => {
  /** One `answer` arm asserting a decimal-seconds figure in its lead, with whatever samples a case declares. */
  function sampledAnswer({ leadText, samples }: { leadText: string; samples: readonly unknown[] }): unknown {
    return {
      ...(answerRaw({ bodyText: "the evidence is below", leadText }) as Record<string, unknown>),
      samples,
    };
  }

  it("REFUSES the class-C lead with no way past it, naming the lead and the fix", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: {},
      raw: sampledAnswer({ leadText: "checkout p50 is 12.4s every day", samples: [{ figure: "12.4s", n: 6 }] }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("lead:");
    expect(errors[0]).toContain('"12.4s" was computed over n=6');
    expect(errors[0]).not.toContain("slopweaver hatch open");
  });

  it("accepts the same lead once it carries the n, and keeps the declaration on the parsed arm", () => {
    const answer = unwrap(
      parseAnswerArm({
        context: NO_CONTEXT,
        env: {},
        raw: sampledAnswer({ leadText: "checkout p50 is 12.4s (n=6)", samples: [{ figure: "12.4s", n: 6 }] }),
      }),
    );
    expect(answer.samples).toEqual([{ figure: "12.4s", n: 6 }]);
  });

  it("leaves samples ABSENT when none is declared, so an answer's parsed digest does not move", () => {
    const answer = unwrap(
      parseAnswerArm({ context: NO_CONTEXT, env: {}, raw: answerRaw({ bodyText: "fine", leadText: "fine" }) }),
    );
    expect(Object.keys(answer).includes("samples")).toBe(false);
  });

  it("REFUSES a declared sample the answer never asserts, and a figure declared twice", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: {},
      raw: sampledAnswer({
        leadText: "checkout p50 is 12.4s (n=6)",
        samples: [
          { figure: "12.4s", n: 6 },
          { figure: "4.2s", n: 9 },
          { figure: "12.4s", n: 6 },
        ],
      }),
    })._unsafeUnwrapErr();
    expect(errors).toEqual([
      'samples.1.figure: "4.2s" is declared as a sample and asserted nowhere in the lead, the index or the body. Spell the figure exactly as the answer writes it, or delete the entry.',
      'samples.2.figure: "12.4s" is already declared by an earlier `samples` entry. One figure has one n: delete this entry.',
    ]);
  });

  it("REFUSES a non-integer n at the schema, before any scan runs", () => {
    const errors = parseAnswerArm({
      context: NO_CONTEXT,
      env: {},
      raw: sampledAnswer({ leadText: "checkout p50 is 12.4s (n=6)", samples: [{ figure: "12.4s", n: 6.5 }] }),
    })._unsafeUnwrapErr();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("samples.0.n");
  });
});
