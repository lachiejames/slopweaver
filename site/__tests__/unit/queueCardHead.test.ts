/*
 * The card head — act badge, people row by id, plain context line, the owner's words folded under one "bears on"
 * line — on four real cards, driven through the real readers and `rowsOf`.
 *
 * Each draft is its register row as `slack draft list --json --all` prints one, the fields a card reads copied
 * verbatim and put back to `held` so the queue draws it; `act` is what the chase recipe records, and the no-badge
 * case is the same row without it. The roster is that reading's own. The ask is the policy-mirror row as
 * `handover list --json` prints one, restored to the moment it waited on the owner: once answered, it no longer
 * carries a `question` or waits on them.
 */

import { describe, expect, it } from "vitest";

import { readBoard } from "../../components/live/read";
import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { cardPeople } from "../../lib/personMentions";
import type { BriefingCard } from "../../lib/queueCard";
import { drawsPeopleRow } from "../../lib/queueCard";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { sourceBlockCopy } from "../../lib/sourceBlock";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const OWNER = "U0SYN000001";
const SETH = "U0SYN000013";
const ANSEL = "U0SYN000020";
const JASPER = "U0SYN000006";
const DM_PEER = "U0SYN000002";

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-30T12:30:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The roster the reading carried for these drafts. Seth Tanner's whole name is NOT unique to one person. */
const PEOPLE = [
  {
    bot: false,
    firstNameUnique: true,
    handle: "ada.owner",
    name: "Ada Owner",
    nameUnique: true,
    nativeId: OWNER,
  },
  { bot: false, firstNameUnique: false, handle: "seth.tanner", name: "Seth Tanner", nameUnique: false, nativeId: SETH },
  { bot: false, firstNameUnique: true, handle: "ansel", name: "Ansel Jory", nameUnique: true, nativeId: ANSEL },
  {
    bot: false,
    firstNameUnique: false,
    handle: "jasper.nolan",
    name: "Jasper Nolan",
    nameUnique: true,
    nativeId: JASPER,
  },
  {
    bot: false,
    firstNameUnique: true,
    handle: "rosa.lindqvist",
    name: "Rosa Lindqvist",
    nameUnique: true,
    nativeId: DM_PEER,
  },
];

/** sd-babd8c5a — the Seth Tanner and Ansel bump on the owner's own thread in #temp-claude-max-rollout. */
const SETH_BUMP = {
  authorId: OWNER,
  channel: "C0SYN000030",
  channelName: "temp-claude-max-rollout",
  digest: "9ec281cd8bff7b85e784985c328d9e82",
  mentions: [
    { key: SETH, kind: "person", target: SETH },
    { key: ANSEL, kind: "person", target: ANSEL },
  ],
  payload: {
    text: `<@${SETH}> bumping this one, i think you're the one who can approve the new plan names on the team calendar. is that ok to go ahead with? <@${ANSEL}> is a weekly summary of who is on which plan enough for you, or do you want a page that updates as people switch?`,
  },
  shape: "thread",
  threadParent: {
    permalink: "https://acme.slack.com/archives/C0SYN000030/p1789712232549289",
    text: `<@${ANSEL}> <@${SETH}> i'll take the lead on this. options coming, here's the first: <https://app.notion.com/p/Proposal-budget-Claude-and-Codex-plans-on-an-Acme-domain-0000000000000000000000000000a007|budget claude and codex plans on an acme domain>  the first of a few…`,
    userId: OWNER,
  },
  threadTs: "1789712232.549289",
  tsIso: "2026-09-30T08:27:10.902Z",
  why: "chase: claude plan domain, Seth and Ansel",
};

/** sd-6c89a869 — the Jasper bump on the owner's own thread in #proj-monitoring. */
const JASPER_BUMP = {
  authorId: OWNER,
  channel: "C0SYN000007",
  channelName: "proj-monitoring",
  digest: "c380c17bdd8043179d43600cc702b3f6",
  mentions: [{ key: JASPER, kind: "person", target: JASPER }],
  payload: {
    text: `<@${JASPER}> does about 5 PRs a week off the top of For Review sound like the right pace to you? and should the untyped spans go first, or the billing-api DuplicateExportError batch like i had it?`,
  },
  shape: "thread",
  threadParent: {
    permalink: "https://acme.slack.com/archives/C0SYN000007/p1790648151107569",
    text: "yo, we said we wanted error tracking heading toward zero. pulled some numbers and i think we're a fair way off  48% of prod error spans last week (106k of 221k) have no error.type, so error tracking never groups them. mostly http and grpc client spans in jobs-api, checkout-api, p…",
    userId: OWNER,
  },
  threadTs: "1790648151.107569",
  tsIso: "2026-09-30T08:27:19.879Z",
  why: "chase: error tracking top-n shape, Jasper",
};

