/*
 * The stage's conversation: every turn is history, one still being said at its foot, the owner's
 * typing indicator stands in while they are heard before their words are, the history follows new lines until they scroll
 * up off the bottom, and a long finished turn of the owner's folds to its two ends.
 */
import { describe, expect, it } from "vitest";

import {
  FOLD_EDGE_CHARS,
  foldOf,
  followsAfterScroll,
  type HeardSegment,
  HISTORY_BOTTOM_SLACK_PX,
  isAtBottom,
  messengerPreviewOf,
  SAID_MOMENTS,
  saidPreviewOf,
  shownConversationOf,
  shownSegmentOf,
  speakingIndicatorShows,
  stageConversationOf,
  withHeardSegment,
} from "../../lib/voiceTranscript";

describe("shownConversationOf", () => {
  const live: readonly HeardSegment[] = [{ final: true, id: "a", text: "hello", who: "owner" }];

  it("feeds the live turns and hearing with no preview", () => {
    const shown = shownConversationOf({
      hearing: false,
      kept: 40,
      preview: undefined,
      segments: live,
    });
    expect(shown.history).toEqual(live);
    expect(shown.hearing).toBe(false);
    expect(shown.previewed).toBe(false);
  });

  it("feeds a said moment's turns and hearing in place of the live ones, for the messenger as for the stage", () => {
    const preview = "?stage=star-cluster&said=mid-turn";
    const said = saidPreviewOf({ search: preview })!;
    const shown = shownConversationOf({ hearing: false, kept: 40, preview, segments: live });
    expect(shown.history).toEqual(said.segments);
    expect(shown.hearing).toBe(true);
    expect(shown.previewed).toBe(true);
  });

  it("keeps the live turns under a stage preview that asks for no said moment", () => {
    const shown = shownConversationOf({
      hearing: true,
      kept: 40,
      preview: "?stage=star-cluster",
      segments: live,
    });
    expect(shown.history).toEqual(live);
    expect(shown.hearing).toBe(true);
    expect(shown.previewed).toBe(false);
  });
});

/** A segment, finished unless said otherwise. */
const seg = ({ id, who = "owner", text = id, final = true }: Partial<HeardSegment> & { id: string }): HeardSegment => ({
  final,
  id,
  text,
  who,
});

