/*
 * The board reader used to return only the FIRST PHYSICAL LINE of a front-matter scalar, so every value its
 * author had wrapped came back as a fragment: a row whose `summary:` ran past one line was handed up ending
 * exactly where the YAML line wrapped, while a quoted one-line summary beside it came through whole.
 *
 * The two-style pair below is the case that matters and is written first for that reason: the quoted style
 * ALREADY passed before the fix, so a suite that only tested it would have stayed green through the whole
 * defect. Asserting both spellings of the same sentence produce the same string is what makes the folded
 * style falsifiable.
 */

import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields } from "../../../handover/frontmatter.js";
import { FrontMatterErrors } from "../../../handover/frontmatterErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const SENTENCE =
  'The capacity board (dashboard syn-000-brd, "Capacity — queue depth by region") has a whole tile row reading ' +
  "No data, a blank chart, and a heatmap with a parse error.";

function read({ text }: { text: string }): ReturnType<typeof parseHandoverDoc> {
  return parseHandoverDoc({ path: "/board/row.md", text });
}

describe("a front-matter scalar its author wrapped", () => {
  it("reads the same sentence from a folded plain scalar and from a quoted one-liner", () => {
    const folded = read({
      text:
        '---\nslug: row\nsummary: The capacity board (dashboard syn-000-brd, "Capacity — queue depth by region") has a whole tile row reading\n' +
        "  No data, a blank chart, and a heatmap with a parse error.\nstatus: ready\n---\n",
    });
    const quoted = read({
      text: `---\nslug: row\nsummary: ${SENTENCE}\nstatus: ready\n---\n`,
    });
    expect(folded.summary).toBe(SENTENCE);
    expect(quoted.summary).toBe(SENTENCE);
    expect(folded.summary).toBe(quoted.summary);
  });

  it("keeps reading the key that follows the wrapped one", () => {
    const parsed = read({
      text: "---\nslug: row\nsummary: first line\n  second line\nstatus: ready\nrepo: /repo\n---\n",
    });
    expect(parsed.summary).toBe("first line second line");
    expect(parsed.status).toBe("ready");
    expect(parsed.repo).toBe("/repo");
    expect(parsed.problems).toEqual([]);
  });

  it("drops a `>` block indicator and returns the lines below it, not the character", () => {
    const parsed = read({
      text: "---\nslug: row\nstatusSummary: >\n  Runnable now. acme-admin, team-facing — Linear\n  ticket first, PR against staging.\nstatus: ready\n---\n",
    });
    expect(parsed.statusSummary).toBe(
      "Runnable now. acme-admin, team-facing — Linear ticket first, PR against staging.",
    );
  });

  it("drops a `|` indicator and its chomping variants the same way", () => {
    const literal = read({ text: "---\nslug: row\nsummary: |\n  one\n  two\nstatus: ready\n---\n" });
    const chomped = read({ text: "---\nslug: row\nsummary: >-\n  one\n  two\nstatus: ready\n---\n" });
    expect(literal.summary).toBe("one two");
    expect(chomped.summary).toBe("one two");
  });

  it("leaves a doc with no wrapped scalar byte-identical to what it always read", () => {
    const parsed = read({ text: "---\nslug: row\nsummary: `distil` reads every row: twice\nstatus: ready\n---\n" });
    expect(parsed.summary).toBe("`distil` reads every row: twice");
  });

  it("never folds a doneWhen: command block into the scalar above it", () => {
    const parsed = read({
      text:
        "---\nslug: row\nsummary: a wrapped sentence\n  that continues\ndoneWhen:\n  - command: |\n      echo one\n      echo two\n" +
        "status: ready\n---\n",
    });
    expect(parsed.summary).toBe("a wrapped sentence that continues");
    expect(parsed.doneWhen.length).toBe(1);
  });

  it("still reports a repeated key, and does not let the repeat's own wrapped lines resolve it", () => {
    const parsed = read({
      text: "---\nslug: row\nblockedBy: [first]\nblockedBy:\n  - second\nstatus: ready\n---\n",
    });
    expect(parsed.problems).toEqual(['front-matter declares "blockedBy" more than once — which one is meant?']);
    expect(parsed.blockedBy).toEqual(["first"]);
  });
});

/*
 * `blockedBy:` is where the same defect stopped being cosmetic. TWELVE live docs wrote their dependency as
 * a block sequence under a bare `blockedBy:` and the reader saw an empty value, so every one of them lost a
 * declared dependency — the silent-drop the duplicate-key check was hardened against, arriving through the
 * other door. Count the population:
 * awk '/^blockedBy:$/{f=1;next} f&&/^ +- /{print FILENAME; f=0} /^[A-Za-z]/{f=0}' ~/.slopweaver/handovers/*.md | sort -u | wc -l
 *
 * Two of the twelve were being offered as runnable: self-improve-5-skill-and-daily-slot and
 * self-improve-6-grades left RUN NOW when this landed. Measured by running the shipped `handover list
 * --all` from both checkouts against ONE frozen copy of the board — reading the LIVE board twice put a
 * third row in the delta that had merely been registered between the reads.
 */
