/**
 * The tags each Queue card carries, read off the board rows its record names. Split from `./queueRows.ts`, which
 * builds the cards, so that file stays under the 300-line cap; the filter over these tags is `./queueTags.ts`.
 */

import type { Board, BoardRow } from "../components/live/read";
import type { LiveState } from "../components/live/useLive";
import { handPill } from "./handPill";
import { queueLinkTarget } from "./queueLink";
import type { QueueRow } from "./queueRows";
import { type BoardReading, type CardTag, cardRows, inheritedTags, type QueueTags } from "./queueTagsInherited";

/**
 * Every card with its tags, in the order given. A card whose rows the board has not read yet reads `absent` rather
 * than untagged, so a "none" filter never claims it.
 *
 * @param board the board as the Queue reads it, ready or not
 * @param rows the cards, without tags yet
 * @returns the same cards, each carrying its tags and how much of them read
 */
export function withCardTags({
  board,
  rows,
}: {
  board: LiveState<Board>;
  rows: readonly Omit<QueueRow, keyof QueueTags>[];
}): QueueRow[] {
  const reading = boardReadingOf({ board });
  return rows.map((row): QueueRow => {
    const tagged = { ...row, ...cardTagsOf({ board: reading, record: row.record }) };
    if (tagged.record.kind !== "hand") {
      return tagged;
    }
    // The workstream joins the integration on a hand card's right-hand tag once the board has said which it is.
    const workstreams = tagged.tags.filter((tag) => tag.key === "workstream").map((tag) => tag.value);
    return { ...tagged, pill: handPill({ step: tagged.record.step, workstreams }) };
  });
}

/**
 * The board as the join reads it: its rows and unreadable documents, or the fact it has not read.
 *
 * @returns the reading
 */
export function boardReadingOf({ board }: { board: LiveState<Board> }): BoardReading {
  if (board.phase === "ready") {
    return { phase: "ready", rows: board.value.rows, unreadable: board.value.unreadable };
  }
  return { phase: "unread" };
}

/**
 * The cards whose tags read only in part, split by why: a read that failed (a document, or a row's tags, that did not
 * wholly read) or only a slug several board rows carry, which is the data — no read failed, the record just does not
 * say which row it meant.
 *
 * @param board the board as the Queue reads it
 * @param rows the cards, tagged
 * @returns how many are part-read for each reason; both zero until the board reads
 */
export function partialTagsSplit({ board, rows }: { board: LiveState<Board>; rows: readonly QueueRow[] }): {
  failed: number;
  ambiguous: number;
} {
  const reading = boardReadingOf({ board });
  let failed = 0;
  let ambiguous = 0;
  if (reading.phase === "unread") {
    return { ambiguous, failed };
  }
  for (const row of rows) {
    if (row.tagsRead === "whole") {
      continue;
    }
    const { direct, slugs, pullRequest } = cardJoinOf({ record: row.record });
    const found = cardRows({ board: reading, direct, pullRequest, slugs });
    const onlyAmbiguous =
      found.phase === "ready" &&
      found.ambiguous.length > 0 &&
      found.unread.length === 0 &&
      found.rows.every((joined) => joined.tagsRead === "whole");
    if (onlyAmbiguous) {
      ambiguous += 1;
    } else {
      failed += 1;
    }
  }
  return { ambiguous, failed };
}

/** The prefix a run's own session name carries on a hand step's `postedBy`. */
const RUN_PREFIX = "run:";

/**
 * The board-row slug a hand step's `postedBy` names. `--by-session` is free text, and a run posts either its bare slug
 * or `run:<slug>`; read verbatim, the prefixed form matched no row, so the card read whole with no tags and a
 * `!workstream` filter claimed a step whose run carries one.
 *
 * @returns the slug to look the posting row up by
 */
export function postingSlugOf({ postedBy }: { postedBy: string }): string {
  if (postedBy.startsWith(RUN_PREFIX)) {
    return postedBy.slice(RUN_PREFIX.length);
  }
  return postedBy;
}