/** sd-32e9b613 — the platform codeowner review ask, top-level in a DM recorded against the peer's member id. */
const REVIEW_ASK = {
  authorId: OWNER,
  channel: DM_PEER,
  digest: "7e8da9cfe2415dfe5f26dc07a5aed1a9",
  mentions: [],
  payload: {
    text: "yo, could you give <https://github.com/acme/acme-admin/pull/18119|run the advisory local E2E suite on the merge queue #18119> a platform tick when you get a sec? it touches .github\n\nit moves the advisory local E2E lanes off every PR push and onto the merge queue, which i think is where you wanted them. still advisory, so a red lane can't fail the queue. no rush",
  },
  shape: "top-level",
  tsIso: "2026-09-30T11:03:27.792Z",
  why: "first platform codeowner review ask on acme-admin, reworded so one pull request is named and the ask leads; the owner pre-approved the send once reworded",
};

/** One real draft, held, with the act the recorder declared — or none, as every row before `--act` was recorded. */
function held({ id, draft, act }: { id: string; draft: Record<string, unknown>; act: string | undefined }): unknown {
  return {
    draft: { advisory: [], ...draft, ...(act === undefined ? {} : { act }) },
    id,
    release: {
      command: `slopweaver slack post --as me --draft ${id} --approve ${String(draft["digest"])}`,
      kind: "send",
    },
    state: "held",
  };
}

/** The post rows `rowsOf` stands up for these drafts, by id. */
function postRows({ items }: { items: readonly unknown[] }): {
  rows: readonly QueueRow[];
  drafts: readonly ParkedDraft[];
} {
  const drafts = readParkedDrafts({ items, people: PEOPLE })!;
  const rows = rowsOf({
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: drafts }),
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  return { drafts, rows };
}

/** The briefing card on the row keyed `key`, asserted to be one so the narrowing is a checked fact. */
function briefingOn({ rows, key }: { rows: readonly QueueRow[]; key: string }): BriefingCard {
  const card = rows.find((row) => row.key === key)!.card;
  expect(card.kind).toBe("briefing");
  return card as BriefingCard;
}

describe("the Seth Tanner bump, sd-babd8c5a", () => {
  const { drafts, rows } = postRows({ items: [held({ act: "bump", draft: SETH_BUMP, id: "sd-babd8c5a" })] });
  const card = briefingOn({ key: "post:sd-babd8c5a", rows });

  it("badges a Bump and nudges Seth and Ansel BY ID, in the draft's own order", () => {
    expect(card.head).toEqual({
      act: "bump",
      context: `on your thread in #temp-claude-max-rollout: "@Ansel Jory @Seth Tanner i'll take the lead on this."`,
      people: [
        { id: SETH, label: "Seth Tanner" },
        { id: ANSEL, label: "Ansel Jory" },
      ],
      peopleVerb: "Nudging",
    });
  });

  it("chips Seth: the roster keys the person by id although the whole name is not unique", () => {
    const known = cardPeople({ board: [], owner: OWNER, roster: drafts[0].people });
    expect(known.get(SETH)!.name).toBe("Seth Tanner");
    expect(known.get(SETH)!.nameUnique).toBe(false);
  });

  it("titles WHAT it sends, no name in it, so no chip can land mid-sentence", () => {
    expect(card.question).toBe("Send this bump as you?");
    expect(drawsPeopleRow({ card })).toBe(true);
  });
});

describe("the Jasper bump, sd-6c89a869", () => {
  const { rows } = postRows({ items: [held({ act: "bump", draft: JASPER_BUMP, id: "sd-6c89a869" })] });
  const card = briefingOn({ key: "post:sd-6c89a869", rows });

  it("badges a Bump, nudges Jasper by id, and opens the context on the owner's own thread's first sentence", () => {
    expect(card.head).toEqual({
      act: "bump",
      context: `on your thread in #proj-monitoring: "yo, we said we wanted error tracking heading toward zero."`,
      people: [{ id: JASPER, label: "Jasper Nolan" }],
      peopleVerb: "Nudging",
    });
    expect(card.question).toBe("Send this bump as you?");
  });
});

describe("the platform review ask, sd-32e9b613", () => {
  const { rows } = postRows({ items: [held({ act: "review-ask", draft: REVIEW_ASK, id: "sd-32e9b613" })] });
  const card = briefingOn({ key: "post:sd-32e9b613", rows });

  it("badges a Review ask and asks the DM peer, named off the roster by the id it was recorded against", () => {
    expect(card.head).toEqual({
      act: "review-ask",
      context: "in a direct message",
      people: [{ id: DM_PEER, label: "Rosa Lindqvist" }],
      peopleVerb: "Asking",
    });
    expect(card.question).toBe("Send this review ask as you?");
  });
});

