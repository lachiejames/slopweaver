/**
 * What a reader sees on a bot card BEFORE expanding it.
 *
 * A card's chrome is exactly five blocks and its `detail` starts at the sixth, so EVERY `detail` sub-block
 * is behind the `Details` label no matter how short it is. What a reader meets first is the `tldr` and,
 * when the card carries one, each `index` line beside it.
 *
 * That ordering is what this module is about, and it is unaffected by the retraction of the
 * block-count fold RULE (`../slack/preview.ts`'s `FOLD_AFTER_BLOCKS`): a three-block attachment has been
 * measured folding, so "above the fold" here means "before the Details label", never "provably visible".
 * A message that must be entirely visible is a different form — see `./noFoldSchema.ts` — and its own cells
 * go to these same rules through {@link noFoldAboveFoldCells}.
 *
 * `../voice/aboveFold.ts` owns the rules; this module owns which text they see. A `link` run's label, a
 * `mention`, a `citation` chip and a `quoted` text run are skipped: a link label is usually somebody else's
 * title, a quoted run IS somebody else's words by declaration (a monitor's name on an alert-summary row),
 * and the other two are typed identity rather than authored prose. That is the same call `dripSourceAssessment`'s
 * as-me lane made, and the scar behind it is in `./schema.ts` — a whole-artifact scan once blocked a quoted ticket
 * title for containing an em dash. The alert-summary card carried the same scar for a further week: two of the
 * ten team alerts channels could not receive their first daily card because a Datadog monitor
 * title held an em dash, and the card's own header had already named the label "quoted rather than authored".
 *
 * A skipped run leaves ONE space rather than nothing, so removing it can never weld the sentence before it
 * onto the sentence after it.
 */
import type { AboveFoldCell } from "../voice/aboveFold.js";
import { noFoldSequences } from "./runs.js";
import type { DetailBlock, InlineRun, NoFoldArtifact, SlackBotArtifact, UpdateArtifact } from "./types.js";

/** One run sequence's authored prose, with typed links, mentions, broadcasts, citations and quoted runs replaced. */
function proseOfRuns({ runs }: { runs: readonly InlineRun[] }): string {
  return runs.map((run) => (run.type === "text" && run.quoted !== true ? run.text : " ")).join("");
}

/**
 * Every above-the-fold region of a bot card.
 *
 * @param artifact the validated card, from whichever lane derived it
 * @returns any day-one intro line, the TL;DR and each index line, in the order a reader meets them
 */
export function updateArtifactAboveFoldCells({ artifact }: { artifact: UpdateArtifact }): readonly AboveFoldCell[] {
  const { intro = [] } = artifact;
  return [
    ...intro.map((text, line) => ({ path: `intro[${String(line)}]`, text })),
    { path: "tldr", text: artifact.tldr },
    ...artifact.index.map((runs, position) => ({
      path: `index[${String(position)}]`,
      text: proseOfRuns({ runs }),
    })),
  ].filter((cell) => cell.text.trim().length > 0);
}

/** One detail sub-block's authored prose, one cell per independently addressable region of it. */
function detailBlockCells({ block, path }: { block: DetailBlock; path: string }): readonly AboveFoldCell[] {
  if (block.type === "paragraph") {
    return [{ path, text: proseOfRuns({ runs: block.runs }) }];
  }
  if (block.type === "table") {
    return [
      ...block.columns.map((label, column) => ({ path: `${path}.columns[${String(column)}]`, text: label })),
      ...block.rows.flatMap((row, rowIndex) =>
        row.map((runs, column) => ({
          path: `${path}.rows[${String(rowIndex)}][${String(column)}]`,
          text: proseOfRuns({ runs }),
        })),
      ),
    ];
  }
  return block.items.map((runs, item) => ({ path: `${path}.items[${String(item)}]`, text: proseOfRuns({ runs }) }));
}

/**
 * Every BELOW-the-fold region of a bot card: the whole of `detail`, which no rule read until now.
 *
 * The arithmetic in this module's own header is exactly why this half was invisible. Slack's chrome is five
 * blocks and the fold cuts after five, so EVERY `detail` sub-block is below the fold no matter how short —
 * which meant the voice rules ran over a TL;DR and an index and nothing else, while the bulk of the card's
 * prose went out unread. A card is mostly detail.
 *
 * Same run policy as above the fold, and for the same reasons: a link label is usually somebody else's
 * title, a mention and a citation chip are typed identity, and a skipped run leaves one space so removing
 * it can never weld two sentences together. Table COLUMN LABELS are cells here because a column label is
 * the author writing, and empty ones fall out with every other blank cell.
 *
 * @param artifact the validated card, from whichever lane derived it
 * @returns every detail region, named by the field a caller can go and fix
 */
export function updateArtifactBelowFoldCells({ artifact }: { artifact: UpdateArtifact }): readonly AboveFoldCell[] {
  return artifact.detail
    .flatMap((block, position) => detailBlockCells({ block, path: `detail[${String(position)}]` }))
    .filter((cell) => cell.text.trim().length > 0);
}

/**
 * Every region of a NO-FOLD message — which is all of it.
 *
 * There is no below-fold companion to this function and there never will be, because the form has no
 * below-fold region: that is what it is FOR. So the whole message goes to the above-the-fold rules, which
 * is the strictest treatment any outbound shape gets here, and correctly so — every character of a no-fold
 * message is a character the reader cannot skip.
 *
 * Same run policy as the card's: a link label is usually somebody else's title and a mention is typed
 * identity, so both are replaced by ONE SPACE rather than dropped, which keeps removing them from welding
 * the sentence before onto the sentence after.
 *
 * @param artifact the validated no-fold message
 * @returns the lead, each dot point and each trailing line, named by the field a caller can go and fix
 */
export function noFoldAboveFoldCells({ artifact }: { artifact: NoFoldArtifact }): readonly AboveFoldCell[] {
  const paths = [
    "lead",
    ...artifact.bullets.map((_, position) => `bullets[${String(position)}]`),
    ...artifact.trailing.map((_, position) => `trailing[${String(position)}]`),
  ];
  return noFoldSequences({ artifact })
    .map((runs, position) => ({ path: paths[position] ?? "lead", text: proseOfRuns({ runs }) }))
    .filter((cell) => cell.text.trim().length > 0);
}

/**
 * Every cell of a bot post's authored prose, whichever form it is — a no-fold message is all one region, and a
 * card is its above-the-fold cells followed by its detail.
 *
 * @param artifact the admitted post
 * @returns the cells, in the order a reader meets them
 */
export function authoredCells({ artifact }: { artifact: SlackBotArtifact }): readonly AboveFoldCell[] {
  if (artifact.kind === "no-fold") {
    return noFoldAboveFoldCells({ artifact });
  }
  return [...updateArtifactAboveFoldCells({ artifact }), ...updateArtifactBelowFoldCells({ artifact })];
}
