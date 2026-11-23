/**
 * The two above-the-fold shapes a card carries: a scheduled post's day-one `intro`, and the
 * colour-coded ranked (`ordered`) index. Their bounds and checks live here; `./schema.ts` wires them into the
 * card's refinement, and the scheduled forms share {@link introSchema}.
 */
import { z } from "zod";

import { bareRefIssuesOfPlainText } from "../linkify/bareRefs.js";
import { aboveFoldFindings } from "../voice/aboveFold.js";
import { RANK_GLYPHS } from "./severity.js";
import { rawMarkupIssuesOfText } from "./typedRuns.js";
import type { IndexStyle, InlineRun } from "./types.js";

/** The most day-one intro lines a card may open with — a few lines. */
const INTRO_MAX_LINES = 4;

/**
 * One intro line stays a line: the same 120 as an index line (`INDEX_ITEM_VISIBLE_MAX`), written here rather than
 * imported because `./schema.ts` imports this module. `introField.test.ts` pins the two equal.
 */
export const INTRO_LINE_VISIBLE_MAX = 120;

/**
 * One intro line: every bound the CARD puts on one, so a row's own line is refused where the row is planned.
 *
 * The width is measured with `.length` rather than Zod's own `.max()`, which counts code POINTS: the card
 * measures UTF-16 units, and a line of 61 emoji is 61 points and 122 units — inside one bound and past the other.
 * A plain string holds no typed run, so a raw link, mention or broadcast renders literally, a `[n]` marker names
 * a chip that cannot exist, and a bare `#N` or `SUP-N` can never become the link the door demands — all
 * refused here exactly as the card refuses them. The packing rules run too, against no exact rules: those are
 * the operator's private configuration and belong to the send, while the structural family
 * (`../voice/aboveFold.ts`) is this repository's own and is decidable now.
 *
 * Every one of them is here for the same reason: an intro line refused at the POST leg is refused at every
 * firing, because a row that never exits 0 never records a success and so keeps its day-one intro.
 */
const introLineSchema = z
  .string()
  .min(1)
  .refine((line) => line.length <= INTRO_LINE_VISIBLE_MAX, {
    message: `an intro line is over the ${String(INTRO_LINE_VISIBLE_MAX)}-character cap`,
  })
  .refine((line) => !line.includes("\n"), {
    message: "an intro line carries a line break — give each line its own entry",
  })
  .refine((line) => rawMarkupIssuesOfText({ path: [], text: line }).length === 0, {
    message: "an intro line carries a raw link, mention or broadcast — it is plain text, which renders it literally",
  })
  .refine((line) => !CITATION_MARKER.test(line), {
    message: "an intro line carries a [n] citation marker — a plain-string field holds no citation chip",
  })
  .refine((line) => !namesAReference({ line }), {
    message:
      "an intro line names a ticket, issue or control id — a plain-string field cannot render the link the door " +
      "requires over it, and the door refuses the bare text, so say what it is about in words",
  })
  .refine((line) => aboveFoldFindings({ cells: [{ path: "intro", text: line }], rules: [] }).length === 0, {
    message:
      "an intro line breaks a packing rule above the fold — a colon-introduced list, two clauses joined by a " +
      "semicolon, a second parenthetical aside or an over-long sentence. Write it as plain short sentences",
  });

/**
 * Whether a line names a ticket, issue or control at all — the UNION of what the door can catch.
 *
 * The door's own scanner runs here with an EMPTY context, which catches everything whose candidacy is decided by
 * the text alone (a bare `#N`, and the `merged: 15632` list shape); {@link REFERENCE_SHAPED} covers the rest,
 * whose candidacy the door decides from tables loaded out of `$SLOPWEAVER_HOME` that a pure schema cannot read.
 * Taking the union rather than restating one half is what stops the two drifting apart again.
 */
function namesAReference({ line }: { line: string }): boolean {
  if (bareRefIssuesOfPlainText({ context: { repos: [] }, path: [], text: line }).length > 0) {
    return true;
  }
  return REFERENCE_SHAPED.test(line);
}