describe("a row recorded before --act", () => {
  const { rows } = postRows({ items: [held({ act: undefined, draft: SETH_BUMP, id: "sd-babd8c5a" })] });
  const card = briefingOn({ key: "post:sd-babd8c5a", rows });

  it("draws NO badge and keeps the old title, while still chipping its people by id", () => {
    expect(card.head!.act).toBe(undefined);
    expect(card.head!.peopleVerb).toBe("To");
    expect(card.head!.people.map((person) => person.id)).toEqual([SETH, ANSEL]);
    expect(card.question).toBe("Reply with this as you?");
  });
});

/** The owner's words at the policy-mirror row's anchor, verbatim as the board published them — cut at the end. */
const POLICY_WORDS = `[Image #83] <pasted_content id="3236"> For this one... I'm a little confused, cause like I thought our process was kind of just putting stuff in GitHub for them to review. But now it looks like we're putting the PDFs in Slack for them, because there was one recently with Rosa. I think we were talking about like software development lifecycle or something of that nature. And they put in some like analytics proposal Notion doc thing that people were iterating on... and then I propose this like larger set of evidence... um... and had like a lot of screenshots and markdown and all that. And I don't think Rosa ever actually got back to us and said "yeah, your evidence looks good, upload that into Vanta" and I'll approve it or whatever. Probably should chase that if the conversation has stalled. But yeah, cuz I did kinda push back in that thread and say that I think that the other evidence that was previously there and sitting in draft was like something in order to my pushback on or ask about, and I'm just trying to minimize to minimize the risk of an auditor needing to ask about something. And that's sort of how I think about putting in the evidence. So yeah... Anyway, coming back to this Slack draft, the other issue here is that like I can't really see what's in these drafts because you said we said that there's two PDFs attached, but in our cue card I can't see these PDFs. I can't see the contents of these docs. I don't know what changes we've made to these docs or this evidenc`;

const POLICY_ANCHOR = "transcript:a0000049-0000-4000-8000-000000000052#6ebc1b20-e271-4b5b-8b75-d45a5ad9ba4b";

/** The policy-mirror ask as it stood on the owner's queue, with the one line `register --bears-on` now records. */
const POLICY_ASK = {
  anchor: POLICY_ANCHOR,
  bearsOn: "you said you cannot see the evidence in the drafts, so this asks whether the mirror should carry the files",
  blastRadius: "acme-admin's policy-mirror-dogfood branch and everyone with acme-admin read access",
  blockedBy: [],
  hisWords: {
    anchor: POLICY_ANCHOR,
    atIso: "2026-09-30T05:35:37.148Z",
    cut: "end",
    where: "session",
    words: POLICY_WORDS,
  },
  kind: "ask",
  lean: "keep metadata only for now, since git history is permanent and one wrong isSensitive flag would publish a person's file",
  options: [
    {
      letter: "A",
      option: "keep metadata only",
      tradeoff: "reviewers open Vanta to read any file; nothing new leaves Vanta",
    },
    {
      letter: "B",
      option: "add bytes for requests Vanta marks not-sensitive",
      tradeoff: "files land in acme-admin's git history for good, and a mis-flagged file cannot be taken back out",
    },
    {
      letter: "C",
      option: "add bytes for an allowlist of request ids you name",
      tradeoff: "you pick each one, so nothing leaks by default; the list needs upkeep",
    },
  ],
  ownerWait: "owner",
  prUrls: [],
  priority: "p2",
  problem:
    "The mirror shows each evidence request's status, dates, file kinds and controls, but no file names or bytes, so a reviewer still opens Vanta to read the evidence",
  question: "Should the mirror carry the evidence files themselves, not just their metadata?",
  reason: "waiting on the owner",
  risk: "a file copied into git stays in its history even after it is deleted",
  section: "WAITING ON YOU",
  slug: "should-policy-mirror-dogfood-mirror-the-evidence-files",
  status: "waiting",
  summary: "Should policy-mirror-dogfood mirror the evidence FILES themselves, not just their metadata?",
};

describe("the policy-mirror ask", () => {
  const rows = rowsOf({
    acts: LOADING,
    board: ready({ value: readBoard({ rows: [POLICY_ASK], unresolved: 0 })! }),
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  const row = rows.find((one) => one.key === `ask:${POLICY_ASK.slug}`)!;

  it("badges a Question, names nobody and draws no people row", () => {
    const card = briefingOn({ key: row.key, rows });
    expect(card.head).toEqual({ act: "question", context: undefined, people: [], peopleVerb: "To" });
    expect(drawsPeopleRow({ card })).toBe(false);
  });

  it("puts the bears-on line above the owner's words and folds the words shut, sized", () => {
    const copy = sourceBlockCopy({ source: row.source });
    expect(copy.bearsOn).toBe(POLICY_ASK.bearsOn);
    expect(copy.fold!.aboutChars).toBe("1,500");
    expect(copy.words!.text).toBe(POLICY_WORDS);
  });
});
