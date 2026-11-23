/**
 * The value sample as the owner sees it: the card's slug and wording, and the page fragment, whose every string is
 * data and so escaped. Synthetic asks only.
 */
import { describe, expect, it } from "vitest";

import { valueSampleAsk, valueSampleAskArgv, valueSampleFragment, valueSampleSlug } from "../../../value/render.js";
import type { SampledAsk } from "../../../value/sample.js";
import type { ValueSample } from "../../../value/store.js";

/** One drawn ask answered in a thread, its cost measured. */
const drawn = (over: Partial<SampledAsk> = {}): SampledAsk => ({
  artifact: undefined,
  cost: { known: true, value: { coveredTurns: 9, totalTurns: 10, transcripts: 2, units: 1_234_567.4 } },
  prUrls: [],
  prs: [],
  settledIso: "2026-11-20T00:00:00.000Z",
  settlement: "answered",
  slug: "acme-ask",
  summary: "Export the widget report",
  witness: "https://acme.slack.com/archives/C0FIXTURE/p1",
  ...over,
});

/** A sample of the given asks for week 48. */
const sample = (over: Partial<ValueSample> = {}): ValueSample => ({
  answers: {},
  asks: [drawn()],
  drawnIso: "2026-11-23T07:00:00.000Z",
  eligible: 7,
  schemaVersion: 1,
  week: "2026-W48",
  ...over,
});

describe("valueSampleSlug", () => {
  it("names the week's card and page in lower case", () => {
    expect(valueSampleSlug({ week: "2026-W48" })).toBe("value-sample-2026-w48");
  });
});

describe("valueSampleAsk", () => {
  it("asks about each drawn ask, out of how many ended, and leans on answering each", () => {
    const card = valueSampleAsk({ day: "2026-11-23", sample: sample({ asks: [drawn(), drawn({ slug: "b" })] }) });
    expect(card.slug).toBe("value-sample-2026-w48");
    expect(card.lean).toBe("answer each");
    expect(card.ask).toBe(
      "Did you use the 2 asks drawn from last week? Answer each on the page: used, not used, or not yet.",
    );
    expect(card.problem).toContain("drawn at random from the 7 that ended");
    expect(card.stillReal).toBe("value sample drew these on 2026-11-23");
  });

  it("says 1 ask, never 1 asks", () => {
    expect(valueSampleAsk({ day: "2026-11-23", sample: sample() }).ask).toContain("the 1 ask drawn");
  });
});

describe("valueSampleAskArgv", () => {
  it("registers the card as an ask under the home it names, its options one per line", () => {
    const card = valueSampleAsk({ day: "2026-11-23", sample: sample() });
    const argv = valueSampleAskArgv({ ask: card, home: "/h" });
    expect(argv.slice(0, 5)).toEqual(["node", "slopweaver", "handover", "register", "--ask"]);
    expect(argv.slice(-2)).toEqual(["--home", "/h"]);
    expect(argv[argv.indexOf("--options") + 1]).toBe(card.options.join("\n"));
    expect(argv[argv.indexOf("--slug") + 1]).toBe("value-sample-2026-w48");
  });
});

describe("valueSampleFragment", () => {
  it("prints the cost grouped and rounded, and a thread answer as a link", () => {
    const fragment = valueSampleFragment({ sample: sample() });
    expect(fragment).toContain("<h1>Value sample, 2026-W48</h1>");
    expect(fragment).toContain("cost: 1,234,567 model-weighted units over 2 transcripts, 9 of 10 turns priced");
    expect(fragment).toContain(
      'ended answered, <a href="https://acme.slack.com/archives/C0FIXTURE/p1">the answer</a> at 2026-11-20T00:00:00.000Z',
    );
    expect(fragment).toContain("your answer: not yet given");
  });

  it("says why a cost is not measured, and names a filed ask's doc and each pull request's state", () => {
    const filed = drawn({
      cost: { known: false, why: "no seat was spawned for it" },
      prUrls: ["https://github.com/acme/widgets/pull/1", "https://github.com/acme/widgets/pull/2"],
      prs: [
        { state: "MERGED", url: "https://github.com/acme/widgets/pull/1" },
        { state: "UNREAD", url: "https://github.com/acme/widgets/pull/2" },
      ],
      settlement: "filed",
      witness: "acme-doc",
    });
    const fragment = valueSampleFragment({ sample: sample({ asks: [filed] }) });
    expect(fragment).toContain("cost: not measured, no seat was spawned for it");
    expect(fragment).toContain("ended filed, as <code>acme-doc</code>");
    expect(fragment).toContain(">https://github.com/acme/widgets/pull/1</a>, merged");
    expect(fragment).toContain(">https://github.com/acme/widgets/pull/2</a>, state could not be read");
  });

  it("shows a recorded answer", () => {
    const answered = sample({ answers: { "acme-ask": { answer: "not-used", answeredIso: "t" } } });
    expect(valueSampleFragment({ sample: answered })).toContain("your answer: <strong>not-used</strong>");
  });

  it("escapes every string the page carries, never rendering one as markup", () => {
    const hostile = drawn({ summary: "<script>x</script>", witness: 'javascript:"x"', settlement: "filed" });
    const fragment = valueSampleFragment({ sample: sample({ asks: [hostile] }) });
    expect(fragment).toContain("<h2>&lt;script&gt;x&lt;/script&gt;</h2>");
    expect(fragment).not.toContain("<script>");
    expect(fragment).toContain("ended filed, as <code>javascript:&quot;x&quot;</code>");
  });
});
