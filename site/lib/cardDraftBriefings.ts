/**
 * What a card's held text gives the briefing search (`./openCard.ts` `cardLinksOf`): each held draft's, reply's or
 * review's words, and the address behind every link those words draw only as a label. EVERY held draft a card names
 * counts, not only the one a card sends — a briefing only held text links is still read. Pure.
 */
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { DraftLine } from "../components/live/readSlackDraftsRuns";
import { type DraftRunLabels, draftLinesWords } from "./draftWords";
import type { QueueRow } from "./queueRows";
import { heldDraftsNamed } from "./slackDraftIds";

/**
 * Every held draft a card carries: a post card's own, or each one an ask or hand card names.
 *
 * @returns the drafts, empty on a card naming none
 */
function heldDraftsOfCard({ row }: { row: QueueRow }): readonly ParkedDraft[] {
  if (row.record.kind === "post") {
    return [row.record.post];
  }
  if (row.record.kind !== "ask" && row.record.kind !== "hand") {
    return [];
  }
  return heldDraftsNamed({ named: row.record.drafts });
}

/**
 * One draft's line sets as drawn: its own, then Codex's while the owner's pick between them is owed.
 *
 * @returns each line set with the labels its chips are named by
 */
function drawnLineSets({
  draft,
}: {
  draft: ParkedDraft;
}): readonly { labels: DraftRunLabels; lines: readonly DraftLine[] }[] {
  const codex = draft.comparison?.codex;
  if (codex === undefined) {
    return [{ labels: draft, lines: draft.lines }];
  }
  return [
    { labels: draft, lines: draft.lines },
    { labels: { mentions: codex.mentions, people: draft.people }, lines: codex.lines },
  ];
}

/**
 * The words every held text on a card carries: each Slack draft then its Codex alternative, a held reply's lead and
 * body, and a parked review's body, comments and deeper-review offer.
 *
 * @returns the texts, empty on a card holding none
 */
export function cardDraftTexts({ row }: { row: QueueRow }): readonly string[] {
  const drafts = heldDraftsOfCard({ row }).flatMap((draft) =>
    drawnLineSets({ draft }).map(({ labels, lines }) => draftLinesWords({ labels, lines })),
  );
  if (row.record.kind === "draft") {
    const { lead, text } = row.record.draft;
    return [...drafts, ...(lead === undefined ? [] : [lead]), text];
  }
  if (row.record.kind === "review") {
    const { body, comments, deeperReview } = row.record.review;
    const offer = deeperReview === undefined ? [] : [deeperReview];
    return [...drafts, body, ...comments.map((comment) => comment.body), ...offer];
  }
  return drafts;
}

/**
 * Every string a card's row carries, at any depth — the whole row, never a list of its fields — so an offered Slack
 * action's body, an option's command, the source quote a post inherits or any field a later panel draws is searched
 * without being named here. Field by field, the list has missed drawn text (why-you and examples, an ask's offered action
 * body, the inherited source quote); a briefing the row
 * carries anywhere is read, at worst one more than the card shows.
 *
 * @returns the strings, in the row's own order
 */
export function cardCarriedTexts({ row }: { row: QueueRow }): readonly string[] {
  const texts: string[] = [];
  const seen = new WeakSet<object>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      texts.push(value);
      return;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
      return;
    }
    seen.add(value);
    for (const inner of Object.values(value)) {
      walk(inner);
    }
  };
  walk(row);
  return texts;
}

/**
 * The address behind every link a card's held text draws only by its label: each Slack draft's link runs, and a held
 * reply's citations.
 *
 * @returns the URLs, empty on a card holding no draft or no link
 */
export function cardDraftLinkUrls({ row }: { row: QueueRow }): readonly string[] {
  const runs = heldDraftsOfCard({ row }).flatMap((draft) =>
    drawnLineSets({ draft }).flatMap(({ lines }) =>
      lines.flatMap((line) => line.runs.flatMap((run) => (run.kind === "link" ? [run.url] : []))),
    ),
  );
  if (row.record.kind === "draft") {
    return [...runs, ...row.record.draft.citations.map((citation) => citation.url)];
  }
  return runs;
}
