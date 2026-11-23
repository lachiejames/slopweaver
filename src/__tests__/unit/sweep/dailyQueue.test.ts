/**
 * The board sweep's daily Queue card: one decision a day about a page the owner asked for that never reached them,
 * named in the question, and nothing on a pass with no UNCARDED row — a SHIPPED row is closed by `--close-shipped`,
 * never carded. Its shape is held to the caps `handover register` refuses on.
 */
import { describe, expect, it } from "vitest";
import { sentenceCount } from "../../../briefing/sentences.js";
import { wordCount } from "../../../briefing/text.js";
import { askExampleProblems } from "../../../handover/askExamples.js";
import { askShapeProblems, parseAskOptions } from "../../../handover/askShape.js";
import { askHtmlProblems, bareHtmlFiles } from "../../../handover/cardHtml.js";
import { askImageProblems, namedImageFiles } from "../../../handover/cardImage.js";
import { fleetSignInProviders } from "../../../handover/fleetSignInGate.js";
import type { SweepCandidate } from "../../../sweep/classify.js";
import { isSweepQueueSlug, sweepQueuePlan, sweepQueueSlug } from "../../../sweep/dailyQueue.js";

const HOME = "/h/home";
const NOW = "2026-11-03T07:00:00.000Z";

function candidate({ slug, verdict, witness }: Pick<SweepCandidate, "slug" | "verdict" | "witness">): SweepCandidate {
  return { act: "none", path: `/h/${slug}.md`, slug, verdict, witness };
}

function uncarded({ slug, page }: { slug: string; page: string }): SweepCandidate {
  return candidate({
    slug,
    verdict: "UNCARDED",
    witness: `settled answered with witness page:${page}; page:${page} never reached the owner's Queue`,
  });
}

const UNCARDED = uncarded({ page: "acme-plan-page-17-nov", slug: "plan-usage-strategy" });
const SHIPPED = candidate({ slug: "landed-row", verdict: "SHIPPED", witness: "closed at 2026-11-02T10:00:00.000Z" });

/** The value one flag carries in an argv. */
function flagValue({ argv, name }: { argv: readonly string[]; name: string }): string {
  return argv[argv.indexOf(name) + 1]!;
}

/** Every refusal `handover register` would raise on one example's TEXT. */
function admissionProblems({ example }: { example: string }): readonly string[] {
  const fields = [{ label: "example 1", text: example }];
  return [
    ...askExampleProblems({ examples: [example], gap: undefined }),
    ...askImageProblems({ fields }),
    ...askHtmlProblems({ fields }),
    ...fleetSignInProviders({ text: example }),
  ];
}

/** The question's own shape: [sentences, words, ends on a question mark]. */
function questionShape({ question }: { question: string }): readonly [number, number, boolean] {
  return [sentenceCount({ text: question }), wordCount({ text: question }), question.endsWith("?")];
}

describe("sweepQueueSlug", () => {
  it("names the card by the instant's UTC day", () => {
    expect(sweepQueueSlug({ nowIso: "2026-11-03T23:59:59.999Z" })).toBe("sweep-board-2026-11-03");
  });
});

describe("isSweepQueueSlug", () => {
  it.each([
    { expected: true, slug: "sweep-board-2026-01-09" },
    { expected: false, slug: "sweep-board-daily" },
    { expected: false, slug: "sweep-board-2026-01-09-retry" },
    { expected: false, slug: "sweep-board-" },
    { expected: false, slug: "acme-codex-host-gaps" },
  ])("reads $slug as the sweep's own card: $expected", ({ expected, slug }) => {
    expect(isSweepQueueSlug({ slug })).toBe(expected);
  });
});

