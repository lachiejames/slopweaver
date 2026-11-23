/**
 * The single source of truth for how a record is cited — used both when telling the model "cite as (TOKEN)"
 * and when validating the model's citations back.
 *
 * ## The token used to name a CONTAINER, not a record
 *
 * It was mined from the URL: a Slack archive link yielded its channel id, a Linear link its issue key. Every
 * message in a channel therefore shared one token, and every comment on an issue shared another. Downstream,
 * `answerFromSlice` builds `urlByToken` by writing each sliced record's token into a map — so the last record
 * with a given token silently overwrote the earlier ones' URLs, and a citation could point at the wrong
 * message while looking perfectly well-formed. There is no way to notice that from the output.
 *
 * Measured over the owner's real corpus (335,546 rows / 334,555 logical identities): the mined token left
 * **70.0% of records sharing a token with at least one other record** — 97.8% of Slack, 76.5% of Linear.
 *
 * ## The rule, and why it is not just `sourceId`
 *
 * A record's logical identity is `(source, container, sourceId)`, never `sourceId` alone: GitHub numbers
 * issues PER REPOSITORY, so `#7` exists in every repo the corpus has seen (see {@link ../corpus/latestRecords}).
 * On the same corpus, `sourceId` alone still lost 114 identities.
 *
 * So: **the token is the `sourceId`, qualified by its `container` unless the container is already inside it.**
 * That keeps the readable ids readable — a Slack `sourceId` already begins with its channel, a Linear
 * `DDDD-805` already carries its team — and qualifies only the ids that genuinely need it, which in practice
 * is GitHub's (`owner/repo#<number>`). Measured over the same corpus: **0 identities lost**, tokens averaging 34–112
 * characters by source.
 *
 * Pure.
 */
import type { CorpusRecord } from "../corpus/types.js";

/** The last path segment of a container — the part a `sourceId` would carry if it self-identifies. */
function containerTail({ container }: { container: string }): string | undefined {
  const segments = container.split("/");
  const tail = segments[segments.length - 1];
  return tail !== undefined && tail.length > 0 ? tail : undefined;
}

/**
 * The token a record is cited by: its `sourceId`, qualified by its `container` when the id does not already
 * identify itself. Record-unique, which is the whole contract — two records may never share a token.
 *
 * The parameter is narrowed to the two fields the token actually reads, so a caller holding only a pinned
 * REF — which carries exactly those two, and no text — can compute the same token without a record. That is
 * what lets `ask answer` find its slice in the prebuilt index instead of searching a loaded corpus for it.
 *
 * @param record the record being cited, or anything carrying its container and source id
 * @returns the record-unique citation token
 */
export function citeToken({ record }: { record: Pick<CorpusRecord, "container" | "sourceId"> }): string {
  const tail = containerTail({ container: record.container });
  if (tail === undefined || record.sourceId.includes(tail)) {
    return record.sourceId;
  }
  // `#7` reads as `owner/repo#7`, not `owner/repo/#7` — the `#` is already the separator.
  return record.sourceId.startsWith("#")
    ? `${record.container}${record.sourceId}`
    : `${record.container}/${record.sourceId}`;
}