/**
 * A `#N`, `SUP-123` or `HRS-52`-shaped token. Deliberately shape-based rather than a `bareRefIssues*` call:
 * candidacy for a Linear key or a control id is decided by tables loaded from `$SLOPWEAVER_HOME`, which a pure
 * schema cannot read, so a context-driven check here would pass a row that the door then refuses at every firing.
 * A trial intro has no business citing a ticket, so refusing the SHAPE is both safe and decidable. It mirrors
 * `../linkify/bareRefs.ts`'s own anchors and digit bounds exactly: a NARROWER matcher here would accept a line
 * the door then refuses, which strands the row rather than the line.
 */
const REFERENCE_SHAPED = /(?:(?<![\w/#])#\d{1,7}|\b[A-Z]{2,6}-\d{1,6})\b/u;

/** A `[1]`-style marker. A plain-string field cannot render one, so the card refuses it and so does this. */
const CITATION_MARKER = /\[\d+\]/u;

/**
 * The day-one intro field, shared by the card and by every scheduled form that derives one, so the bound lives
 * in one place — the line COUNT and each line's WIDTH.
 *
 * Both bounds are here rather than only on the card because of where the two are read: a recipe row's own
 * `params.intro` is parsed when the row is planned, and a line the card would refuse has to be refused THERE.
 * Otherwise the row's read leg exits 0, its post leg refuses, no run of it ever succeeds — and since an
 * unsucceeded row keeps its day-one intro, it is refused again at every firing and never posts at all. The card
 * repeats the check ({@link introIssues}) because it also owns the PATH a composer needs in the refusal.
 */
export const introSchema = z.array(introLineSchema).min(1).max(INTRO_MAX_LINES);

/**
 * How an index renders: Slack's own bullets, plain newline-joined lines, or Slack's own NUMBERED list — the
 * ranked, colour-coded shape, whose every line opens with a colour ({@link orderedIndexIssues}).
 */
export const INDEX_STYLES = ["bullet", "plain", "ordered"] as const satisfies readonly IndexStyle[];

/** The truncation warning line `./truncate.ts` appends, which is the one line an ordered index may carry uncoloured. */
const TRUNCATION_GLYPH = "⚠️";

/** One refusal, addressed to the field a caller can go and fix. */
interface FieldIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** Whether a line opens with a rank colour and a space, read across its leading text runs (a derived line splits them). */
function opensWithRankGlyph({ runs }: { runs: readonly InlineRun[] }): boolean {
  const firstOther = runs.findIndex((run) => run.type !== "text");
  const leading = firstOther === -1 ? runs : runs.slice(0, firstOther);
  const opening = leading.map((run) => (run.type === "text" ? run.text : "")).join("");
  return [...RANK_GLYPHS, TRUNCATION_GLYPH].some((glyph) => opening.startsWith(`${glyph} `));
}

/**
 * Every line of an `ordered` index that opens with no colour. Any other style asks for none.
 *
 * @param index the above-the-fold index lines
 * @param indexStyle how the index renders
 * @returns one issue per uncoloured line of an ordered index
 */
export function orderedIndexIssues({
  index,
  indexStyle,
}: {
  index: readonly (readonly InlineRun[])[];
  indexStyle: IndexStyle | undefined;
}): readonly FieldIssue[] {
  if (indexStyle !== "ordered") {
    return [];
  }
  return index.flatMap((runs, line) =>
    opensWithRankGlyph({ runs })
      ? []
      : [
          {
            message:
              `index line ${String(line)} does not open with a colour — an ordered index is a colour-coded ` +
              `ranked list, so every line starts with one of ${RANK_GLYPHS.join(" ")} and a space.`,
            path: ["index", line],
          },
        ],
  );
}

/**
 * Each day-one intro line is one short line: no line break inside it, and no wider than an index line.
 *
 * @param intro the card's intro lines, empty when it has none
 * @returns one issue per broken or over-wide line
 */
export function introIssues({ intro }: { intro: readonly string[] }): readonly FieldIssue[] {
  return intro.flatMap((text, line) => [
    ...(text.includes("\n")
      ? [
          {
            message: `intro line ${String(line)} carries a line break — give each line its own entry`,
            path: ["intro", line],
          },
        ]
      : []),
    ...(text.length > INTRO_LINE_VISIBLE_MAX
      ? [
          {
            message: `intro line ${String(line)} is ${String(text.length)} visible chars, over the ${String(INTRO_LINE_VISIBLE_MAX)} cap`,
            path: ["intro", line],
          },
        ]
      : []),
  ]);
}
