/*
 * A card that failed its own gate never reaches the owner's Queue: a parked post whose why named its source call
 * by id opened in front of the owner as one italic refusal and no draft. Driven through the real reader and `rowsOf`, so the
 * refusal under test is the one the machine-id gate actually writes.
 */

import { describe, expect, it } from "vitest";

import { readParkedDrafts } from "../../components/live/readSlackDrafts";
import type { LiveState } from "../../components/live/useLive";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { heldForOpen, partitionQueueRows, withheldForOpen, withheldSentence } from "../../lib/queueWithholding";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-10-09T05:50:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** One held as-me post in a listed document, under `id`, parked for `why`. */
function held({ id, why }: { id: string; why: string }): unknown {
  return {
    draft: {
      advisory: [],
      authorId: "U0SYN000001",
      channel: "C0SYN000001",
      channelName: "ask-product-help",
      digest: "3f2a9c11d4e5b6a7",
      mentions: [],
      payload: { text: "hey team, a few customers might still be getting charged full price while holding a credit" },
      shape: "top-level",
      tsIso: "2026-10-09T01:29:37.485Z",
      why,
    },
    id,
    release: { command: `slopweaver slack post --as me --draft ${id} --approve 3f2a9c11d4e5b6a7`, kind: "send" },
    state: "held",
  };
}

/** Every row `rowsOf` builds from the posts register alone, holding `items`. */
function postRows({ items }: { items: readonly unknown[] }): readonly QueueRow[] {
  const listed = { items, people: [{ bot: false, handle: "ada", name: "Ada Owner", nativeId: "U0SYN000001" }] };
  return rowsOf({
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: ready({ value: readParkedDrafts(listed)! }),
    reviewers: LOADING,
    standing: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
}

const INCIDENT = held({
  id: "sd-e523766e",
  why: "recut on the owner's word (talk-call efe7b241, 01:16Z): a top-level ask",
});
const CLEAN = held({
  id: "sd-39f8a0e2",
  why: "the payments team's intake channel, owner unknown so the team is tagged",
});

describe("partitionQueueRows", () => {
  it("withholds the incident's post, whose why named its source call by id, and draws the clean one", () => {
    const rows = postRows({ items: [INCIDENT, CLEAN] });
    expect(rows.map((row) => [row.key, row.record.form.kind])).toEqual([
      ["post:sd-e523766e", "refused"],
      ["post:sd-39f8a0e2", "drawn"],
    ]);
    const split = partitionQueueRows({ rows });
    expect(split.rows.map((row) => row.key)).toEqual(["post:sd-39f8a0e2"]);
    expect(split.withheld).toEqual([
      {
        aliases: [],
        key: "post:sd-e523766e",
        kind: "post",
        placement: rows[0].placement,
        title: "Post this as you?",
        why:
          "This card's what names a session, call, talk, turn or run by its machine id, so it is refused rather than " +
          "drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
      },
    ]);
  });

  it("withholds nothing and keeps the order when every card passes", () => {
    const rows = postRows({ items: [CLEAN, held({ id: "sd-1a2b3c4d", why: "a second clean ask" })] });
    const split = partitionQueueRows({ rows });
    expect(split.rows.map((row) => row.key)).toEqual(["post:sd-39f8a0e2", "post:sd-1a2b3c4d"]);
    expect(split.withheld).toEqual([]);
  });

  it("keeps a refused act, whose refusal is the Alignment page's lookup state, not a failed gate", () => {
    const [post] = postRows({ items: [INCIDENT] });
    const act = { ...post, kind: "act", key: "act:a1" } as unknown as QueueRow;
    expect(partitionQueueRows({ rows: [act] }).rows.map((row) => row.key)).toEqual(["act:a1"]);
  });
});

describe("opening a withheld card", () => {
  const rows = postRows({ items: [INCIDENT, CLEAN] });
  const { rows: drawn, withheld } = partitionQueueRows({ rows });

  it("resolves its key, and an alias it answered to, to the withholding", () => {
    const aliased = [{ ...withheld[0], aliases: ["ask:payments-credit"] }];
    expect(withheldForOpen({ open: "post:sd-e523766e", withheld })!.key).toBe("post:sd-e523766e");
    expect(withheldForOpen({ open: "ask:payments-credit", withheld: aliased })!.key).toBe("post:sd-e523766e");
    expect(withheldForOpen({ open: "post:sd-39f8a0e2", withheld })).toBe(undefined);
  });

  it("draws the held note only when no drawn row answers to the key", () => {
    expect(heldForOpen({ every: drawn, live: undefined, open: "post:sd-e523766e", withheld })!.key).toBe(
      "post:sd-e523766e",
    );
    expect(heldForOpen({ every: drawn, live: undefined, open: "post:sd-39f8a0e2", withheld })).toBe(undefined);
    expect(heldForOpen({ every: drawn, live: drawn[0], open: "post:sd-e523766e", withheld })).toBe(undefined);
    expect(heldForOpen({ every: drawn, live: undefined, open: null, withheld })).toBe(undefined);
  });
});

describe("withheldSentence", () => {
  it("says nothing at zero, and counts one card and many", () => {
    expect(withheldSentence({ count: 0 })).toBe(undefined);
    expect(withheldSentence({ count: 1 })).toBe(
      "1 card failed its own checks, so it is held off this Queue until the supervisor fixes it.",
    );
    expect(withheldSentence({ count: 3 })).toBe(
      "3 cards failed their own checks, so they are held off this Queue until the supervisor fixes them.",
    );
  });
});
