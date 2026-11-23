/**
 * The FOLD-RESIDUE half of the briefing gate: two shapes a react-now card's fold should never carry, because
 * both leave the owner to go and look rather than reading the fold itself.
 *
 * `../outbound/briefing/schema.ts`'s typed form already makes both unrepresentable for anything composed
 * through it — there is no field to put a bare path in, and a fold's own link text is refused when it
 * carries nothing but a key. This is the READER's half: `./check.ts` still has to gate a page a session
 * hand-wrote, and a hand-written page can put anything inside a `<details>`.
 *
 * ## A filesystem path in place of a draft
 *
 * A drafted Slack post must render INSIDE the card, never a file path the owner has to go find.
 *
 * ## A link naming only its key
 *
 * A `#N`/`SUP-N` wrapped in a real `<a>` still leaves nothing but a number to click — the owner has to
 * open the link to know what the row is about. The title belongs BESIDE the key, not behind it.
 */
import { extractCards } from "./cardSpans.js";
import { reactNowRegion } from "./reactNowCard.js";
import { isBareKeyLabel, plainText } from "./text.js";

/** Which fold-residue shape a defect names. */
type FoldResidueKind = "filesystem-path" | "bare-key-link";

/** One card whose fold carries a shape a draft or a title should have replaced. */
interface FoldResidueDefect {
  /** 1-based position of the card within the react-now block. */
  readonly card: number;
  readonly kind: FoldResidueKind;
  readonly reason: string;
}

/** What scanning every react-now card's folds for residue found. */
export interface FoldResidueCheck {
  readonly defects: readonly FoldResidueDefect[];
}

const DETAILS = /<details>[\s\S]*?<\/details>/g;
const ANCHOR = /<a\b[^>]*>([\s\S]*?)<\/a>/g;

/** A bare filesystem path: home-relative, or absolute under a root a session actually writes into. */
const FILESYSTEM_PATH = /(?:^|[\s(])(~\/|\/(?:Users|home|tmp|private|var|Volumes|opt)\/)\S+/;

/** The first filesystem-path defect a card's folds carry, or undefined when none do. */
function pathDefect({ card, cardHtml }: { card: number; cardHtml: string }): FoldResidueDefect | undefined {
  for (const [fold] of cardHtml.matchAll(DETAILS)) {
    const match = FILESYSTEM_PATH.exec(plainText({ html: fold }));
    if (match !== null) {
      return {
        card,
        kind: "filesystem-path",
        reason:
          `its fold names a filesystem path ("${match[0].trim()}") rather than the draft itself. Write a ` +
          '`{ "kind": "draft" }` block instead, rendered inline the way the surface will show it.',
      };
    }
  }
  return undefined;
}

/** Every bare-key-link defect a card's folds carry — one per link naming only its key, no title beside it. */
function bareKeyLinkDefects({ card, cardHtml }: { card: number; cardHtml: string }): readonly FoldResidueDefect[] {
  const defects: FoldResidueDefect[] = [];
  for (const [fold] of cardHtml.matchAll(DETAILS)) {
    for (const anchor of fold.matchAll(ANCHOR)) {
      // The capturing group always participates — `([\s\S]*?)` matches even an empty anchor body — so this
      // is an honest assertion, not a fallback for a case that cannot occur.
      const label = plainText({ html: anchor[1]! });
      if (isBareKeyLabel({ text: label })) {
        defects.push({
          card,
          kind: "bare-key-link",
          reason:
            `a link in its fold carries only "${label}" as the label, its key and nothing else. Put the ` +
            "title beside the key so the reader never opens the link to know what it is.",
        });
      }
    }
  }
  return defects;
}

/**
 * Check every react-now card's folds for a filesystem path standing in for a draft, or a link naming only
 * its key with no title beside it.
 *
 * @param html the whole artifact file
 * @returns one defect per card fold that carries either shape
 */
export function checkFoldResidue({ html }: { html: string }): FoldResidueCheck {
  const { block } = reactNowRegion({ html });
  if (block === undefined) {
    return { defects: [] };
  }
  const defects: FoldResidueDefect[] = [];
  extractCards({ block }).forEach((cardHtml, index) => {
    const card = index + 1;
    const path = pathDefect({ card, cardHtml });
    if (path !== undefined) {
      defects.push(path);
    }
    defects.push(...bareKeyLinkDefects({ card, cardHtml }));
  });
  return { defects };
}