describe("a blockedBy: written as a block sequence", () => {
  it("reads the same dependencies as the flow spelling", () => {
    const block = read({
      text: "---\nslug: row\nblockedBy:\n  - first-thing\n  - second-thing\nstatus: ready\n---\n",
    });
    const flow = read({ text: "---\nslug: row\nblockedBy: [first-thing, second-thing]\nstatus: ready\n---\n" });
    expect(block.blockedBy).toEqual(["first-thing", "second-thing"]);
    expect(block.blockedBy).toEqual(flow.blockedBy);
  });

  it("reads a single-entry block sequence without keeping its dash", () => {
    const parsed = read({ text: "---\nslug: row\nblockedBy:\n  - only-thing\nstatus: ready\n---\n" });
    expect(parsed.blockedBy).toEqual(["only-thing"]);
  });

  it("leaves an empty blockedBy: empty", () => {
    const parsed = read({ text: "---\nslug: row\nblockedBy: []\nstatus: ready\n---\n" });
    expect(parsed.blockedBy).toEqual([]);
  });
});

/*
 * The write path has to move with the read path. `handover pause` rewrites `statusSummary:`, and nineteen
 * live docs hold theirs entirely in the indented lines below the key — so replacing only the key's own line
 * left those lines orphaned under the new value. Harmless while the reader ignored them; a silent splice of
 * the old text onto the new one the moment it started folding them.
 */
describe("editFrontMatterFields over a wrapped scalar", () => {
  const WRAPPED =
    "---\nslug: row\nstatusSummary: >\n  the old reason\n  wrapped over two lines\nstatus: ready\n---\n\n# body\n";

  it("replaces a block scalar with exactly the value passed, dropping its old lines", () => {
    const edited = unwrap(
      editFrontMatterFields({
        path: "/board/row.md",
        remove: [],
        set: [
          { key: "status", value: "paused" },
          { key: "statusSummary", value: "waiting on the owner" },
        ],
        text: WRAPPED,
      }),
    );
    expect(edited).toBe("---\nslug: row\nstatusSummary: waiting on the owner\nstatus: paused\n---\n\n# body\n");
    expect(read({ text: edited }).statusSummary).toBe("waiting on the owner");
  });

  it("removes a wrapped key's continuation lines with the key", () => {
    const edited = unwrap(
      editFrontMatterFields({ path: "/board/row.md", remove: ["statusSummary"], set: [], text: WRAPPED }),
    );
    expect(edited).toBe("---\nslug: row\nstatus: ready\n---\n\n# body\n");
  });

  it("leaves a neighbouring key's own wrapped lines alone", () => {
    const edited = unwrap(
      editFrontMatterFields({
        path: "/board/row.md",
        remove: [],
        set: [{ key: "status", value: "paused" }],
        text: WRAPPED,
      }),
    );
    expect(read({ text: edited }).statusSummary).toBe("the old reason wrapped over two lines");
    expect(read({ text: edited }).status).toBe("paused");
  });
});

/*
 * The read-back a destructive path owes. `editFrontMatterFields` is the only code here that REWRITES a line
 * of someone's front-matter, and the board it runs against has no restore — the one off-machine copy of
 * $SLOPWEAVER_HOME is a git snapshot holding 190 of 1,580 handover files, with thousands of
 * changes uncommitted since (measured by the `board-state-cannot-be-forgotten` run; check with
 * `git -C ~/.slopweaver log -1 --format=%cs && git -C ~/.slopweaver status --porcelain | wc -l`).
 */
describe("editFrontMatterFields refuses to damage what it was not asked to touch", () => {
  const DOC = "---\nslug: row\nsummary: the real summary\nstatus: ready\n---\n\n# body\n";

  it("refuses a value that would smuggle a second declaration of another key", () => {
    const refused = unwrapErr(
      editFrontMatterFields({
        path: "/board/row.md",
        remove: [],
        set: [{ key: "status", value: "paused\nsummary: hijacked" }],
        text: DOC,
      }),
    );
    expect(refused.code).toBe("VALUE_HAS_LINE_BREAK");
    expect(refused.reasons).toEqual(['"status" carries a line break, and front-matter is read line by line']);
  });

  it("refuses a nested value that would smuggle a second declaration of another key", () => {
    const refused = unwrapErr(
      editFrontMatterFields({
        path: "/board/row.md",
        remove: [],
        set: [{ key: "examples", value: "\n  - a\nsummary: hijacked" }],
        text: DOC,
      }),
    );
    expect(refused).toEqual(FrontMatterErrors.nestedLineUnindented({ keys: ["examples"] }));
  });

  it("still allows an ordinary edit that leaves a doc mid-composition", () => {
    const edited = unwrap(
      editFrontMatterFields({
        path: "/board/row.md",
        remove: [],
        set: [{ key: "status", value: "paused" }],
        text: DOC,
      }),
    );
    expect(edited).toBe("---\nslug: row\nsummary: the real summary\nstatus: paused\n---\n\n# body\n");
  });
});
