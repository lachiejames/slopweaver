/**
 * `value answer` end to end over a throwaway home: an answer lands in the week's file, the last one withdraws the
 * card, and a conflicting or unknown answer is refused with the file left as it was. The card withdrawal is a plain
 * fake passed in, so no handover state is touched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap } from "#lib/result.js";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { runValueAnswer, type ValueAnswerDeps } from "../../../../../cli/commands/value/answer.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { SampledAsk } from "../../../../../value/sample.js";
import { readSample, type ValueSample, writeSample } from "../../../../../value/store.js";

const NOW = "2026-11-24T09:00:00.000Z";

/** One drawn ask, its cost not measured. */
const drawn = ({ slug }: { slug: string }): SampledAsk => ({
  artifact: undefined,
  cost: { known: false, why: "no seat" },
  prUrls: [],
  prs: [],
  settledIso: "2026-11-20T00:00:00.000Z",
  settlement: "filed",
  slug,
  summary: "Export the widget report",
  witness: "acme-doc",
});

/** Week 48's two-ask sample, unanswered. */
const SAMPLE: ValueSample = {
  answers: {},
  asks: [drawn({ slug: "acme-a" }), drawn({ slug: "acme-b" })],
  drawnIso: "2026-11-23T07:00:00.000Z",
  eligible: 2,
  schemaVersion: 1,
  week: "2026-W48",
};

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A home holding week 48's sample, plus the verb's captured output and every card withdrawal it asked for. */
const harness = (): {
  home: string;
  out: string[];
  diagnostics: string[];
  withdrawn: string[];
  deps: ValueAnswerDeps;
} => {
  const home = mkdtempSync(join(tmpdir(), "value-answer-"));
  homes.push(home);
  unwrap(writeSample({ home, sample: SAMPLE }));
  const out: string[] = [];
  const diagnostics: string[] = [];
  const withdrawn: string[] = [];
  return {
    deps: {
      nowIso: () => NOW,
      withdrawCard: ({ slug }) => {
        withdrawn.push(slug);
        return Promise.resolve(ok("withdrawn" as const));
      },
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    home,
    out,
    withdrawn,
  };
};

/** The argv tail for one answer against the harness home. */
const answerArgs = ({ answer, home, slug }: { answer: string; home: string; slug: string }): readonly string[] => [
  "--slug",
  slug,
  "--answer",
  answer,
  "--week",
  "2026-W48",
  "--home",
  home,
];

describe("value answer", () => {
  it("records a first answer and keeps the card while an ask is still unanswered", async () => {
    const run = harness();
    const code = await runValueAnswer({
      deps: run.deps,
      rest: answerArgs({ answer: "used", home: run.home, slug: "acme-a" }),
    });
    expect(code).toBe(EXIT_OK);
    expect(run.out).toEqual(["value answer: recorded acme-a used for 2026-W48, 1 still unanswered, card still-asking"]);
    expect(run.withdrawn).toEqual([]);
    expect(unwrap(readSample({ home: run.home, week: "2026-W48" }))!.answers).toEqual({
      "acme-a": { answer: "used", answeredIso: NOW },
    });
  });

  it("withdraws the week's card once the last ask is answered", async () => {
    const run = harness();
    await runValueAnswer({ deps: run.deps, rest: answerArgs({ answer: "used", home: run.home, slug: "acme-a" }) });
    const code = await runValueAnswer({
      deps: run.deps,
      rest: answerArgs({ answer: "not-yet", home: run.home, slug: "acme-b" }),
    });
    expect(code).toBe(EXIT_OK);
    expect(run.withdrawn).toEqual(["value-sample-2026-w48"]);
    expect(run.out.at(-1)).toBe(
      "value answer: recorded acme-b not-yet for 2026-W48, 0 still unanswered, card withdrawn",
    );
  });

  it("takes the same answer again as already recorded", async () => {
    const run = harness();
    await runValueAnswer({ deps: run.deps, rest: answerArgs({ answer: "used", home: run.home, slug: "acme-a" }) });
    await runValueAnswer({ deps: run.deps, rest: answerArgs({ answer: "used", home: run.home, slug: "acme-a" }) });
    expect(run.out.at(-1)).toBe(
      "value answer: already recorded acme-a used for 2026-W48, 1 still unanswered, card still-asking",
    );
  });

  it("refuses a different answer and leaves the recorded one in the file", async () => {
    const run = harness();
    await runValueAnswer({ deps: run.deps, rest: answerArgs({ answer: "used", home: run.home, slug: "acme-a" }) });
    const code = await runValueAnswer({
      deps: run.deps,
      rest: answerArgs({ answer: "not-used", home: run.home, slug: "acme-a" }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual([
      "value answer: acme-a is already answered used; refusing not-used — a recorded answer is never replaced",
    ]);
    expect(unwrap(readSample({ home: run.home, week: "2026-W48" }))!.answers["acme-a"]!.answer).toBe("used");
  });

  it("refuses a week with no sample, naming the verb that draws one", async () => {
    const run = harness();
    const rest = ["--slug", "acme-a", "--answer", "used", "--week", "2026-W47", "--home", run.home];
    expect(await runValueAnswer({ deps: run.deps, rest })).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual(["value answer: no sample was drawn for 2026-W47; run value sample first"]);
  });

  it("refuses while another answer to the same week holds its lock, writing nothing", async () => {
    const run = harness();
    const held = unwrap(acquireOperationLock({ home: run.home, key: "value-sample:2026-W48", nowIso: NOW }));
    try {
      const code = await runValueAnswer({
        deps: run.deps,
        rest: answerArgs({ answer: "used", home: run.home, slug: "acme-a" }),
      });
      expect(code).toBe(EXIT_ERROR);
      expect(run.diagnostics[0]).toContain("value answer: another answer for 2026-W48 is being recorded");
      expect(unwrap(readSample({ home: run.home, week: "2026-W48" }))!.answers).toEqual({});
    } finally {
      held.release();
    }
  });

  it("refuses an answer outside the three as usage, before reading anything", async () => {
    const run = harness();
    const code = await runValueAnswer({
      deps: run.deps,
      rest: answerArgs({ answer: "maybe", home: run.home, slug: "acme-a" }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toBe("value answer: --answer must be one of used, not-used, not-yet");
  });
});
