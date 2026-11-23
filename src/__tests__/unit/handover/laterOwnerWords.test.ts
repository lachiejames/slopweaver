/*
 * `handover ask`'s later-owner-words gate: which rows hold the owner's words registered after the asking row's own,
 * and the refusal until the seat names each as read. The fixture has the incident's shape, slugs synthetic.
 */
import { describe, expect, it } from "vitest";

import type { HandoverDoc } from "../../../handover/doc.js";
import {
  type LaterOwnerWordsVerdict,
  laterOwnerWordRows,
  laterOwnerWordsVerdict,
} from "../../../handover/laterOwnerWords.js";
import { doc } from "./doc/harness.js";

/** The instant the asking row's own words were recorded. */
const OWN_WORDS_ISO = "2026-11-09T03:08:49.222Z";

/** A ready, open `talk-*` ask registered at `askedIso`, carrying the owner's `words`. */
function talkRow({
  slug,
  askedIso,
  words = "take the set",
  over = {},
}: {
  slug: string;
  askedIso: string | undefined;
  words?: string;
  over?: Partial<HandoverDoc>;
}): HandoverDoc {
  return {
    ...doc({ slug }),
    askedIso,
    hisWords: {
      hisWords: {
        anchor: `talk:${slug}`,
        atIso: "2026-11-01T00:00:00.000Z",
        cut: "none",
        where: "console-voice",
        words,
      },
      kind: "held",
    },
    kind: "ask",
    ...over,
  };
}

/** The asking row: a talk row whose own words were recorded at {@link OWN_WORDS_ISO}. */
const ASKING: HandoverDoc = {
  ...talkRow({ askedIso: "2026-11-09T03:08:49.315Z", slug: "talk-aaaaaaaaaaaa", words: "bring me one set of limits" }),
  hisWords: {
    hisWords: {
      anchor: "talk:aaaa",
      atIso: OWN_WORDS_ISO,
      cut: "none",
      where: "console-voice",
      words: "bring me one set of limits",
    },
    kind: "held",
  },
};

/** The later row the incident's seat never read: the owner's "take the set", eight hours on. */
const LATER = talkRow({ askedIso: "2026-11-09T11:45:39.869Z", slug: "talk-bbbbbbbbbbbb" });

/** A refusal's lines, throwing on any other verdict so a test never reads an empty list as a pass. */
function refusedLines({ result }: { result: LaterOwnerWordsVerdict }): readonly string[] {
  if (result.kind !== "refused") {
    throw new Error(`expected a refusal, got ${result.kind}`);
  }
  return result.lines;
}

const slugs = ({ rows }: { rows: readonly HandoverDoc[] }): readonly string[] =>
  laterOwnerWordRows({ rows, selfSlug: ASKING.slug, sinceIso: OWN_WORDS_ISO }).map((row) => row.slug);

describe("laterOwnerWordRows", () => {
  it("lists the incident's later row, and never the asking row itself", () => {
    expect(slugs({ rows: [ASKING, LATER] })).toEqual(["talk-bbbbbbbbbbbb"]);
  });

  it("is empty on an empty board", () => {
    expect(slugs({ rows: [] })).toEqual([]);
  });

  it("excludes a row registered at the same instant or earlier", () => {
    const same = talkRow({ askedIso: OWN_WORDS_ISO, slug: "talk-cccccccccccc" });
    const earlier = talkRow({ askedIso: "2026-11-08T00:00:00.000Z", slug: "talk-dddddddddddd" });
    expect(slugs({ rows: [same, earlier, LATER] })).toEqual(["talk-bbbbbbbbbbbb"]);
  });

  it("excludes a settled ask, a non-ask row, a non-talk ask and a row that is not ready", () => {
    const settled = talkRow({
      askedIso: "2026-11-10T00:00:00.000Z",
      over: { settlement: "filed", settlementWitness: "talk-ffffffffffff" },
      slug: "talk-eeeeeeeeeeee",
    });
    const plain = talkRow({ askedIso: "2026-11-10T00:00:00.000Z", over: { kind: "doc" }, slug: "talk-111111111111" });
    const elsewhere = talkRow({ askedIso: "2026-11-10T00:00:00.000Z", slug: "ratchets-briefing" });
    const paused = talkRow({
      askedIso: "2026-11-10T00:00:00.000Z",
      over: { status: "paused" },
      slug: "talk-222222222222",
    });
    expect(slugs({ rows: [settled, plain, elsewhere, paused, LATER] })).toEqual(["talk-bbbbbbbbbbbb"]);
  });

  it("keeps a card row, and keeps a missing or malformed instant after every ordered one", () => {
    const card = talkRow({ askedIso: "2026-11-09T05:00:00.000Z", slug: "talk-card-333333333333" });
    const missing = talkRow({ askedIso: undefined, slug: "talk-444444444444" });
    const malformed = talkRow({ askedIso: "last tuesday", slug: "talk-555555555555" });
    expect(slugs({ rows: [malformed, missing, LATER, card] })).toEqual([
      "talk-card-333333333333",
      "talk-bbbbbbbbbbbb",
      "talk-555555555555",
      "talk-444444444444",
    ]);
  });

  it("lists a slug held by two files once", () => {
    expect(slugs({ rows: [LATER, { ...LATER, path: "/h/copy.md" }] })).toEqual(["talk-bbbbbbbbbbbb"]);
  });
});