describe("sweepQueuePlan", () => {
  it("plans nothing for a pass with no UNCARDED row", () => {
    const quiet = [candidate({ slug: "a", verdict: "UNWITNESSED", witness: "no probe" })];
    expect(sweepQueuePlan({ candidates: quiet, home: HOME, nowIso: NOW })).toBe(undefined);
  });

  // A daily card once asked the owner to close `acme-codex-host-gaps`, a row whose own witness said shipped.
  it("plans nothing for SHIPPED rows alone — they are closed, never carded", () => {
    const shipped = [SHIPPED, candidate({ slug: "acme-codex-host-gaps", verdict: "SHIPPED", witness: "in" })];
    expect(sweepQueuePlan({ candidates: shipped, home: HOME, nowIso: NOW })).toBe(undefined);
  });

  it("counts distinct pages, so two closed rows delivering one page count once", () => {
    const again = { ...UNCARDED, slug: "plan-usage-strategy-again" };
    const other = uncarded({ page: "voice-key", slug: "voice-key-row" });
    expect(sweepQueuePlan({ candidates: [UNCARDED, again, other], home: HOME, nowIso: NOW })!.uncarded).toBe(2);
  });

  it("names the page and its row in the question, and offers card or leave", () => {
    const plan = sweepQueuePlan({ candidates: [UNCARDED, SHIPPED], home: HOME, nowIso: NOW })!;
    expect(plan.slug).toBe("sweep-board-2026-11-03");
    expect(plan.uncarded).toBe(1);
    const question = flagValue({ argv: plan.argv, name: "--ask" });
    expect(question).toBe(
      "The page acme-plan-page-17-nov, which you asked for on plan-usage-strategy, was published and that row closed, but it never reached your Queue — card it now?",
    );
    expect(questionShape({ question })).toEqual([1, 25, true]);
    const options = parseAskOptions({ text: flagValue({ argv: plan.argv, name: "--options" }) });
    expect(options.problems).toEqual([]);
    const shape = {
      lean: flagValue({ argv: plan.argv, name: "--lean" }),
      options: options.options,
      problem: flagValue({ argv: plan.argv, name: "--problem" }),
      stakes: {
        blastRadius: flagValue({ argv: plan.argv, name: "--blast-radius" }),
        risk: flagValue({ argv: plan.argv, name: "--risk" }),
        stillReal: flagValue({ argv: plan.argv, name: "--still-real" }),
      },
    };
    expect(askShapeProblems({ shape })).toEqual([]);
    expect(options.options.map((option) => option.option)).toEqual(["Card the page", "Leave it"]);
    const example = flagValue({ argv: plan.argv, name: "--example" });
    expect(example).toBe(
      "You open your Queue and the page you asked plan-usage-strategy for, http://localhost:3000/api/page/acme-plan-page-17-nov/index.html, is not on it, though it was published and the row closed. Should it reach your Queue now?",
    );
    expect(admissionProblems({ example })).toEqual([]);
    expect(flagValue({ argv: plan.argv, name: "--workspace" })).toBe("self");
    expect(flagValue({ argv: plan.argv, name: "--home" })).toBe(HOME);
  });

  it("names the first two pages with their rows and counts the rest, inside the question's caps", () => {
    const rows = [
      uncarded({ page: "a-very-long-page-slug-for-the-cap", slug: "a-very-long-row-slug-for-the-cap" }),
      uncarded({ page: "second-page", slug: "second-row" }),
      uncarded({ page: "third-page", slug: "third-row" }),
      uncarded({ page: "fourth-page", slug: "fourth-row" }),
    ];
    const plan = sweepQueuePlan({ candidates: rows, home: HOME, nowIso: NOW })!;
    const question = flagValue({ argv: plan.argv, name: "--ask" });
    expect(question).toBe(
      "4 pages you asked for were published and their rows closed, but never reached your Queue: a-very-long-page-slug-for-the-cap (from a-very-long-row-slug-for-the-cap), second-page (from second-row) and 2 more — card them now?",
    );
    expect(questionShape({ question })).toEqual([1, 29, true]);
    const options = parseAskOptions({ text: flagValue({ argv: plan.argv, name: "--options" }) });
    expect(options.options.map((option) => option.option)).toEqual(["Card each page", "Leave them"]);
  });

  it("joins exactly two pages with 'and', counting none", () => {
    const rows = [uncarded({ page: "one-page", slug: "one-row" }), uncarded({ page: "two-page", slug: "two-row" })];
    const question = flagValue({
      argv: sweepQueuePlan({ candidates: rows, home: HOME, nowIso: NOW })!.argv,
      name: "--ask",
    });
    expect(question).toBe(
      "2 pages you asked for were published and their rows closed, but never reached your Queue: one-page (from one-row) and two-page (from two-row) — card them now?",
    );
  });

  it("still asks, naming the row, when no page parses out of the witness", () => {
    const row = candidate({ slug: "talk-row", verdict: "UNCARDED", witness: "a witness with no page in it" });
    const plan = sweepQueuePlan({ candidates: [row], home: HOME, nowIso: NOW })!;
    expect(plan.uncarded).toBe(0);
    expect(flagValue({ argv: plan.argv, name: "--ask" })).toBe(
      "The page you asked for on talk-row was published and that row closed, but it never reached your Queue — card it now?",
    );
    expect(admissionProblems({ example: flagValue({ argv: plan.argv, name: "--example" }) })).toEqual([]);
  });

  // A SAFE_SLUG may carry a dot, so the slug alone can trip the picture or HTML gate.
  it.each([{ slug: "report.html" }, { slug: "proof.png" }])(
    "names no row when the slug $slug would trip register",
    ({ slug }) => {
      const named = `You open the board and ${slug} is live. Should it close?`;
      expect([...namedImageFiles({ text: named }), ...bareHtmlFiles({ text: named })]).toEqual([slug]);
      const row = candidate({ slug, verdict: "UNCARDED", witness: "the work is in" });
      const plan = sweepQueuePlan({ candidates: [row], home: HOME, nowIso: NOW })!;
      const example = flagValue({ argv: plan.argv, name: "--example" });
      expect(example).toBe(
        "You open your Queue and a page you asked for is not on it, though it was published and its row closed. Should it reach your Queue now?",
      );
      expect(admissionProblems({ example })).toEqual([]);
      expect(flagValue({ argv: plan.argv, name: "--ask" })).toBe(
        "A page you asked for was published and its row closed, but it never reached your Queue — card it now?",
      );
    },
  );
});