/**
 * The tags one card carries: the union of every board row its record names, and the facets the record states
 * (`./queueTagsInherited.ts`). An ask is its own row; a hand step belongs to the ask its address opens, else to a `postedBy`
 * that names a slug, bare or as `run:<slug>`; an act to its `run`; a pull request to its branch's row and every row,
 * done or closed too, whose `pr=` names it. A held reply names no row, and a parked post only the one its `--row` named;
 * both are Slack — their outward act lands there. A
 * parked review is GitHub, and belongs to every row whose `pr=` names the colleague's pull request it reviews. A pull
 * request card states no facet of its own: its `repo` would be a remote's name where the tag means a checkout's,
 * and what it asks of the owner is not always a GitHub act (a reviewer to name), so both come from its rows or not at all.
 *
 * @returns the card's tags and how much of them read
 */
function cardTagsOf({ board, record }: { board: BoardReading; record: QueueRow["record"] }): QueueTags {
  return inheritedTags({ board, ...cardJoinOf({ record }) });
}

/** What one card names to join the board by, and the facets its own record states. */
export interface CardJoin {
  readonly derived: readonly CardTag[];
  readonly direct: BoardRow | undefined;
  readonly slugs: readonly string[];
  readonly pullRequest: string | undefined;
}

/**
 * What one card joins the board by, per kind — the arguments {@link inheritedTags} and `./queueTagsInherited.ts` `cardRows` both read, so a
 * card's tags and its properties (`./cardProperties.ts`) come from one join.
 *
 * @returns the join
 */
export function cardJoinOf({ record }: { record: QueueRow["record"] }): CardJoin {
  const slack: readonly CardTag[] = [{ key: "platform", value: "slack" }];
  switch (record.kind) {
    case "ask":
      return { derived: [], direct: record.row, pullRequest: undefined, slugs: [] };
    case "hand": {
      const target = queueLinkTarget({ url: record.step.url });
      let slugs: readonly string[] = [];
      if (target?.kind === "ask") {
        slugs = [target.id];
      } else if (record.step.postedBy !== undefined) {
        slugs = [postingSlugOf({ postedBy: record.step.postedBy })];
      }
      return { derived: [], direct: undefined, pullRequest: undefined, slugs };
    }
    case "draft":
      return { derived: slack, direct: undefined, pullRequest: undefined, slugs: [] };
    case "post": {
      // The row its recorder named with `--row` — a thread chase's bump carries the row that fired it, so the card
      // reads that row's workstream. A post recorded without one names no row, exactly as before the field.
      let slugs: readonly string[] = [];
      if (record.post.row !== undefined) {
        slugs = [record.post.row];
      }
      return { derived: slack, direct: undefined, pullRequest: undefined, slugs };
    }
    case "review": {
      const pullRequest = `${record.review.repo}#${String(record.review.number)}`;
      const github: readonly CardTag[] = [{ key: "platform", value: "github" }];
      return { derived: github, direct: undefined, pullRequest, slugs: [] };
    }
    case "import":
      // A staged import question changes only this installation's store: no row, no platform, no pull request.
      return { derived: [], direct: undefined, pullRequest: undefined, slugs: [] };
    case "pr": {
      const { row } = record;
      const slugs: string[] = [];
      if (row.boardRowSlug !== undefined) {
        slugs.push(row.boardRowSlug);
      }
      const pullRequest = `${row.repoSlug}#${String(row.number)}`;
      return { derived: [], direct: undefined, pullRequest, slugs };
    }
    case "act": {
      // A card folds every act on one subject, and the newest governs its decision (`foldActs`), so it is that
      // act's run the card belongs to; an earlier folded act's run lends it nothing.
      let slugs: readonly string[] = [];
      if (record.act.run !== undefined) {
        slugs = [record.act.run];
      }
      return { derived: [], direct: undefined, pullRequest: undefined, slugs };
    }
    default: {
      const unhandled: never = record;
      return unhandled;
    }
  }
}
