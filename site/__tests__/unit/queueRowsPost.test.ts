/*
 * A parked as-me draft, from the document `slopweaver slack draft list --json` prints to the queue row: the
 * row must say in words that it posts as the owner, and name who it tags rather than printing their Slack ids.
 * Driven through the real reader so the roster the verb resolved is what is under test.
 */

import { describe, expect, it } from "vitest";

import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { cardAddresses } from "../../lib/cardAddresses";
import { openCardPlan } from "../../lib/openCard";
import type { BriefingCard, CardHead } from "../../lib/queueCard";
import { rowForOpen } from "../../lib/queueOpen";
import { heldReplyLineOf, reviewLineFor } from "../../lib/queueReviewLine";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-23T04:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** The shape of sd-39f8a0e2: the author wrote two raw ids, and the roster names all three people. */
const LISTED = {
  items: [
    {
      draft: {
        advisory: [],
        authorId: "U0SYN000001",
        channel: "C0SYN000001",
        digest: "3f2a9c11d4e5b6a7",
        mentions: [
          { key: "U0SYN000003", kind: "person", target: "U0SYN000003" },
          { key: "U0SYNUNKNOWN", kind: "person", target: "U0SYNUNKNOWN" },
        ],
        payload: { text: "<@U0SYN000003> <@U0SYNUNKNOWN> the vanta groups never got created." },
        shape: "top-level",
        tsIso: "2026-09-23T03:00:00.000Z",
        why: "the vanta group question",
      },
      id: "sd-39f8a0e2",
      release: {
        command: "slopweaver slack post --as me --draft sd-39f8a0e2 --approve 3f2a9c11d4e5b6a7",
        kind: "send",
      },
      state: "held",
    },
  ],
  people: [
    { bot: false, handle: "ada.owner", name: "Ada Owner", nativeId: "U0SYN000001" },
    { bot: false, handle: "ari.singh", name: "Ari", nativeId: "U0SYN000003" },
  ],
};

function onlyRow({ listed = LISTED }: { listed?: unknown } = {}): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: readParkedDrafts(listed)! }),
    reviews: LOADING,
    imports: LOADING,
  });
  expect(rows.length).toBe(1);
  return rows[0];
}

/** The head of a row's card, the card asserted to be a briefing so the narrowing is a checked fact. */
function headOf({ row }: { row: QueueRow }): CardHead {
  expect(row.card.kind).toBe("briefing");
  return (row.card as BriefingCard).head!;
}

/** The listed document with its one draft re-addressed — a DM by member id, or a channel by id and name. */
function readdressed({ channel, channelName }: { channel: string; channelName?: string }): unknown {
  const [item] = LISTED.items;
  return {
    ...LISTED,
    items: [{ ...item, draft: { ...item.draft, channel, ...(channelName === undefined ? {} : { channelName }) } }],
  };
}

describe("a parked as-me draft, from the listed document to the queue row", () => {
  it("says in words that it posts as the owner", () => {
    expect(onlyRow().pill).toBe("posts as you");
  });

  it("leads its what with the receipts line, and names the gap when the draft names none", () => {
    expect(onlyRow().card.what!.whole.startsWith("No receipts named.")).toBe(true);
  });

  it("names who it tags, drawing an id the roster cannot name as the id", () => {
    expect(onlyRow().card.what!.whole).toContain("It tags 2: Ari, U0SYNUNKNOWN.");
  });

  it("names the person a DM goes to by member id in the head, never in the title", () => {
    const row = onlyRow({ listed: readdressed({ channel: "U0SYN000003" }) });
    expect(row.card.question).toBe("Post this as you?");
    expect(row.card.subject).toBe("to Ari in a direct message");
    expect(headOf({ row })).toEqual({
      act: undefined,
      context: "in a direct message",
      people: [{ id: "U0SYN000003", label: "Ari" }],
      peopleVerb: "To",
    });
  });

  it("draws a DM recipient the roster cannot name as the id, never a guessed name", () => {
    expect(headOf({ row: onlyRow({ listed: readdressed({ channel: "U0NOBODY" }) }) }).people).toEqual([
      { id: "U0NOBODY", label: "U0NOBODY" },
    ]);
  });

  it("names the channel as its context and the people it tags as its people row in a channel post", () => {
    const row = onlyRow({ listed: readdressed({ channel: "C0SYN000001", channelName: "proj-launch-room" }) });
    expect(row.card.question).toBe("Post this as you?");
    expect(headOf({ row })).toEqual({
      act: undefined,
      context: "in #proj-launch-room",
      people: [
        { id: "U0SYN000003", label: "Ari" },
        { id: "U0SYNUNKNOWN", label: "U0SYNUNKNOWN" },
      ],
      peopleVerb: "To",
    });
  });

  it("keeps the raw destination id findable by the queue filter", () => {
    expect(onlyRow({ listed: readdressed({ channel: "U0SYN000003" }) }).hint).toContain("U0SYN000003");
  });
});

