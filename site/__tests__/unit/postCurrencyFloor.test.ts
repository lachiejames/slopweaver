import { describe, expect, it } from "vitest";

import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { sinceWords } from "../../lib/cardCurrencyHalves";
import { postCurrencyFloorIso } from "../../lib/postCurrencyFloor";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

/** A register the page has read. */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-02T10:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

const PARKED = "2026-10-02T09:00:00.000Z";
const PICKED = "2026-10-02T09:10:00.000Z";
const REVISED = "2026-10-02T09:20:00.000Z";

describe("postCurrencyFloorIso", () => {
  it("floors a post never reworked at its park", () => {
    expect(postCurrencyFloorIso({ post: { comparison: undefined, tsIso: PARKED } })).toBe(PARKED);
  });

  it("floors a picked post at the owner's pick, and a revised one at its newest version over the pick", () => {
    const picked = { comparison: { pick: { atIso: PICKED, variant: "codex" as const } }, tsIso: PARKED };
    const revised = { ...picked, versions: [{ atIso: PICKED }, { atIso: REVISED }] };

    expect([postCurrencyFloorIso({ post: picked }), postCurrencyFloorIso({ post: revised })]).toEqual([
      PICKED,
      REVISED,
    ]);
  });
});

describe("a revised post, from the listed document to its Queue row", () => {
  /** One held as-me draft as `slack draft list --json` prints it, revised once on a call. */
  const listed = ({ versions }: { versions?: readonly unknown[] }) => ({
    items: [
      {
        draft: {
          advisory: [],
          authorId: "U0SYN000001",
          channel: "C0SYN000001",
          digest: "3f2a9c11d4e5b6a7",
          mentions: [],
          payload: { text: "the vanta groups never got created." },
          shape: "top-level",
          tsIso: PARKED,
          why: "the vanta group question",
        },
        id: "sd-39f8a0e2",
        release: {
          command: "slopweaver slack post --as me --draft sd-39f8a0e2 --approve 3f2a9c11d4e5b6a7",
          kind: "send",
        },
        state: "held",
        ...(versions === undefined ? {} : { versions }),
      },
    ],
    people: [{ bot: false, handle: "ada.owner", name: "Ada Owner", nativeId: "U0SYN000001" }],
  });
  const rowOf = ({ document }: { document: unknown }): QueueRow => {
    const rows = rowsOf({
      acts: LOADING,
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      imports: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: ready({ value: readParkedDrafts(document)! }),
      reviewers: LOADING,
      reviews: LOADING,
      standing: LOADING,
    });
    expect(rows.length).toBe(1);
    return rows[0];
  };

  it("keeps its when at the park and floors its currency at the newest version, the producer's instant", () => {
    const versions = [
      { atIso: PARKED, number: 1, text: "the vanta groups never got created." },
      { atIso: REVISED, heard: "say they were never made", number: 2, text: "the vanta groups were never made." },
    ];
    const plain = rowOf({ document: listed({}) });
    const revised = rowOf({ document: listed({ versions }) });

    expect([plain.key, plain.whenIso, plain.currencyFloorIso]).toEqual(["post:sd-39f8a0e2", PARKED, PARKED]);
    expect([revised.key, revised.whenIso, revised.currencyFloorIso]).toEqual(["post:sd-39f8a0e2", PARKED, REVISED]);
  });
});

describe("sinceWords for a parked post", () => {
  it("counts from its words being written, never from when it reached the owner", () => {
    const row = { floorIso: REVISED, since: { gaps: [], words: [] } };

    expect([
      sinceWords({ row: { ...row, key: "post:d1" } }),
      sinceWords({ row: { ...row, key: "review:r1" } }),
    ]).toEqual(["its words were last written", "it reached you"]);
  });
});
