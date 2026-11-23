/*
 * The parked drafts a decision names by id — the lookup that puts the post on a "post it now, or hold it" card.
 */

import { describe, expect, it } from "vitest";

import { type ParkedDraft, readParkedDrafts } from "../../components/live/readSlackDrafts";
import { type LiveState, liveStateAfter } from "../../lib/liveState";
import {
  drawnDraftIds,
  drawnOnceForm,
  droppedCutIdsEndingAt,
  type NamedDraft,
  namedDrafts,
  slackDraftIdsIn,
} from "../../lib/slackDraftIds";

describe("slackDraftIdsIn", () => {
  it("reads an id a link label completes, and one inside a bare link target", () => {
    expect(
      slackDraftIdsIn({ texts: ["Review sd-<https://example.test|deadbeef> first", "<https://x.test/sd-a0615cb5>"] }),
    ).toEqual(["sd-deadbeef", "sd-a0615cb5"]);
  });

  it("reads an id the mrkdwn renderer draws whole, and keeps one only the raw text carries", () => {
    expect(
      slackDraftIdsIn({
        texts: ["Review sd-*deadbeef* before posting", "*sd-a0615cb5*x", "then sd-*f6b4af59**x", "s_d-e8ecf199_"],
      }),
    ).toEqual(["sd-deadbeef", "sd-a0615cb5", "sd-f6b4af59", "sd-e8ecf199"]);
  });

  it("finds every whole id across the fields, first seen first, each once", () => {
    expect(
      slackDraftIdsIn({
        texts: [
          "post draft sd-e8ecf199 to #dev-team now",
          undefined,
          "or send sd-39f8a0e2 first, then sd-e8ecf199 again",
        ],
      }),
    ).toEqual(["sd-e8ecf199", "sd-39f8a0e2"]);
  });

  it("refuses a short, long, upper-case or embedded id", () => {
    expect(
      slackDraftIdsIn({ texts: ["sd-e8ecf19 sd-e8ecf1990 sd-E8ECF199 xsd-e8ecf199 sd-e8ecf199-2 sd-e8ecf199x"] }),
    ).toEqual([]);
  });

  it("finds nothing in no text", () => {
    expect(slackDraftIdsIn({ texts: [] })).toEqual([]);
  });
});