describe("a parked draft whose why names the page behind it", () => {
  const page = "file:///Users/someone/.slopweaver/pages/vanta-groups/index.html";
  const [item] = LISTED.items;
  const listed = {
    ...LISTED,
    items: [{ ...item, draft: { ...item.draft, why: `the vanta groups, read ${page} first` } }],
  };

  it("names the page in its what and hands the address to the pages row, never mid-sentence", () => {
    const card = onlyRow({ listed }).card;
    expect(card.what!.whole).toContain("the vanta groups, read the vanta-groups page first");
    expect(card.what!.whole).not.toContain("file://");
    expect(card.pages).toEqual([{ slug: "vanta-groups", url: page }]);
  });
});

describe("a parked draft carrying a video", () => {
  const media = [{ bytes: 2747, name: "walkthrough.mp4", sha256: "a".repeat(64) }];
  const [item] = LISTED.items;
  const release = {
    command: "slopweaver slack post --as me --draft sd-39f8a0e2 --approve 9e1d0c3b2a4f5e6d",
    kind: "send",
  };
  const listed = {
    ...LISTED,
    items: [{ ...item, draft: { ...item.draft, digest: "9e1d0c3b2a4f5e6d", media }, release }],
  };

  it("offers the release under the digest that binds the attachment, never an older one", () => {
    expect(onlyRow({ listed }).card).toMatchObject({
      options: [
        {
          how: {
            command: "slopweaver slack post --as me --draft sd-39f8a0e2 --approve 9e1d0c3b2a4f5e6d",
            kind: "elsewhere",
            where: "a session, through the door",
          },
          letter: "A",
        },
        {},
        {},
      ],
    });
  });

  it("carries the attachment on the row the slide-over draws the message from", () => {
    expect(onlyRow({ listed }).record).toMatchObject({ kind: "post", post: { media } });
  });
});

describe("a parked thread reply — the placement two drafts once lost", () => {
  const [item] = LISTED.items;
  const command = "slopweaver slack reply --as me --draft sd-39f8a0e2 --approve 3f2a9c11d4e5b6a7";
  const listed = {
    ...LISTED,
    items: [
      {
        ...item,
        draft: {
          ...item.draft,
          channelName: "proj-launch-room",
          shape: "thread",
          threadParent: { text: "which groups do we need?", userId: "U0SYN000003" },
          threadTs: "1789407961.767649",
        },
        release: { command, kind: "send" },
      },
    ],
  };

  it("asks about it as a reply into the thread, and names the message it goes under", () => {
    const row = onlyRow({ listed });
    expect(row.card.question).toBe("Reply with this as you?");
    expect(headOf({ row }).context).toBe('on Ari\'s thread in #proj-launch-room: "which groups do we need?"');
    expect(row.card.what!.whole).toContain('It replies under Ari\'s message: "which groups do we need?".');
  });

  it("offers the release through slack reply, never slack post", () => {
    expect(onlyRow({ listed }).card).toMatchObject({
      options: [{ how: { command, kind: "elsewhere", where: "a session, through the door" }, letter: "A" }, {}, {}],
    });
  });
});

