/**
 * The text the one discussions GraphQL read answers: each discussion's title and body, every comment and every
 * reply, each at its own locator, and a counted gap for any connection GitHub held more of than it sent.
 *
 * Every comment and reply gets its own locator: two with the same body are two places, and the sweep scans a text
 * once per distinct (surface, locator, field, text). A gap is PRINTED, so it carries counts and never a locator:
 * naming the comment whose replies were cut off would name a place a finding may sit.
 */

import { isRecord } from "../../lib/parsers.js";
import { numberAt } from "./exposureListing.js";
import { numberPart, recordsAt, textsAt } from "./exposureTextParts.js";
import type { GithubExposureText } from "./exposureTexts.js";

/** Whether GitHub holds more of a connection than the answer carried. */
function cutOff({ connection }: { connection: unknown }): boolean {
  const total = numberAt({ path: ["totalCount"], value: connection });
  return total !== undefined && total > recordsAt({ item: connection, key: "nodes" }).length;
}

/** One comment's body and each reply's, and whether its replies were cut off. */
function commentTexts({ comment, locator }: { comment: unknown; locator: string }): {
  texts: readonly GithubExposureText[];
  repliesCut: boolean;
} {
  const replies = isRecord(comment) ? comment["replies"] : undefined;
  const replyTexts = recordsAt({ item: replies, key: "nodes" }).flatMap((reply, index) =>
    textsAt({
      fields: [["body"]],
      item: reply,
      locator: `${locator} reply ${String(index + 1)}`,
      surface: "discussions",
    }),
  );
  return {
    repliesCut: cutOff({ connection: replies }),
    texts: [...textsAt({ fields: [["body"]], item: comment, locator, surface: "discussions" }), ...replyTexts],
  };
}

/** One discussion's title, body and comments, and what of it was cut off. */
function discussionTexts({ discussion }: { discussion: unknown }): {
  texts: readonly GithubExposureText[];
  commentsCut: boolean;
  repliesCut: number;
} {
  const locator = `discussion #${numberPart({ item: discussion, path: ["number"] })}`;
  const comments = isRecord(discussion) ? discussion["comments"] : undefined;
  const parts = recordsAt({ item: comments, key: "nodes" }).map((comment, index) =>
    commentTexts({ comment, locator: `${locator} comment ${String(index + 1)}` }),
  );
  return {
    commentsCut: cutOff({ connection: comments }),
    repliesCut: parts.filter((part) => part.repliesCut).length,
    texts: [
      ...textsAt({ fields: [["title"], ["body"]], item: discussion, locator, surface: "discussions" }),
      ...parts.flatMap((part) => part.texts),
    ],
  };
}

/** The counted gaps: discussions not read, and discussions and comments holding more than was read. */
function discussionGaps({
  connection,
  commentsCut,
  repliesCut,
}: {
  connection: unknown;
  commentsCut: number;
  repliesCut: number;
}): readonly string[] {
  const gaps: string[] = [];
  const total = numberAt({ path: ["totalCount"], value: connection });
  const read = recordsAt({ item: connection, key: "nodes" }).length;
  if (total !== undefined && total > read) {
    gaps.push(`discussions: GitHub reports ${String(total)}, ${String(read)} read`);
  }
  if (commentsCut > 0) {
    gaps.push(`${String(commentsCut)} discussion(s) hold more comments than were read`);
  }
  if (repliesCut > 0) {
    gaps.push(`${String(repliesCut)} comment(s) hold more replies than were read`);
  }
  return gaps;
}

/**
 * Every piece of text the discussions query answered, and why any connection in it was cut off. Pure.
 *
 * @param data the GraphQL answer
 * @returns the texts, and one counted gap per kind of connection GitHub held more of than it sent
 */
export function githubExposureDiscussionTexts({ data }: { data: unknown }): {
  texts: readonly GithubExposureText[];
  gaps: readonly string[];
} {
  const connection = isRecord(data) && isRecord(data["repository"]) ? data["repository"]["discussions"] : undefined;
  const parts = recordsAt({ item: connection, key: "nodes" }).map((discussion) => discussionTexts({ discussion }));
  return {
    gaps: discussionGaps({
      commentsCut: parts.filter((part) => part.commentsCut).length,
      connection,
      repliesCut: parts.reduce((sum, part) => sum + part.repliesCut, 0),
    }),
    texts: parts.flatMap((part) => part.texts),
  };
}