describe("namedDrafts", () => {
  const register = readParkedDrafts({
    items: [
      {
        draft: {
          advisory: [],
          channel: "C0SYN000002",
          digest: "0000",
          mentions: [],
          payload: { text: "held" },
          shape: "top-level",
          tsIso: "2026-09-26T03:39:00.000Z",
          why: "held one",
        },
        id: "sd-aaaaaaaa",
        release: { command: "slopweaver slack post --as me --draft sd-aaaaaaaa --approve 0000", kind: "send" },
        state: "held",
      },
      {
        draft: {
          advisory: [],
          channel: "C0SYN000002",
          digest: "0001",
          mentions: [],
          payload: { text: "dropped" },
          shape: "top-level",
          tsIso: "2026-09-26T03:38:00.000Z",
          why: "dropped one",
        },
        id: "sd-bbbbbbbb",
        outcome: "moot: nobody needs it now",
        resolvedIso: "2026-09-26T03:40:00.000Z",
        state: "dropped",
      },
    ],
    people: [],
  })!;

  /** One cut of a re-cut chain, as `slack draft list --json` prints it. */
  const cut = ({
    id,
    state,
    outcome,
    text,
  }: {
    id: string;
    state: "held" | "released" | "dropped";
    outcome?: string;
    text: string;
  }): Record<string, unknown> => ({
    draft: {
      advisory: [],
      channel: "C0SYN000003",
      digest: `digest-${id}`,
      mentions: [],
      payload: { text },
      shape: "top-level",
      tsIso: "2026-09-28T06:26:18.449Z",
      why: text,
    },
    id,
    ...(outcome === undefined ? {} : { outcome }),
    ...(state === "held"
      ? { release: { command: `slopweaver slack post --as me --draft ${id} --approve digest-${id}`, kind: "send" } }
      : { resolvedIso: "2026-09-28T09:29:37.167Z" }),
    state,
  });

  /** `sd-2a84c6d4` re-cut as `sd-1cdf3a4c`, superseded in turn by `sd-19bcb871`. */
  const chain = ({ last }: { last: "held" | "released" }): readonly ParkedDraft[] =>
    readParkedDrafts({
      items: [
        cut({
          id: "sd-19bcb871",
          state: last,
          text: "third cut",
          ...(last === "released" ? { outcome: "C0 1.2" } : {}),
        }),
        cut({
          id: "sd-1cdf3a4c",
          outcome: "superseded by sd-19bcb871, with the priority reason",
          state: "dropped",
          text: "second cut",
        }),
        cut({
          id: "sd-2a84c6d4",
          outcome: "re-cut as sd-1cdf3a4c in the finding shape",
          state: "dropped",
          text: "first cut",
        }),
        cut({ id: "sd-e86bb49f", state: "released", text: "PROOF copy of sd-1cdf3a4c", outcome: "D0 3.4" }),
      ],
      people: [],
    })!;

  it("resolves a dropped id through its drop notes to the live held cut, the dropped cuts named first", () => {
    const [named] = namedDrafts({ ids: ["sd-2a84c6d4"], posts: { phase: "ready", value: chain({ last: "held" }) } });
    const recut = named as Extract<NamedDraft, { kind: "recut" }>;
    expect([recut.kind, recut.id, recut.live.id, recut.live.state]).toEqual([
      "recut",
      "sd-2a84c6d4",
      "sd-19bcb871",
      "held",
    ]);
    expect(recut.superseded.map((draft) => [draft.id, draft.outcome])).toEqual([
      ["sd-2a84c6d4", "re-cut as sd-1cdf3a4c in the finding shape"],
      ["sd-1cdf3a4c", "superseded by sd-19bcb871, with the priority reason"],
    ]);
  });

  describe("droppedCutIdsEndingAt", () => {
    it("answers every dropped cut whose chain ends on the live cut, one hop or two, in register order", () => {
      const items = chain({ last: "held" });
      expect(droppedCutIdsEndingAt({ id: "sd-19bcb871", items })).toEqual(["sd-1cdf3a4c", "sd-2a84c6d4"]);
    });

    it("answers nothing for a cut nothing was re-cut into, nor a mid-chain cut whose chain runs on past it", () => {
      const items = chain({ last: "held" });
      expect(droppedCutIdsEndingAt({ id: "sd-e86bb49f", items })).toEqual([]);
      expect(droppedCutIdsEndingAt({ id: "sd-1cdf3a4c", items })).toEqual([]);
    });

    it("leaves out a dropped cut with no successor, one re-cut elsewhere, and the live cut itself", () => {
      const items = readParkedDrafts({
        items: [
          cut({ id: "sd-89cb672a", state: "held", text: "the recut" }),
          cut({ id: "sd-ca65820a", state: "held", text: "another held one" }),
          cut({ id: "sd-4a8cf941", outcome: "superseded by sd-89cb672a", state: "dropped", text: "first" }),
          cut({ id: "sd-11111111", outcome: "moot: nobody needs it now", state: "dropped", text: "moot" }),
          cut({ id: "sd-22222222", outcome: "superseded by sd-ca65820a", state: "dropped", text: "elsewhere" }),
        ],
        people: [],
      })!;
      expect(droppedCutIdsEndingAt({ id: "sd-89cb672a", items })).toEqual(["sd-4a8cf941"]);
    });

    it("names a predecessor the register repeats once", () => {
      const first = cut({ id: "sd-4a8cf941", outcome: "superseded by sd-89cb672a", state: "dropped", text: "first" });
      const items = readParkedDrafts({
        items: [cut({ id: "sd-89cb672a", state: "held", text: "the recut" }), first, first],
        people: [],
      })!;
      expect(droppedCutIdsEndingAt({ id: "sd-89cb672a", items })).toEqual(["sd-4a8cf941"]);
    });
  });

  it("names a live cut missing its finding proof as sent back once, through its drop notes too, drawing none of its words", () => {
    const posts = readParkedDrafts({
      items: [
        { ...cut({ id: "sd-b5a68451", state: "held", text: "many tier 3 customers" }), proofMissing: ["screenshot"] },
        cut({ id: "sd-aaaaaaa1", outcome: "re-cut as sd-b5a68451", state: "dropped", text: "first cut" }),
      ],
      people: [],
    })!;
    const named = namedDrafts({ ids: ["sd-aaaaaaa1", "sd-b5a68451"], posts: { phase: "ready", value: posts } });
    expect(named).toEqual([{ id: "sd-b5a68451", kind: "proof-missing", missing: ["screenshot"] }]);
  });

  it("resolves to a live cut that was already sent, so the card says so rather than offering a send", () => {
    const [named] = namedDrafts({
      ids: ["sd-1cdf3a4c"],
      posts: { phase: "ready", value: chain({ last: "released" }) },
    });
    const recut = named as Extract<NamedDraft, { kind: "recut" }>;
    expect([recut.kind, recut.live.id, recut.live.state]).toEqual(["recut", "sd-19bcb871", "released"]);
    expect(recut.superseded.map((draft) => draft.id)).toEqual(["sd-1cdf3a4c"]);
  });

  it("ends a chain on a re-cut that was itself dropped with no re-cut named, so the card folds that one too", () => {
    const posts = readParkedDrafts({
      items: [
        cut({ id: "sd-1cdf3a4c", outcome: "moot: already fixed", state: "dropped", text: "second cut" }),
        cut({ id: "sd-2a84c6d4", outcome: "re-cut as sd-1cdf3a4c", state: "dropped", text: "first cut" }),
      ],
      people: [],
    })!;
    const [named] = namedDrafts({ ids: ["sd-2a84c6d4"], posts: { phase: "ready", value: posts } });
    const recut = named as Extract<NamedDraft, { kind: "recut" }>;
    expect([recut.kind, recut.live.id, recut.live.state]).toEqual(["recut", "sd-1cdf3a4c", "dropped"]);
    expect(recut.superseded.map((draft) => draft.id)).toEqual(["sd-2a84c6d4"]);
  });

  it("leaves a dropped draft whose note names no re-cut as spent, never recut", () => {
    expect(
      namedDrafts({ ids: ["sd-bbbbbbbb"], posts: { phase: "ready", value: register } }).map((named) => named.kind),
    ).toEqual(["spent"]);
  });

  it("carries a dropped draft's note through the reader, and none on a held one", () => {
    expect(register.map((draft) => [draft.id, draft.outcome])).toEqual([
      ["sd-aaaaaaaa", undefined],
      ["sd-bbbbbbbb", "moot: nobody needs it now"],
    ]);
  });

  it("resolves each id to held, spent or absent, in the order the ids came", () => {
    expect(
      namedDrafts({
        ids: ["sd-cccccccc", "sd-bbbbbbbb", "sd-aaaaaaaa"],
        posts: { phase: "ready", value: register },
      }).map((named) => [named.kind, named.id]),
    ).toEqual([
      ["absent", "sd-cccccccc"],
      ["spent", "sd-bbbbbbbb"],
      ["held", "sd-aaaaaaaa"],
    ]);
  });

  it("answers unread for every id while the register is still being read", () => {
    expect(namedDrafts({ ids: ["sd-aaaaaaaa"], posts: { phase: "loading" } })).toEqual([
      { id: "sd-aaaaaaaa", kind: "unread" },
    ]);
  });

  it("answers not-measured with the register's own reason when it could not be read, never unread", () => {
    expect(
      namedDrafts({ ids: ["sd-aaaaaaaa"], posts: { phase: "not-measured", why: "slack draft list exited 1" } }),
    ).toEqual([{ id: "sd-aaaaaaaa", kind: "not-measured", why: "slack draft list exited 1" }]);
  });

  it("answers nothing for no ids", () => {
    expect(namedDrafts({ ids: [], posts: { phase: "ready", value: register } })).toEqual([]);
  });

  // A card's question names the live cut, its still-real line the dropped first cut.
  it("draws a live cut named beside the dropped cut before it once, as held, with no re-cut", () => {
    expect(
      namedDrafts({
        ids: ["sd-19bcb871", "sd-1cdf3a4c"],
        posts: { phase: "ready", value: chain({ last: "held" }) },
      }).map((named) => [named.kind, named.id]),
    ).toEqual([["held", "sd-19bcb871"]]);
  });

  it("puts the one draw where the first of the two ids stood, whichever came first", () => {
    expect(
      namedDrafts({
        ids: ["sd-2a84c6d4", "sd-cccccccc", "sd-19bcb871"],
        posts: { phase: "ready", value: chain({ last: "held" }) },
      }).map((named) => [named.kind, named.id]),
    ).toEqual([
      ["held", "sd-19bcb871"],
      ["absent", "sd-cccccccc"],
    ]);
  });

  it("draws a live cut already sent once too, as spent", () => {
    expect(
      namedDrafts({
        ids: ["sd-19bcb871", "sd-2a84c6d4"],
        posts: { phase: "ready", value: chain({ last: "released" }) },
      }).map((named) => [named.kind, named.id]),
    ).toEqual([["spent", "sd-19bcb871"]]);
  });

  it("folds two dropped ids re-cut to one unnamed live cut into one re-cut, the history in chain order", () => {
    const named = namedDrafts({
      ids: ["sd-1cdf3a4c", "sd-2a84c6d4"],
      posts: { phase: "ready", value: chain({ last: "held" }) },
    });
    expect(named.map((one) => [one.kind, one.id])).toEqual([["recut", "sd-1cdf3a4c"]]);
    const recut = named[0] as Extract<NamedDraft, { kind: "recut" }>;
    expect([recut.live.id, ...recut.superseded.map((draft) => draft.id)]).toEqual([
      "sd-19bcb871",
      "sd-2a84c6d4",
      "sd-1cdf3a4c",
    ]);
  });
});

