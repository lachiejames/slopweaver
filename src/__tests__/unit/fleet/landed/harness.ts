/*
 * What the `fleet landed` test files share: a squash commit's sha and pull-request URL, the instant the change in
 * every words case landed, the front-matter of a row holding the owner's quote, a row and ruling builder, the reads every
 * case is given, and one act settled by the owner's standing self-merge rule.
 */
import type { AutonomyAction } from "../../../../autonomy/types.js";
import type { LandedOutsideChair, LandedReads, LandedRow, LandedWordsAt } from "../../../../fleet/landedTypes.js";
import { parseHandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { ok } from "../../../../lib/result.js";

export const SHA_A = "a".repeat(40);
export const URL_1843 = "https://github.com/lachiejames/slopweaver/pull/1843";

/**
 * A row as `handover register` writes one, with whatever front-matter the case adds.
 *
 * @returns the readable row, its journal empty
 */
export function rowOf({ slug, extra }: { slug: string; extra: string }): Extract<LandedRow, { kind: "read" }> {
  const text = `---\nslug: ${slug}\nkind: ask\nstatus: "ready"\naskedIso: "2026-10-05T01:00:00.000Z"\n${extra}---\n\nBody.\n`;
  return {
    archived: false,
    doc: parseHandoverDoc({ path: `/h/${slug}.md`, text }),
    events: [],
    kind: "read",
    undecoded: 0,
  };
}

/** When the change in every words case landed. */
export const MERGED = "2026-10-05T02:54:54Z";

/**
 * One ruling event on a row's journal.
 *
 * @returns the ruling event, carrying `backfilledFrom` only when the case names one
 */
export function rulingOf({
  anchor,
  decidedIso,
  backfilledFrom,
}: {
  anchor: string;
  decidedIso: string;
  backfilledFrom?: string;
}): RunEvent {
  const event: RunEvent = { anchor, atIso: decidedIso, decidedIso, kind: "ruling", ruling: "go with A" };
  if (backfilledFrom === undefined) {
    return event;
  }
  return { ...event, backfilledFrom };
}

/** Every anchor read as typed to the chair — the judgement no case but the chair's own is about. */
const IN_CHAIR: LandedOutsideChair = () => undefined;

/**
 * The reads given a case whose words come from `wordsAt`, every turn typed to the chair.
 *
 * @returns the two reads the landed-words join takes
 */
export function readsOf({ wordsAt }: { wordsAt: LandedWordsAt }): LandedReads {
  return { outsideChair: IN_CHAIR, wordsAt };
}

/**
 * A reader that finds the owner's words at every anchor, the record dated `atIso` — a plain fake, never a mock.
 *
 * @returns reads that find the same words at every anchor
 */
export function heardAt({ atIso }: { atIso: string }): LandedReads {
  return readsOf({
    wordsAt: ({ anchor }) => ok({ anchor, atIso, cut: "none", where: "call", words: "Um, yeah, let's go with A." }),
  });
}

/** The reader every case not about rulings is given: the owner's words before the merge, at whatever anchor. */
export const HEARD: LandedReads = heardAt({ atIso: "2026-10-05T01:28:00.000Z" });

export const HELD =
  'anchor: "talk-call:7a9be0d5#turn_A"\n' +
  'ownerWords: "what has landed since I last looked"\n' +
  'ownerWordsAnchor: "talk-call:7a9be0d5#turn_A"\n' +
  'ownerWordsIso: "2026-10-05T03:01:21.246Z"\n' +
  "ownerWordsWhere: call\n" +
  "ownerWordsCut: end\n";

/**
 * One act on a pull request, settled by the owner's standing self-merge rule.
 *
 * @returns the autonomy action, its class steer the self-merge rule and no later steer
 */
export function selfMerged({ subject }: { subject: string }): AutonomyAction {
  return {
    action: {
      actionId: "act-1",
      bySession: "s",
      doneIso: "2026-10-05T02:54:00.000Z",
      kind: "github.pr.self-merge",
      subject,
      witness: "github enqueue printed queued",
      why: "green and gold",
    },
    classSteer: {
      actionId: "class.self-merge-owner-prs",
      anchor: "transcript:merge-rule",
      bySession: "supervisor",
      kinds: "github.pr.self-merge",
      steer: "auto-merge pretty much any slopweaver PR",
      steeredIso: "2026-09-21T00:00:00.000Z",
    },
    latestSteer: undefined,
    patternSteer: undefined,
  };
}