describe("laterOwnerWordsVerdict", () => {
  const verdict = ({
    asking = ASKING,
    read,
    rows,
    unreadable = [],
  }: {
    asking?: HandoverDoc;
    read: readonly string[];
    rows: readonly HandoverDoc[];
    unreadable?: readonly string[];
  }) => laterOwnerWordsVerdict({ command: "slopweaver handover ask", doc: asking, read, rows, unreadable });

  it("refuses the incident's ask, quoting the later row and naming the exact flag to pass", () => {
    const lines = refusedLines({ result: verdict({ read: [], rows: [ASKING, LATER] }) });
    expect(lines.slice(1)).toEqual([
      '  - talk-bbbbbbbbbbbb (registered 2026-11-09T11:45:39.869Z): "take the set"',
      "NOTHING was recorded and the run is not paused. Read each row in full (`slopweaver handover row --slug " +
        "<slug> --json`); if one answers the question, act on it instead of asking. Otherwise ask again with " +
        "--read-owner-words talk-bbbbbbbbbbbb",
    ]);
    expect(lines[0]).toContain(
      "1 ready row(s) hold words the owner said after 2026-11-09T03:08:49.222Z, this row's own",
    );
  });

  it("passes once every listed row is named, a superset included", () => {
    expect(verdict({ read: ["talk-bbbbbbbbbbbb", "talk-999999999999"], rows: [ASKING, LATER] })).toEqual({
      kind: "ok",
    });
  });

  it("still refuses when only some listed rows are named, listing the rest", () => {
    const other = talkRow({ askedIso: "2026-11-10T00:00:00.000Z", slug: "talk-666666666666", words: "drop it" });
    const lines = refusedLines({ result: verdict({ read: ["talk-bbbbbbbbbbbb"], rows: [ASKING, LATER, other] }) });
    expect([lines.length, lines[1]]).toEqual([
      3,
      '  - talk-666666666666 (registered 2026-11-10T00:00:00.000Z): "drop it"',
    ]);
    expect(lines[2]).toContain("--read-owner-words talk-666666666666");
  });

  it("names a later row whose stored words are a defect by its path rather than quoting nothing", () => {
    const broken = talkRow({
      askedIso: "2026-11-10T00:00:00.000Z",
      over: { hisWords: { kind: "defect", why: "two anchors" } },
      slug: "talk-777777777777",
    });
    const lines = refusedLines({ result: verdict({ read: [], rows: [ASKING, broken] }) });
    expect(lines[1]).toBe(
      "  - talk-777777777777 (registered 2026-11-10T00:00:00.000Z): its stored words are a defect (two anchors) — read /h/talk-777777777777.md",
    );
  });

  it("is ok on a row carrying no words of the owner, which has no instant to measure from", () => {
    expect(verdict({ asking: doc({ slug: "plain-work" }), read: [], rows: [LATER] })).toEqual({ kind: "ok" });
  });

  it("refuses when a talk row could not be read, and ignores an unreadable row of any other family", () => {
    const lost = refusedLines({ result: verdict({ read: [], rows: [ASKING], unreadable: ["talk-888888888888.md"] }) });
    const unrelated = verdict({ read: [], rows: [ASKING], unreadable: ["ratchets-briefing.md"] });
    expect([lost.slice(1), unrelated]).toEqual([
      [
        "  - unreadable: talk-888888888888.md",
        "NOTHING was recorded. Repair or remove each file named, then ask again — or, having read one by hand and " +
          "found nothing that answers the question, name its slug in --read-owner-words.",
      ],
      { kind: "ok" },
    ]);
  });

  it("passes an unreadable talk row the seat names as read by hand, so one corrupt file cannot hold every ask", () => {
    expect(verdict({ read: ["talk-888888888888"], rows: [ASKING], unreadable: ["talk-888888888888.md"] })).toEqual({
      kind: "ok",
    });
  });
});