describe("the post's review-before-sending line", () => {
  it("shows the message it would post, each tag named the way the card names it", () => {
    expect(reviewLineFor({ row: onlyRow() })).toBe("@Ari @U0SYNUNKNOWN the vanta groups never got created.");
  });
});

describe("the post's review line, over every tag shape Slack writes", () => {
  it("names a labelled person, a user group and an unrecorded person as the card would", () => {
    const [item] = LISTED.items;
    const listed = {
      ...LISTED,
      items: [
        {
          ...item,
          draft: {
            ...item.draft,
            mentions: [
              { key: "@ari.singh", kind: "person", target: "U0SYN000003" },
              { key: "@platform", kind: "group", target: "S0PLATFORM" },
            ],
            payload: { text: "<@U0SYN000003|ari> ping <!subteam^S0PLATFORM|@platform> and <@U0SYNNOTRECORDED>" },
          },
        },
      ],
    };
    expect(reviewLineFor({ row: onlyRow({ listed }) })).toBe("@Ari ping @platform and @U0SYNNOTRECORDED");
  });

  it("names a group the post never recorded by the handle the wire carried, else as a group — never its S… id", () => {
    const [item] = LISTED.items;
    const listed = {
      ...LISTED,
      items: [
        {
          ...item,
          draft: {
            ...item.draft,
            mentions: [],
            payload: { text: "<!subteam^S0SYN000012|@platform> and <!subteam^S0SYN000012> can you review" },
          },
        },
      ],
    };
    expect(reviewLineFor({ row: onlyRow({ listed }) })).toBe("@platform and @a group can you review");
  });
});

describe("the post's review line over a link", () => {
  /** The listed document with its one draft carrying the payload a real parked post carried, tagging Rosa. */
  function carrying({ text }: { text: string }): unknown {
    const [item] = LISTED.items;
    return {
      ...LISTED,
      items: [
        {
          ...item,
          draft: {
            ...item.draft,
            mentions: [{ key: "U0SYN000002", kind: "person", target: "U0SYN000002" }],
            payload: { text },
          },
        },
      ],
      people: [...LISTED.people, { bot: false, handle: "rosa", name: "Rosa Lindqvist", nativeId: "U0SYN000002" }],
    };
  }

  it("reads a Vanta document link as its label, never its markup", () => {
    const text =
      "<@U0SYN000002> i went ahead and updated <https://app.vanta.com/documents/change-management-procedures|Change management procedure documentation>\n\ntldr it walks one real change through approval, review, testing and release, which i reckon an auditor wants more than the spec link on its own. your link's still there, short briefing attached";
    expect(reviewLineFor({ row: onlyRow({ listed: carrying({ text }) }) })).toBe(
      "@Rosa Lindqvist i went ahead and updated Change management procedure documentation tldr it walks one real change through approval, review,…",
    );
  });

  it("reads a pull-request link as its label, never its markup", () => {
    const text =
      "<@U0SYN000002> bump on <https://github.com/acme/acme-admin/pull/18209|take Morgan off the event-kit alerting codeowners #18209> when you get a sec. should be a quick one i think, 2 lines in CODEOWNERS and it just needs a platform tick";
    expect(reviewLineFor({ row: onlyRow({ listed: carrying({ text }) }) })).toBe(
      "@Rosa Lindqvist bump on take Morgan off the event-kit alerting codeowners #18209 when you get a sec. should be a quick one i think, 2 lines…",
    );
  });

  it("reads a bare link as its address, a channel, a broadcast and a date as Slack draws them, and an escape once", () => {
    const text =
      "<https://example.com/run> in <#C0ENG|dev> <!here> by <!date^1791345380^{date_short}|the date> p95 &lt; 2s &amp;amp; up";
    expect(reviewLineFor({ row: onlyRow({ listed: carrying({ text }) }) })).toBe(
      "https://example.com/run in #dev @here by the date p95 < 2s &amp; up",
    );
  });

  it("names a person off the roster when only a GROUP record shares its id", () => {
    const [item] = LISTED.items;
    const listed = {
      ...LISTED,
      items: [
        {
          ...item,
          draft: {
            ...item.draft,
            mentions: [{ key: "@platform", kind: "group", target: "U0SYN000003" }],
            payload: { text: "<@U0SYN000003|ignored> hello" },
          },
        },
      ],
    };
    expect(reviewLineFor({ row: onlyRow({ listed }) })).toBe("@Ari hello");
  });
});