describe("drawnOnceForm", () => {
  const posts = readParkedDrafts({
    items: [
      {
        draft: {
          advisory: [],
          channel: "C0SYN000007",
          digest: "live",
          mentions: [],
          payload: { text: "the post" },
          shape: "top-level",
          tsIso: "2026-10-01T13:23:52.000Z",
          why: "the re-cut",
        },
        id: "sd-695c4598",
        release: { command: "slopweaver slack post --as me --draft sd-695c4598 --approve live", kind: "send" },
        state: "held",
      },
      {
        draft: {
          advisory: [],
          channel: "C0SYN000007",
          digest: "first",
          mentions: [],
          payload: { text: "the first cut" },
          shape: "top-level",
          tsIso: "2026-10-01T13:00:00.000Z",
          why: "the first cut",
        },
        id: "sd-7bb49482",
        outcome: "superseded by sd-695c4598 (recorded with --supersedes)",
        resolvedIso: "2026-10-01T13:23:52.632Z",
        state: "dropped",
      },
    ],
    people: [],
  })!;
  const live = posts.find((draft) => draft.id === "sd-695c4598")!;
  const first = posts.find((draft) => draft.id === "sd-7bb49482")!;

  it("refuses a card drawn with a superseded draft left uncollapsed, naming the draft drawn twice", () => {
    const uncollapsed: readonly NamedDraft[] = [
      { draft: live, id: "sd-695c4598", kind: "held" },
      { id: "sd-7bb49482", kind: "recut", live, superseded: [first] },
    ];
    expect(drawnDraftIds({ named: uncollapsed })).toEqual(["sd-695c4598", "sd-695c4598", "sd-7bb49482"]);
    expect(drawnOnceForm({ named: uncollapsed })).toEqual({
      kind: "refused",
      why:
        "This card would draw draft sd-695c4598 more than once, so it is refused rather than drawn long. That is a " +
        "defect in how the card resolves the drafts it names, not two drafts to judge.",
    });
  });

  it("draws the same card once it is resolved through namedDrafts", () => {
    const named = namedDrafts({ ids: ["sd-695c4598", "sd-7bb49482"], posts: { phase: "ready", value: posts } });
    expect(drawnDraftIds({ named })).toEqual(["sd-695c4598"]);
    expect(drawnOnceForm({ named })).toEqual({ kind: "drawn" });
  });

  it("draws a card naming no draft", () => {
    expect(drawnOnceForm({ named: [] })).toEqual({ kind: "drawn" });
  });
});

describe("liveStateAfter over the parked-draft register", () => {
  const earlier: LiveState<readonly ParkedDraft[]> = {
    fixture: undefined,
    observedAtIso: "2026-09-28T05:10:30.000Z",
    phase: "ready",
    stampedByRoute: false,
    value: readParkedDrafts({
      items: [
        {
          draft: {
            advisory: [],
            channel: "U0SYN000006",
            digest: "d047",
            mentions: [],
            payload: { text: "yo jasper" },
            shape: "top-level",
            tsIso: "2026-09-28T05:10:00.000Z",
            why: "the retro",
          },
          id: "sd-47684195",
          release: { command: "slopweaver slack post --as me --draft sd-47684195 --approve d047", kind: "send" },
          state: "held",
        },
      ],
      people: [],
    })!,
  };
  const failed: LiveState<readonly ParkedDraft[]> = {
    phase: "not-measured",
    why: "the as-me draft register could not be read: line 91 is not an event this version writes",
  };

  it("draws the draft a card already showed when the next read fails, never the error tile", () => {
    const named = namedDrafts({
      ids: ["sd-47684195"],
      posts: liveStateAfter({ current: failed, previous: earlier }),
    });
    expect(named.map((one) => one.kind)).toEqual(["held"]);
  });
});