describe("withHeardSegment", () => {
  it("grows a shown stretch where it stands and finishes it in place", () => {
    const held = [seg({ id: "a" }), seg({ final: false, id: "b", text: "hel" })];
    const grown = withHeardSegment({ heard: seg({ final: false, id: "b", text: "hello" }), held, kept: 5 });
    expect(grown.map((entry) => entry.text)).toEqual(["a", "hello"]);
    const done = withHeardSegment({ heard: seg({ id: "b", text: "hello there" }), held: grown, kept: 5 });
    expect(done.at(-1)).toEqual(seg({ id: "b", text: "hello there" }));
  });

  it("appends a new stretch and lets the oldest fall off past the kept count", () => {
    const held = [seg({ id: "a" }), seg({ id: "b" }), seg({ id: "c" })];
    expect(withHeardSegment({ heard: seg({ id: "d" }), held, kept: 3 }).map((entry) => entry.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("keeps only the new stretch when one is kept, and starts an empty conversation", () => {
    expect(withHeardSegment({ heard: seg({ id: "z" }), held: [seg({ id: "a" })], kept: 1 })).toEqual([
      seg({ id: "z" }),
    ]);
    expect(withHeardSegment({ heard: seg({ id: "a" }), held: [], kept: 4 })).toEqual([seg({ id: "a" })]);
  });
});

describe("shownSegmentOf", () => {
  it("names a stretch by its call, so a reconnect's repeated id joins the end instead of overwriting the old turn", () => {
    const old = shownSegmentOf({ call: "c1", final: true, speech: { id: "item-1", text: "old words", who: "owner" } });
    const fresh = shownSegmentOf({
      call: "c2",
      final: false,
      speech: { id: "item-1", text: "new words", who: "voice" },
    });
    expect(old).toEqual({ final: true, id: "c1:item-1", text: "old words", who: "owner" });
    expect(withHeardSegment({ heard: fresh, held: [old], kept: 5 }).map((entry) => entry.id)).toEqual([
      "c1:item-1",
      "c2:item-1",
    ]);
  });

  it("still grows a stretch of the same call in place", () => {
    const said = shownSegmentOf({ call: "c1", final: false, speech: { id: "item-1", text: "hel", who: "owner" } });
    const grown = shownSegmentOf({ call: "c1", final: true, speech: { id: "item-1", text: "hello", who: "owner" } });
    expect(withHeardSegment({ heard: grown, held: [said], kept: 5 })).toEqual([grown]);
  });
});

describe("stageConversationOf", () => {
  const segments = [
    seg({ id: "1" }),
    seg({ id: "2", who: "voice" }),
    seg({ id: "3" }),
    seg({ final: false, id: "4", who: "voice" }),
  ];

  it("shows a turn still being said at the foot of the history", () => {
    const split = stageConversationOf({ kept: 10, segments });
    expect(split.history.map((entry) => entry.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("counts an unfinished turn in the kept window, so it pushes the oldest finished one out", () => {
    expect(stageConversationOf({ kept: 2, segments }).history.map((entry) => entry.id)).toEqual(["3", "4"]);
  });

  it("drops an unfinished turn too old for the history", () => {
    const stranded = [seg({ final: false, id: "dropped" }), seg({ id: "a" }), seg({ id: "b" })];
    const split = stageConversationOf({ kept: 2, segments: stranded });
    expect(split.history.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("draws nothing for a conversation not yet begun", () => {
    expect(stageConversationOf({ kept: 10, segments: [] })).toEqual({ history: [] });
  });
});

describe("speakingIndicatorShows", () => {
  it("shows while the owner is heard and none of their words are recognised yet", () => {
    expect(speakingIndicatorShows({ hearing: true, segments: [] })).toBe(true);
    expect(speakingIndicatorShows({ hearing: true, segments: [seg({ id: "a" })] })).toBe(true);
  });

  it("shows while the owner talks over the voice's own unfinished turn", () => {
    const segments = [seg({ final: false, id: "v", who: "voice" })];
    expect(speakingIndicatorShows({ hearing: true, segments })).toBe(true);
  });

  it("gives way to the owner's words once they arrive", () => {
    const segments = [seg({ id: "a" }), seg({ final: false, id: "b", text: "open the" })];
    expect(speakingIndicatorShows({ hearing: true, segments })).toBe(false);
  });

  it("never shows while the owner is not heard", () => {
    expect(speakingIndicatorShows({ hearing: false, segments: [] })).toBe(false);
  });
});

describe("saidPreviewOf", () => {
  const texts = ({ search }: { search: string }): readonly string[] =>
    saidPreviewOf({ search })!.segments.map((entry) => `${entry.who}:${String(entry.final)}:${entry.text}`);

  it("draws the owner's turn heard with no words, mid-turn, and settled in the same row", () => {
    expect(SAID_MOMENTS).toEqual(["speaking", "mid-turn", "settled", "folded", "linked"]);
    expect(saidPreviewOf({ search: "?stage=star-cluster&said=speaking" })!.hearing).toBe(true);
    expect(texts({ search: "?said=speaking" })).toHaveLength(2);
    expect(saidPreviewOf({ search: "?said=mid-turn" })!.hearing).toBe(true);
    expect(texts({ search: "?said=mid-turn" }).at(-1)).toBe("owner:false:Open the review ask first, and read me the");
    expect(saidPreviewOf({ search: "?said=settled" })!.hearing).toBe(false);
    expect(texts({ search: "?said=settled" }).at(-1)).toBe(
      "owner:true:Open the review ask first, and read me the diff.",
    );
    expect(saidPreviewOf({ search: "?said=mid-turn" })!.segments.at(-1)!.id).toBe(
      saidPreviewOf({ search: "?said=settled" })!.segments.at(-1)!.id,
    );
  });

  it("draws a long settled turn of the owner's that folds, then the voice's answer that stays open", () => {
    const segments = saidPreviewOf({ search: "?said=folded" })!.segments;
    expect(saidPreviewOf({ search: "?said=folded" })!.hearing).toBe(false);
    expect(segments.map((entry) => `${entry.who}:${String(entry.final)}`)).toEqual([
      "owner:true",
      "voice:true",
      "owner:true",
      "voice:true",
    ]);
    expect(foldOf({ text: segments.at(-2)!.text }).kind).toBe("folded");
    expect(foldOf({ text: segments.at(-1)!.text }).kind).toBe("whole");
  });

  it("draws a turn of the owner's carrying one unbroken link, then the voice's long answer as the newest turn", () => {
    const linked = saidPreviewOf({ search: "?said=linked" })!;
    expect(linked.hearing).toBe(false);
    expect(linked.segments.map((entry) => `${entry.who}:${String(entry.final)}`)).toEqual([
      "owner:true",
      "voice:true",
      "owner:true",
      "voice:true",
    ]);
    expect(linked.segments.at(-2)!.text).toBe(
      "Have a look at https://acme.slack.com/archives/C0SYN7REVIEWASK/p1760012345678901?thread_ts=1760012345.678901&cid=C0SYN7REVIEWASK and tell me what it needs from me",
    );
    expect(linked.segments.at(-1)!.text).toBe(
      "That thread is the review ask on the console pull request. It needs one thing from you: a yes on the two files inside the Queue page, since its checks are already green. On the next item, which bothers you most now: slow replies, interruptions, or replies that go on too long?",
    );
  });

  it("draws no moment for an address that asks for none, an unknown one, or two", () => {
    expect(saidPreviewOf({ search: "?stage=star-cluster" })).toBeUndefined();
    expect(saidPreviewOf({ search: "?said=typing" })).toBeUndefined();
    expect(saidPreviewOf({ search: "?said=speaking&said=settled" })).toBeUndefined();
  });
});

describe("messengerPreviewOf", () => {
  it("hands the messenger a said moment with no stage drawn, so its history can be photographed", () => {
    expect(messengerPreviewOf({ callActive: false, search: "?said=linked" })).toBe("?said=linked");
    expect(messengerPreviewOf({ callActive: false, search: "?stage=star-cluster&said=folded" })).toBe(
      "?stage=star-cluster&said=folded",
    );
  });

  it("never replaces a live call's turns", () => {
    expect(messengerPreviewOf({ callActive: true, search: "?said=linked" })).toBeUndefined();
  });

  it("hands over nothing for an address with no said moment, or an unknown one", () => {
    expect(messengerPreviewOf({ callActive: false, search: "" })).toBeUndefined();
    expect(messengerPreviewOf({ callActive: false, search: "?stage=star-cluster" })).toBeUndefined();
    expect(messengerPreviewOf({ callActive: false, search: "?said=typing" })).toBeUndefined();
  });
});

describe("isAtBottom", () => {
  it("is at the bottom when scrolled fully down, or within the slack of it", () => {
    expect(isAtBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 600 })).toBe(true);
    expect(isAtBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 600 - HISTORY_BOTTOM_SLACK_PX })).toBe(true);
  });

  it("holds the view once the owner has scrolled up past the slack", () => {
    expect(isAtBottom({ clientHeight: 400, scrollHeight: 1000, scrollTop: 600 - HISTORY_BOTTOM_SLACK_PX - 1 })).toBe(
      false,
    );
  });

  it("is at the bottom when everything fits", () => {
    expect(isAtBottom({ clientHeight: 400, scrollHeight: 300, scrollTop: 0 })).toBe(true);
  });
});

describe("followsAfterScroll", () => {
  it("stays pinned through the arrow's smooth scroll, every step of it short of the bottom", () => {
    // Each step down read `isAtBottom` false and unpinned it.
    let following = true;
    let last = 100;
    for (const top of [180, 320, 480]) {
      following = followsAfterScroll({ atBottom: false, following, lastScrollTop: last, scrollTop: top });
      last = top;
    }
    expect(following).toBe(true);
  });

  it("lets go only when the owner scrolls up off the bottom", () => {
    expect(followsAfterScroll({ atBottom: false, following: true, lastScrollTop: 600, scrollTop: 540 })).toBe(false);
  });

  it("keeps following a scroll up that stays within the bottom's slack", () => {
    expect(followsAfterScroll({ atBottom: true, following: true, lastScrollTop: 600, scrollTop: 590 })).toBe(true);
  });

  it("pins again when the owner scrolls back down to the bottom", () => {
    expect(followsAfterScroll({ atBottom: true, following: false, lastScrollTop: 300, scrollTop: 600 })).toBe(true);
  });

  it("stays held while the owner scrolls down but not yet to the bottom", () => {
    expect(followsAfterScroll({ atBottom: false, following: false, lastScrollTop: 300, scrollTop: 400 })).toBe(false);
  });
});

describe("foldOf", () => {
  /** A turn of `words` distinct words, so a slice's first and last word name where it was cut. */
  const ramble = ({ words }: { words: number }): string =>
    Array.from({ length: words }, (_, index) => `w${String(index)}`).join(" ");
  /** The two ends of a turn that must fold; a turn left whole throws, failing the case. */
  const endsOf = ({ text }: { text: string }): { head: string; tail: string } => {
    const fold = foldOf({ text });
    if (fold.kind === "whole") {
      throw new Error("expected the turn to fold");
    }
    return fold;
  };

  it("leaves a turn whole that reads at a glance", () => {
    expect(foldOf({ text: "Open the review ask first, and read me the diff." })).toEqual({ kind: "whole" });
    expect(foldOf({ text: "x".repeat(FOLD_EDGE_CHARS * 2 + 60) })).toEqual({ kind: "whole" });
  });

  it("folds a long turn to where it started and where it landed, cut on a space, never a word twice", () => {
    const text = ramble({ words: 120 });
    const { head, tail } = endsOf({ text });
    expect(head.startsWith("w0 w1 ")).toBe(true);
    expect(tail.endsWith(" w118 w119")).toBe(true);
    expect(head.length).toBeLessThanOrEqual(FOLD_EDGE_CHARS);
    expect(tail.length).toBeLessThanOrEqual(FOLD_EDGE_CHARS);
    const headWords = head.split(" ");
    const tailWords = tail.split(" ");
    expect(text.startsWith(`${head} `)).toBe(true);
    expect(text.endsWith(` ${tail}`)).toBe(true);
    expect(headWords.filter((word) => tailWords.includes(word))).toEqual([]);
  });

  it("leaves a turn whole when an end has no space to cut on", () => {
    expect(foldOf({ text: "y".repeat(FOLD_EDGE_CHARS * 3) })).toEqual({ kind: "whole" });
    expect(foldOf({ text: `${ramble({ words: 60 })} ${"z".repeat(FOLD_EDGE_CHARS + 10)}` })).toEqual({ kind: "whole" });
  });

  it("measures the turn without the leading space a transcript carries", () => {
    expect(endsOf({ text: ` ${ramble({ words: 120 })}` }).head.startsWith("w0 ")).toBe(true);
  });
});
