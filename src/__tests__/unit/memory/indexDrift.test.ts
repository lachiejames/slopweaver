/**
 * `index-line-drift` — identifiers only, and the notation shapes the measurement found firing on
 * numbers and code spans, kept as clean controls so neither comes back.
 */
import { describe, expect, it } from "vitest";

import { buildMemoryCorpus } from "../../../memory/corpus.js";
import { hookTokens, indexLineDriftFindings, leafCarriesToken } from "../../../memory/indexDrift.js";

/** A leaf whose frontmatter description is `description` and body is `body`. */
function leaf({ description, body }: { description: string; body: string }): string {
  return `---\nname: thing\ndescription: ${description}\nmetadata:\n  type: reference\n---\n\n${body}\n`;
}

/** The drift findings for a root index `index` over one leaf, `thing.md`. */
function drift({ index, text }: { index: string; text: string }): readonly string[] {
  const corpus = buildMemoryCorpus({
    files: [
      { file: "MEMORY.md", text: index },
      { file: "thing.md", text },
    ],
  });
  return indexLineDriftFindings({ corpus }).map((finding) => finding.message);
}

describe("hookTokens", () => {
  it("takes dates, turn ids, pull requests and mid-sentence names, in pass order", () => {
    expect(hookTokens({ hook: "decided on 29 Sep 2026-09-30 in 249-6 about #1609, per Slack" })).toEqual([
      { kind: "iso-date", text: "2026-09-30" },
      { kind: "date", text: "29 Sep" },
      { kind: "turn", text: "249-6" },
      { kind: "pull", text: "#1609" },
      { kind: "name", text: "Slack" },
    ]);
  });

  it("reads an ISO date whole, never as a turn id inside it", () => {
    expect(hookTokens({ hook: "since 2026-09-29" })).toEqual([{ kind: "iso-date", text: "2026-09-29" }]);
  });

  it("reads a D Mon date carrying a longer month spelling as its short form", () => {
    expect(hookTokens({ hook: "moved on 6 September" })).toEqual([{ kind: "date", text: "6 Sep" }]);
  });

  it("reads no bare number and nothing inside a code span — both measured as paraphrase, never drift", () => {
    expect(
      hookTokens({ hook: "exactly 3 rows, the 1200 cap, ~1/20, 13:2xZ, `turn answer --print-digest` per `Slack`" }),
    ).toEqual([]);
  });

  it("reads no two-digit range as a turn id, and no count whose noun starts like a month as a date", () => {
    expect(hookTokens({ hook: "takes 10-15 rows, 3 separate runs, 2 decisions" })).toEqual([]);
  });

  it("reads no clause opening after a colon or semicolon as a name", () => {
    expect(hookTokens({ hook: "rule: Never buy; Ask first" })).toEqual([]);
  });

  it("does not read the hook's first word, or a word opening a sentence, as a name", () => {
    expect(hookTokens({ hook: "Never card it. Ask first" })).toEqual([]);
  });
});

describe("leafCarriesToken", () => {
  it("finds a pull request by its number, however the memory writes it", () => {
    expect(leafCarriesToken({ text: "landed as PR 1609", token: { kind: "pull", text: "#1609" } })).toBe(true);
  });

  it("does not find a turn id inside a longer one", () => {
    expect(leafCarriesToken({ text: "owner turn 249-61", token: { kind: "turn", text: "249-6" } })).toBe(false);
  });

  it("finds a short-month date written with the whole month", () => {
    expect(leafCarriesToken({ text: "on 6 September 2026", token: { kind: "date", text: "6 Sep" } })).toBe(true);
  });

  it("does not find a date inside a later day of the same month", () => {
    expect(leafCarriesToken({ text: "on 16 Sep 2026", token: { kind: "date", text: "6 Sep" } })).toBe(false);
  });
});

describe("indexLineDriftFindings", () => {
  it("fires when the index line names an identifier the memory lacks", () => {
    expect(
      drift({
        index: "- [Thing](thing.md) — decided in 249-6\n",
        text: leaf({ body: "The rule.", description: "a rule" }),
      }),
    ).toEqual([
      "the MEMORY.md line routing this memory says `249-6`, and nothing in the memory carries that — the line that loads every session and the memory it points at disagree",
    ]);
  });

  it("counts an identifier the memory carries only in its description", () => {
    expect(
      drift({
        index: "- [Thing](thing.md) — decided in 249-6\n",
        text: leaf({ body: "The rule.", description: "a rule (249-6)" }),
      }),
    ).toEqual([]);
  });

  it("stays silent on the measured notation shapes", () => {
    const index =
      "- [Thing](thing.md) — exactly 3 rows under the 1200 cap; validate with `turn answer --print-digest`\n";
    const text = leaf({
      body: "Exactly three rows, under the 1,200 cap. Validate with `slopweaver turn answer --answer <file> --print-digest`.",
      description: "a rule",
    });

    expect(drift({ index, text })).toEqual([]);
  });

  it("judges no outside pointer and no dead pointer", () => {
    const index = "- [Out](../elsewhere.md) — per Slack\n- [Gone](gone.md) — per Slack\n";

    expect(drift({ index, text: leaf({ body: "The rule.", description: "a rule" }) })).toEqual([]);
  });

  it("does not judge a topic index — the pinned residue, since only the root loads at boot", () => {
    const corpus = buildMemoryCorpus({
      files: [
        { file: "MEMORY.md", text: "- [Topic](INDEX-topic.md) — the topic\n" },
        { file: "INDEX-topic.md", text: "- [Thing](thing.md) — decided in 249-6\n" },
        { file: "thing.md", text: leaf({ body: "The rule.", description: "a rule" }) },
      ],
    });

    expect(indexLineDriftFindings({ corpus })).toEqual([]);
  });

  it("reports each missing identifier on its own, so repairing one leaves the other's message unchanged", () => {
    const index = "- [Thing](thing.md) — decided in 249-6, per Slack\n";
    const message = ({ token }: { token: string }): string =>
      `the MEMORY.md line routing this memory says \`${token}\`, and nothing in the memory carries that — the line that loads every session and the memory it points at disagree`;

    expect(drift({ index, text: leaf({ body: "The rule.", description: "a rule" }) })).toEqual([
      message({ token: "249-6" }),
      message({ token: "Slack" }),
    ]);
    expect(drift({ index, text: leaf({ body: "The rule, per Slack.", description: "a rule" }) })).toEqual([
      message({ token: "249-6" }),
    ]);
  });

  it("reports both drifts when two root lines route one memory, whichever order they sit in", () => {
    const text = leaf({ body: "The rule.", description: "a rule" });
    const forward = drift({ index: "- [A](thing.md) — in 249-6\n- [B](thing.md) — per Slack\n", text });
    const reversed = drift({ index: "- [B](thing.md) — per Slack\n- [A](thing.md) — in 249-6\n", text });

    expect(forward).toHaveLength(2);
    expect([...reversed].toSorted()).toEqual([...forward].toSorted());
  });

  it("reads no weekday or month as a name", () => {
    expect(hookTokens({ hook: "deploy on Fridays, never in December, nor on a Mon in Sep" })).toEqual([]);
  });

  it("reports one finding for a memory the root routes twice with the same drift", () => {
    const index = "- [Thing](thing.md) — in 249-6\n- [Thing again](thing.md) — in 249-6\n";

    expect(drift({ index, text: leaf({ body: "The rule.", description: "a rule" }) })).toHaveLength(1);
  });
});