describe("a held reply's review line", () => {
  it("names a tagged team by its handle, else as a group, and leaves a `<` in the prose as it is", () => {
    expect(
      heldReplyLineOf({
        text: "<!subteam^S0SYN000012|@platform> p95 < 2s now, <!subteam^S0SYN000012> can you check, not <!subteam^X123>",
      }),
    ).toBe("@platform p95 < 2s now, @a group can you check, not <!subteam^X123>");
  });

  it("reads a person and a link as words, and leaves prose, a typed escape and a cut token as written", () => {
    expect(
      heldReplyLineOf({
        text: "<@U0SYN000002|rosa> see <https://example.com/a|the runbook> or <https://example.com/b>; p95 < 2s &amp; holding <https://example.com/unfinished",
      }),
    ).toBe("@rosa see the runbook or https://example.com/b; p95 < 2s &amp; holding <https://example.com/unfinished");
  });

  it("reads a link whose address ends at its scheme as its label, or as the scheme when it has none", () => {
    expect(heldReplyLineOf({ text: "see <mailto:|email> or <mailto:>" })).toBe("see email or mailto:");
  });
});

describe("a parked post's own addresses, as evidence for its card's words", () => {
  it("carries every pull-request and Linear address its message names, markup stripped", () => {
    const [item] = LISTED.items;
    const listed = {
      ...LISTED,
      items: [
        {
          ...item,
          draft: {
            ...item.draft,
            mentions: [],
            payload: {
              text: "<https://github.com/lachiejames/slopweaver/pull/716|#716> is ready, see https://linear.app/acme/issue/QQQQ-134.",
            },
            why: "review PR #716 and QQQQ-134 before sending",
          },
        },
      ],
    };
    expect(cardAddresses({ row: onlyRow({ listed }) })).toEqual([
      "https://github.com/lachiejames/slopweaver/pull/716",
      "https://linear.app/acme/issue/QQQQ-134",
    ]);
  });
});

describe("a re-cut post answers to the cut it replaced", () => {
  // A reading from before the re-cut opens `post:sd-4a8cf941`; a console that had read the re-cut must not draw
  // "No register currently holds a row" over a draft `slack draft show` held.
  const [item] = LISTED.items;
  const listed = {
    ...LISTED,
    items: [
      {
        ...item,
        draft: { ...item.draft, digest: "ed919bf6acc33f9a" },
        id: "sd-89cb672a",
        release: {
          command: "slopweaver slack post --as me --draft sd-89cb672a --approve ed919bf6acc33f9a",
          kind: "send",
        },
      },
      {
        draft: { ...item.draft, digest: "a43c06dee79b4dbc" },
        id: "sd-4a8cf941",
        outcome: "superseded by sd-89cb672a (recorded with --supersedes)",
        resolvedIso: "2026-10-20T12:27:30.193Z",
        state: "dropped",
      },
    ],
  };

  it("draws the live cut alone, answering to the dropped cut's key", () => {
    const row = onlyRow({ listed });
    expect([row.key, row.aliases]).toEqual(["post:sd-89cb672a", ["post:sd-4a8cf941"]]);
  });

  it("opens the live cut from the dropped cut's key, on the console and through the voice's plan", () => {
    const rows = [onlyRow({ listed })];
    expect(rowForOpen({ open: "post:sd-4a8cf941", rows })!.key).toBe("post:sd-89cb672a");
    const plan = openCardPlan({ fromPath: "/queue", key: "post:sd-4a8cf941", recentlyLeft: [], rows })!;
    expect([plan.row.id, plan.removed, plan.path]).toEqual([
      "sd-89cb672a",
      undefined,
      "/queue?open=post%3Asd-89cb672a&by=voice",
    ]);
  });

  it("gives a post nothing was re-cut into no aliases", () => {
    expect(onlyRow().aliases).toBe(undefined);
  });
});
