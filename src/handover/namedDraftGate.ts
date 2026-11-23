/**
 * The gate `handover ask` and `handover correct` put in front of a question that names a parked Slack draft: the
 * draft it names must be one the register still HOLDS, because the console draws that draft on the card and a
 * card naming a draft it cannot draw is never acceptable.
 *
 * ## Why this exists
 *
 * A queue card asking the owner to react to a Slack draft must show that draft, for every existing and future card.
 * The console half resolves every id a
 * card names (`site/lib/slackDraftIds.ts`) and says what became of one it cannot draw; this half refuses to RECORD
 * that card in the first place. An id with a typo, a draft already sent, or one dropped and re-recorded under a new
 * id would each leave the owner a card asking them to send something that is not there.
 *
 * ## The criterion
 *
 * Every `sd-` id — the exact token `mintSlackDraftId` mints, matched whole — in the texts the verb is about to
 * record must name a row the draft register folds to `held`. No id named is no check HERE: a card that says a
 * message was drafted as the owner and names no id is `./undrawnAskDraftGate.ts`'s subject, and guessing at "send this"
 * in prose is not a check either gate makes.
 *
 * ## A POLICY refusal, with a hatch
 *
 * The text would record fine; the standing rule says no. So it is the four-line shape
 * `.claude/rules/error-handling.md` requires. The fix is nearly always to re-record the draft
 * (`slopweaver slack draft record`) or name the right id; the hatch covers the genuine exceptions only.
 *
 * Pure: no filesystem, no clock. The caller supplies the texts, the folded register and the environment.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { type ChainRow, liveCutOf } from "../outbound/slack/draftLiveCut.js";

/**
 * The environment variable that records a question naming a draft the register does not hold.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named
 * reader mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const UNHELD_DRAFT_HATCH = "SLOPWEAVER_ALLOW_UNHELD_DRAFT";

/**
 * A draft id as the card can DRAW it, which is a SUPERSET of the id as minted (`sd-` and eight lowercase hex
 * digits). The card draws a body through its mrkdwn renderer (`site/lib/slackMrkdwn.ts`), which only ever drops
 * the `*`, `_`, `~` and `` ` `` markers of a run it recognises and draws a `<target|label>` entity as its label.
 * So the pattern lets a marker sit between any two characters of the id, and a marker counts as the boundary either
 * side — `_` included, though a regex `\w` counts it a letter — since the renderer only ever drops one, so the
 * character beside a drawn id is its drawn neighbour or a marker.
 * `sd-*deadbeef*`, `sd-*deadbeef**x` and `*sd-deadbeef*x` all match however the renderer pairs their markers, and
 * `sd-deadbeefx` still does not. Every text is read raw and with its entities replaced; the markers are dropped from
 * what matched. A marker the renderer keeps can yield a false match, which refuses with the hatch.
 */
const DRAWN_ID = /(?<![A-Za-z0-9-])s[*_~`]*d[*_~`]*-(?:[*_~`]*[0-9a-f]){8}(?![A-Za-z0-9-])/gu;
const MRKDWN_MARKS = /[*_~`]/gu;
const MRKDWN_ENTITY = /<[@#!]?([^>|]*)(?:\|([^>]*))?>/gu;

/** The two reads of one text that between them hold every id its rendering can draw: raw, and entities drawn. */
function readsOf({ text }: { text: string }): readonly string[] {
  const labelled = text.replace(MRKDWN_ENTITY, (_whole: string, target: string, label: string | undefined) => {
    if (label === undefined) {
      return target;
    }
    return label;
  });
  return [text, labelled];
}

/**
 * Every draft id the texts name, first seen first, each once — `site/lib/slackDraftIds.ts`'s reader, restated
 * because `src/` cannot import the console.
 *
 * @param texts the fields about to be recorded; an absent one is skipped
 * @returns the ids
 */
export function draftIdsNamed({ texts }: { texts: readonly (string | undefined)[] }): readonly string[] {
  const reads = texts.flatMap((text) => (text === undefined ? [] : readsOf({ text })));
  const out: string[] = [];
  for (const match of reads.flatMap((read) => [...read.matchAll(DRAWN_ID)])) {
    const id = match[0].replaceAll(MRKDWN_MARKS, "");
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * One sentence per named id the register does not hold, empty when every one is held.
 *
 * A dropped id whose drop note names its re-cut is answered with the LIVE cut's id (`liveCutOf`), so the card is
 * re-recorded naming the draft that stands; a card naming a dropped first cut would draw superseded words for the
 * owner to approve.
 *
 * A plain list rather than a typed union: the behaviour IS the multiplicity — a question can name two drafts,
 * one sent and one mistyped, and the refusal names both (`.claude/rules/error-handling.md` § "When NOT to
 * introduce a union").
 *
 * @param ids the ids the texts name
 * @param items the folded register — each draft's id, its state, and a dropped row's note
 * @returns the problems, in the order the ids came
 */
export function unheldDraftProblems({
  ids,
  items,
}: {
  ids: readonly string[];
  items: readonly ChainRow[];
}): readonly string[] {
  const problems: string[] = [];
  for (const id of ids) {
    const cut = liveCutOf({ id, items });
    if (cut === undefined) {
      problems.push(`${id} is not in the drafts register — a typo, or a draft never recorded on this home`);
      continue;
    }
    if (cut.superseded.length > 0) {
      problems.push(recutProblem({ id, live: cut.live }));
      continue;
    }
    if (cut.live.state !== "held") {
      problems.push(
        `${id} is ${cut.live.state}, so the card would ask the owner to send a draft that is no longer waiting`,
      );
    }
  }
  return problems;
}

/** The sentence for a named id that was dropped and re-cut: which cut stands, and whether it is still the owner's to send. */
function recutProblem({ id, live }: { id: string; live: ChainRow }): string {
  const head = `${id} was dropped and re-cut — the live cut is ${live.id}`;
  if (live.state === "held") {
    return `${head}, still held: name ${live.id} so the card draws the words the owner would be approving`;
  }
  return `${head}, which is ${live.state}, so there is no draft left waiting on the owner`;
}

/** What a verb should do with the texts it was handed. */
export type NamedDraftVerdict =
  | { readonly kind: "ok" }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on the texts a verb is about to record, with the hatch applied.
 *
 * @param ids the draft ids the texts name, as {@link draftIdsNamed} found them
 * @param items the folded register
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, or the whole refusal to print
 */
export function namedDraftVerdict({
  ids,
  items,
  command,
  env,
}: {
  ids: readonly string[];
  items: readonly ChainRow[];
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): NamedDraftVerdict {
  const problems = unheldDraftProblems({ ids, items });
  const open = env[UNHELD_DRAFT_HATCH] === "1";
  if (problems.length === 0 || open) {
    return { kind: "ok" };
  }
  const hatch = { ...hatchFor({ id: "unheld-draft" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ hatch }),
      ...problems.map((problem) => `  - ${problem}`),
      "NOTHING was recorded and the run is not paused: re-record the draft with `slopweaver slack draft record` " +
        "(or name the id `slopweaver slack draft list` shows held) and run the same command again.",
    ],
  };
}
