/**
 * A parked draft's `priorAsk`, as `slopweaver slack draft list --json` prints it: the declaration that a question was
 * never asked before, or the earlier ask — our message, the replies it drew, and what materially changed since.
 *
 * A question the team already answered is not asked again in public unless something changed,
 * and the Queue card must show the earlier message, the answer, and charts or proof of what changed, since a bare
 * claim that something changed is not enough. So the refusal rule is the strictest the reader has: a
 * PRESENT `priorAsk` that will not read whole takes the whole row down (`./readSlackDrafts.ts`), because a card that
 * quietly dropped the proof, or a reply, would show the owner a re-ask with less than it must carry. An ABSENT one
 * is a row recorded before the field, or one that asks nothing.
 *
 * The proof is stored like the draft's own attachments, so it is read by the same reader (`./draftMedia.ts`) and
 * drawn by the same component.
 */

import { type Bag, bags, isBag, num, str } from "../../lib/bag";
import { type DraftMedia, mediaEntriesOf } from "./draftMedia";

/** One message of an earlier exchange, kept to recognise it. */
export interface DraftPriorMessage {
  readonly ts: string;
  /** Who wrote it, when Slack said. */
  readonly userId: string | undefined;
  readonly text: string;
}

/** What a row declares about an earlier ask: none, or the earlier exchange and what changed since. */
export type DraftPriorAsk =
  | { readonly kind: "none" }
  | {
      readonly kind: "prior";
      /** The earlier message's own Slack link. */
      readonly permalink: string;
      readonly ours: DraftPriorMessage;
      /** The first replies by anybody else, oldest first — at most as many as the register keeps. */
      readonly answers: readonly DraftPriorMessage[];
      /** How many replies by anybody else the recording found; more than `answers` holds when it was cut. */
      readonly answerCount: number;
      readonly readThroughTs: string;
      /** What materially changed since they answered, in the recorder's words. */
      readonly changed: string | undefined;
      /** The pictures that show it; empty when none were attached. */
      readonly proof: readonly DraftMedia[];
      /** Why the replies there are not an answer to the question. */
      readonly notAnswered: string | undefined;
    };

/** A Slack `ts` as an identifier. */
const SLACK_TS = /^[0-9]{10}\.[0-9]{6}$/;

/** How many answers the register keeps on a row (`PRIOR_ANSWERS_KEPT`, `src/outbound/slack/draftRegister.ts`). */
const ANSWERS_KEPT = 3;

/** Whether an OPTIONAL string field is present but not a string — malformed, which refuses, never read as absent. */
function notText({ bag, key }: { bag: Bag; key: string }): boolean {
  return bag[key] !== undefined && typeof bag[key] !== "string";
}

/** One earlier message, or `undefined` when any of its fields is the wrong shape. */
function priorMessageOf({ message }: { message: Bag }): DraftPriorMessage | undefined {
  const ts = str({ bag: message, key: "ts" });
  const text = str({ bag: message, key: "text" });
  if (ts === undefined || !SLACK_TS.test(ts) || text === undefined || notText({ bag: message, key: "userId" })) {
    return undefined;
  }
  return { text, ts, userId: str({ bag: message, key: "userId" }) };
}

/** Every reply of an earlier exchange, or `undefined` when the list will not read or any reply is malformed. */
function answersOf({ prior }: { prior: Bag }): readonly DraftPriorMessage[] | undefined {
  const rows = bags({ bag: prior, key: "answers" });
  if (rows === undefined || rows.length > ANSWERS_KEPT) {
    return undefined;
  }
  const answers: DraftPriorMessage[] = [];
  for (const row of rows) {
    const answer = priorMessageOf({ message: row });
    if (answer === undefined) {
      return undefined;
    }
    answers.push(answer);
  }
  return answers;
}

/**
 * Read a draft row's `priorAsk` field.
 *
 * @param draft the row's `draft` object
 * @returns the declaration, `undefined` when the field is absent, or `"malformed"` when it is present and is not
 *   exactly one of the two shapes the register records
 */
export function draftPriorAskOf({ draft }: { draft: Bag }): DraftPriorAsk | undefined | "malformed" {
  const raw = draft["priorAsk"];
  if (raw === undefined) {
    return undefined;
  }
  if (!isBag(raw)) {
    return "malformed";
  }
  if (raw["kind"] === "none") {
    return Object.keys(raw).length === 1 ? { kind: "none" } : "malformed";
  }
  const permalink = str({ bag: raw, key: "permalink" });
  const oursBag = raw["ours"];
  const ours = isBag(oursBag) ? priorMessageOf({ message: oursBag }) : undefined;
  const answers = answersOf({ prior: raw });
  const answerCount = num({ bag: raw, key: "answerCount" });
  const readThroughTs = str({ bag: raw, key: "readThroughTs" });
  const proof = mediaEntriesOf({ bag: raw, key: "proof" });
  if (
    raw["kind"] !== "prior" ||
    permalink === undefined ||
    !permalink.startsWith("https://") ||
    ours === undefined ||
    answers === undefined ||
    answerCount === undefined ||
    !Number.isSafeInteger(answerCount) ||
    answerCount < answers.length ||
    readThroughTs === undefined ||
    !SLACK_TS.test(readThroughTs) ||
    proof === undefined ||
    notText({ bag: raw, key: "changed" }) ||
    notText({ bag: raw, key: "notAnswered" })
  ) {
    return "malformed";
  }
  return {
    answerCount,
    answers,
    changed: str({ bag: raw, key: "changed" }),
    kind: "prior",
    notAnswered: str({ bag: raw, key: "notAnswered" }),
    ours,
    permalink,
    proof,
    readThroughTs,
  };
}
