/*
 * The reader for `slopweaver slack draft list --json`, against the exact payload shape the verb prints.
 *
 * What is really under test is the refusal: the panel this feeds draws the bytes a release would post, so a
 * row it cannot read whole must take the WHOLE reading down rather than draw a message with a run missing.
 * A preview that silently dropped a paragraph would show the owner something other than what they are approving.
 */

import { describe, expect, it } from "vitest";

import { draftAuthorName } from "../../components/console/draftAuthor";
import { isParked, readParkedDrafts } from "../../components/live/readSlackDrafts";

/** One `rich_text` message as the one-card form emits it: a paragraph, a bulleted list, then a close. */
const RICH = {
  blocks: [
    {
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "Four groups", type: "text" },
            { text: ", one question. ", type: "text" },
            { type: "user", user_id: "U0SYNADAOWN" },
            { text: " ", type: "text" },
            { label: "the thread", text: "the thread", type: "link", url: "https://acme.slack.com/archives/C1/p2" },
          ],
          type: "rich_text_section",
        },
        {
          elements: [
            { elements: [{ text: "Everyone", type: "text" }], type: "rich_text_section" },
            { elements: [{ text: "Staff", type: "text" }], type: "rich_text_section" },
          ],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    },
  ],
  text: "Four groups, one question.\n\nEveryone\nStaff",
};

/** How the verb says the fixture's held row goes out. */
const SEND = { command: "slopweaver slack post --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7", kind: "send" };

/** The one-draft payload with its row's `media` field set to exactly `media`. */
function withMedia({ media }: { media: unknown }): unknown {
  const bag = payload() as { items: { draft: Record<string, unknown> }[] };
  bag.items[0].draft["media"] = media;
  return bag;
}

/** The one-draft payload with `fields` laid over its row's draft — an `undefined` value removes that field. */
function withDraft({ fields }: { fields: Record<string, unknown> }): unknown {
  const bag = payload() as { items: { draft: Record<string, unknown> }[] };
  bag.items[0].draft = defined({ bag: { ...bag.items[0].draft, ...fields } });
  return bag;
}

/** `bag` without the keys whose value is `undefined`, as `JSON.stringify` would print it. */
function defined({ bag }: { bag: Record<string, unknown> }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(bag).filter(([, value]) => value !== undefined));
}

/** The one-draft payload with `fields` laid over its row itself — an `undefined` value removes that field. */
function withItem({ fields }: { fields: Record<string, unknown> }): unknown {
  const bag = payload() as { items: Record<string, unknown>[] };
  bag.items[0] = defined({ bag: { ...bag.items[0], ...fields } });
  return bag;
}

/** A whole `--json` payload holding one held draft. */
function payload({
  blocks = RICH,
  state = "held",
  resolvedIso,
  people,
}: { blocks?: unknown; state?: string; resolvedIso?: string; people?: unknown } = {}): unknown {
  return {
    ...(people === undefined ? {} : { people }),
    items: [
      {
        draft: {
          advisory: ["the opener runs longer than the owner's measured median"],
          authorId: "U0SYNADAOWN",
          channel: "C0ISO",
          channelName: "iso-27001",
          digest: "3f2a9c11d4e5b6a7",
          mentions: [{ key: "@ada", kind: "person", target: "U0SYNADAOWN" }],
          payload: blocks,
          shape: "top-level",
          tsIso: "2026-09-23T02:10:00.000Z",
          why: "the entry-group question the four-group thread left open",
        },
        id: "sd-1a2b3c4d",
        ...(state === "held" ? { release: SEND } : {}),
        ...(resolvedIso === undefined ? {} : { resolvedIso }),
        state,
      },
    ],
  };
}

describe("readParkedDrafts", () => {
  it("reads the runs rather than a flattened string, so the panel can draw Slack's own styling", () => {
    const drafts = readParkedDrafts(payload())!;
    expect(drafts.length).toBe(1);
    const first = drafts[0].lines[0];
    expect(first.marker).toBe(undefined);
    expect(first.runs).toEqual([
      { bold: true, code: false, italic: false, kind: "text", text: "Four groups" },
      { bold: false, code: false, italic: false, kind: "text", text: ", one question. " },
      { kind: "user", userId: "U0SYNADAOWN" },
      { bold: false, code: false, italic: false, kind: "text", text: " " },
      { kind: "link", label: "the thread", url: "https://acme.slack.com/archives/C1/p2" },
    ]);
  });

  it("gives a bulleted list one line per item, each carrying its own marker", () => {
    const lines = readParkedDrafts(payload())![0].lines;
    expect(lines.length).toBe(3);
    expect(lines[1].marker).toBe("•");
    expect(lines[2].marker).toBe("•");
    expect(lines[2].runs).toEqual([{ bold: false, code: false, italic: false, kind: "text", text: "Staff" }]);
  });

  it("numbers an ordered list from one", () => {
    const ordered = {
      blocks: [
        {
          elements: [
            {
              elements: [
                { elements: [{ text: "First", type: "text" }], type: "rich_text_section" },
                { elements: [{ text: "Second", type: "text" }], type: "rich_text_section" },
              ],
              style: "ordered",
              type: "rich_text_list",
            },
          ],
          type: "rich_text",
        },
      ],
      text: "First\nSecond",
    };
    const lines = readParkedDrafts(payload({ blocks: ordered }))![0].lines;
    expect(lines.map((line) => line.marker)).toEqual(["1.", "2."]);
  });

  it("carries the fields the panel needs to say where it goes and what the owner's approval binds", () => {
    const draft = readParkedDrafts(payload())![0];
    expect(draft.id).toBe("sd-1a2b3c4d");
    expect(draft.channel).toBe("C0ISO");
    expect(draft.channelName).toBe("iso-27001");
    expect(draft.authorId).toBe("U0SYNADAOWN");
    expect(draft.digest).toBe("3f2a9c11d4e5b6a7");
    expect(draft.fallback).toBe("Four groups, one question.\n\nEveryone\nStaff");
    expect(draft.mentions).toEqual([{ key: "@ada", kind: "person", target: "U0SYNADAOWN" }]);
    expect(draft.advisory).toEqual(["the opener runs longer than the owner's measured median"]);
  });

  it("reads the plain escape hatch, whose payload carries bytes and no blocks, one paragraph per line", () => {
    const lines = readParkedDrafts(payload({ blocks: { text: "one\ntwo" } }))![0].lines;
    expect(lines.map((line) => line.runs)).toEqual([
      [{ bold: false, code: false, italic: false, kind: "text", text: "one" }],
      [{ bold: false, code: false, italic: false, kind: "text", text: "two" }],
    ]);
  });

  it("keeps a plain draft's blank line between paragraphs and drops the trailing newline Slack does not draw", () => {
    const lines = readParkedDrafts(payload({ blocks: { text: "one\n\ntwo\n" } }))![0].lines;
    expect(lines.map((line) => line.runs)).toEqual([
      [{ bold: false, code: false, italic: false, kind: "text", text: "one" }],
      [{ bold: false, code: false, italic: false, kind: "text", text: "" }],
      [{ bold: false, code: false, italic: false, kind: "text", text: "two" }],
    ]);
  });

  it("REFUSES the whole reading when one run is a shape it cannot draw", () => {
    const unknown = {
      blocks: [
        {
          elements: [{ elements: [{ type: "sparkle", value: 1 }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      text: "a sparkle",
    };
    expect(readParkedDrafts(payload({ blocks: unknown }))).toBe(undefined);
  });

  it("REFUSES a known run missing the field that draws it, rather than drawing a blank", () => {
    const dateless = {
      blocks: [
        {
          elements: [{ elements: [{ fallback: "Sun", type: "date" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      text: "a date",
    };
    expect(readParkedDrafts(payload({ blocks: dateless }))).toBe(undefined);
  });

  it("REFUSES a list item that is not a section, rather than reading its elements anyway", () => {
    const untyped = {
      blocks: [
        {
          elements: [
            { elements: [{ elements: [{ text: "First", type: "text" }] }], style: "bullet", type: "rich_text_list" },
          ],
          type: "rich_text",
        },
      ],
      text: "First",
    };
    expect(readParkedDrafts(payload({ blocks: untyped }))).toBe(undefined);
  });

  it("REFUSES a text style that is not a boolean, or a style that is not an object, rather than drawing plain", () => {
    const styled = ({ style }: { style: unknown }): unknown => ({
      blocks: [
        {
          elements: [{ elements: [{ style, text: "loud", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      text: "loud",
    });
    expect(readParkedDrafts(payload({ blocks: styled({ style: { bold: "yes" } }) }))).toBe(undefined);
    expect(readParkedDrafts(payload({ blocks: styled({ style: "bold" }) }))).toBe(undefined);
    expect(readParkedDrafts(payload({ blocks: styled({ style: { strike: "yes" } }) }))).toBe(undefined);
    expect(
      readParkedDrafts(payload({ blocks: styled({ style: { bold: true, strike: true } }) }))![0].lines[0].runs,
    ).toEqual([{ bold: true, code: false, italic: false, kind: "text", text: "loud" }]);
  });

  it("REFUSES an optional drawn field that is present but not text: a link's label, a date's fallback", () => {
    const oneRun = ({ run }: { run: unknown }): unknown => ({
      blocks: [{ elements: [{ elements: [run], type: "rich_text_section" }], type: "rich_text" }],
      text: "one run",
    });
    const link = { text: 7, type: "link", url: "https://linear.app/acme/issue/AAAA-3261" };
    const date = { fallback: 7, timestamp: 1_790_431_200, type: "date" };
    expect(readParkedDrafts(payload({ blocks: oneRun({ run: link }) }))).toBe(undefined);
    expect(readParkedDrafts(payload({ blocks: oneRun({ run: date }) }))).toBe(undefined);
  });

  describe("an emoji element (an emoji is drawn as an emoji, not its text form)", () => {
    const oneEmoji = ({ run }: { run: unknown }): unknown => ({
      blocks: [{ elements: [{ elements: [run], type: "rich_text_section" }], type: "rich_text" }],
      text: "one emoji",
    });

    it("reads the unicode and skin tone Slack records beside the name, so the card can draw Slack's own emoji", () => {
      const wave = { name: "wave", skin_tone: 3, type: "emoji", unicode: "1f44b-1f3fc" };
      expect(readParkedDrafts(payload({ blocks: oneEmoji({ run: wave }) }))![0].lines[0].runs).toEqual([
        { kind: "emoji", name: "wave", skinTone: 3, unicode: "1f44b-1f3fc" },
      ]);
    });

    it("reads a custom emoji, which carries neither, by its name alone", () => {
      const parrot = { name: "partyparrot", type: "emoji" };
      expect(readParkedDrafts(payload({ blocks: oneEmoji({ run: parrot }) }))![0].lines[0].runs).toEqual([
        { kind: "emoji", name: "partyparrot", skinTone: undefined, unicode: undefined },
      ]);
    });

    it("reads a well-formed unicode that names another emoji as written, since Slack's own record wins over the name", () => {
      // A workspace alias over a standard emoji carries the alias's name and the base's unicode, and a name newer than
      // the snapshot has nothing to check against, so a name/unicode check would refuse payloads Slack really writes.
      const alias = { name: "yay", type: "emoji", unicode: "1f389" };
      expect(readParkedDrafts(payload({ blocks: oneEmoji({ run: alias }) }))![0].lines[0].runs).toEqual([
        { kind: "emoji", name: "yay", skinTone: undefined, unicode: "1f389" },
      ]);
    });

    it("REFUSES a unicode that is not text", () => {
      const run = { name: "wave", type: "emoji", unicode: 128_075 };
      expect(readParkedDrafts(payload({ blocks: oneEmoji({ run }) }))).toBe(undefined);
    });

    it("REFUSES a unicode that is text but not code points, rather than drawing the emoji by name instead", () => {
      const runs = ["zz", "d800"].map((unicode) => ({ name: "wave", type: "emoji", unicode }));
      expect(runs.map((run) => readParkedDrafts(payload({ blocks: oneEmoji({ run }) })))).toEqual([
        undefined,
        undefined,
      ]);
    });

    it("REFUSES a skin tone that is not a number", () => {
      const run = { name: "wave", skin_tone: "3", type: "emoji" };
      expect(readParkedDrafts(payload({ blocks: oneEmoji({ run }) }))).toBe(undefined);
    });

    it("REFUSES a skin tone outside Slack's 2 to 6", () => {
      const run = { name: "wave", skin_tone: 7, type: "emoji" };
      expect(readParkedDrafts(payload({ blocks: oneEmoji({ run }) }))).toBe(undefined);
    });

    it("reads a well-formed style beside the emoji, and REFUSES one that is not an object of flags", () => {
      const styles = [
        { bold: true, highlight: "unknown-key", strike: true },
        "not-an-object",
        { bold: "yes" },
        { strike: "yes" },
        { underline: "yes" },
      ];
      const runs = styles.map((style) => ({ name: "wave", style, type: "emoji", unicode: "1f44b" }));
      expect(runs.map((run) => readParkedDrafts(payload({ blocks: oneEmoji({ run }) }))?.[0]?.lines[0]?.runs)).toEqual([
        [{ kind: "emoji", name: "wave", skinTone: undefined, unicode: "1f44b" }],
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    });
  });

  it("REFUSES an outer block that is not rich_text, or names no type", () => {
    const section = { elements: [{ text: "hi", type: "text" }], type: "rich_text_section" };
    const header = { blocks: [{ elements: [section], type: "header" }], text: "hi" };
    const untyped = { blocks: [{ elements: [section] }], text: "hi" };
    expect(readParkedDrafts(payload({ blocks: header }))).toBe(undefined);
    expect(readParkedDrafts(payload({ blocks: untyped }))).toBe(undefined);
    expect(readParkedDrafts(payload({ blocks: { blocks: "rich_text", text: "hi" } }))).toBe(undefined);
  });

  it("REFUSES a list with no style, rather than guessing bullets", () => {
    const styleless = {
      blocks: [
        {
          elements: [
            {
              elements: [{ elements: [{ text: "First", type: "text" }], type: "rich_text_section" }],
              type: "rich_text_list",
            },
          ],
          type: "rich_text",
        },
      ],
      text: "First",
    };
    expect(readParkedDrafts(payload({ blocks: styleless }))).toBe(undefined);
  });

  it("REFUSES a row missing the digest, because a preview of bytes nothing binds is not one", () => {
    const bag = payload() as { items: { draft: Record<string, unknown> }[] };
    delete bag.items[0].draft["digest"];
    expect(readParkedDrafts(bag)).toBe(undefined);
  });

  it("answers nothing for a payload that is not a list of drafts at all", () => {
    expect(readParkedDrafts({ rows: [] })).toBe(undefined);
    expect(readParkedDrafts("held")).toBe(undefined);
  });

  it("marks only a held row as still waiting on the owner", () => {
    expect(isParked({ draft: readParkedDrafts(payload())![0] })).toBe(true);
    expect(
      isParked({
        draft: readParkedDrafts(payload({ resolvedIso: "2026-09-23T03:00:00.000Z", state: "released" }))![0],
      }),
    ).toBe(false);
  });

  it("reads a held finding missing its proof as no longer waiting on the owner", () => {
    const draft = readParkedDrafts(withItem({ fields: { proofMissing: ["screenshot", "impact"] } }))![0];
    expect([draft.proofMissing, isParked({ draft })]).toEqual([["screenshot", "impact"], false]);
  });

  it("REFUSES a proof verdict that is empty, names a piece it does not know, or sits on a resolved row", () => {
    expect(readParkedDrafts(withItem({ fields: { proofMissing: [] } }))).toBe(undefined);
    expect(readParkedDrafts(withItem({ fields: { proofMissing: ["a receipt"] } }))).toBe(undefined);
    const released = payload({ resolvedIso: "2026-09-23T03:00:00.000Z", state: "released" }) as {
      items: Record<string, unknown>[];
    };
    released.items[0]["proofMissing"] = ["screenshot"];
    expect(readParkedDrafts(released)).toBe(undefined);
  });

  it("keeps a released or dropped row readable, with the instant it was resolved", () => {
    const draft = readParkedDrafts(payload({ resolvedIso: "2026-09-23T03:00:00.000Z", state: "dropped" }))![0];
    expect([draft.state, draft.resolvedIso]).toEqual(["dropped", "2026-09-23T03:00:00.000Z"]);
  });

  it("refuses the reading on a state it does not know, or a resolved row that does not say when", () => {
    expect(readParkedDrafts(payload({ state: "sent" }))).toBe(undefined);
    expect(readParkedDrafts(payload({ state: "released" }))).toBe(undefined);
  });

  it("reads a top-level row as no thread, and a held row's release as the verb printed it", () => {
    const draft = readParkedDrafts(payload())![0];
    expect([draft.thread, draft.release]).toEqual([undefined, SEND]);
  });

  it("reads a thread row's root and the parent the recording read", () => {
    const thread = {
      threadParent: { text: "staging pool exhausted", userId: "U0JONAH" },
      threadTs: "1789407961.767649",
    };
    expect(readParkedDrafts(withDraft({ fields: { shape: "thread", ...thread } }))![0].thread).toEqual({
      parentText: "staging pool exhausted",
      parentUserId: "U0JONAH",
      ts: "1789407961.767649",
    });
  });

  it("reads the thread's permalink the recording built, so the card links the thread it talks about", () => {
    const permalink = "https://acme.slack.com/archives/C0ENG/p1789407961767649";
    const thread = {
      threadParent: { permalink, text: "staging pool exhausted", userId: "U0JONAH" },
      threadTs: "1789407961.767649",
    };
    expect(readParkedDrafts(withDraft({ fields: { shape: "thread", ...thread } }))![0].thread!.permalink).toBe(
      permalink,
    );
  });

  it("REFUSES a thread permalink that is not an https address, rather than drawing a link that goes nowhere", () => {
    const thread = {
      threadParent: { permalink: "javascript:alert(1)", text: "staging pool exhausted", userId: "U0JONAH" },
      threadTs: "1789407961.767649",
    };
    expect(readParkedDrafts(withDraft({ fields: { shape: "thread", ...thread } }))).toBe(undefined);
  });

  it("reads a re-record release, the one a top-level row whose why says thread reply carries", () => {
    const release = { kind: "re-record", why: "parked top-level, but its why says thread reply" };
    expect(readParkedDrafts(withItem({ fields: { release } }))![0].release).toEqual(release);
  });

  it("refuses a thread row with no root, or a top-level row carrying one — either reads as the wrong place", () => {
    expect(readParkedDrafts(withDraft({ fields: { shape: "thread" } }))).toBe(undefined);
    expect(readParkedDrafts(withDraft({ fields: { shape: "thread", threadTs: "not-a-ts" } }))).toBe(undefined);
    expect(readParkedDrafts(withDraft({ fields: { threadTs: "1789407961.767649" } }))).toBe(undefined);
    expect(readParkedDrafts(withDraft({ fields: { shape: undefined } }))).toBe(undefined);
  });

  it("refuses a held row with no release, a malformed one, or a resolved row carrying one", () => {
    expect(readParkedDrafts(withItem({ fields: { release: undefined } }))).toBe(undefined);
    expect(readParkedDrafts(withItem({ fields: { release: { kind: "send" } } }))).toBe(undefined);
    const released = payload({ resolvedIso: "2026-09-23T03:00:00.000Z", state: "released" }) as {
      items: Record<string, unknown>[];
    };
    released.items[0]["release"] = SEND;
    expect(readParkedDrafts(released)).toBe(undefined);
  });

  it("carries the roster the verb resolved, one map shared by every draft of the reading", () => {
    const people = [{ bot: false, handle: "ada.owner", name: "Ada Owner", nativeId: "U0SYNADAOWN" }];
    const draft = readParkedDrafts(payload({ people }))![0];
    expect([...draft.people.entries()]).toEqual([
      [
        "U0SYNADAOWN",
        {
          deactivated: false,
          firstNameUnique: false,
          handle: "ada.owner",
          name: "Ada Owner",
          nameUnique: false,
        },
      ],
    ]);
  });

  it("carries each member's title and whether their first and whole names are theirs alone, for the chip", () => {
    const people = [
      {
        firstNameUnique: true,
        handle: "rosa",
        name: "Rosa Lindqvist",
        nameUnique: true,
        nativeId: "U0ROSA",
        title: "Staff Engineer",
      },
    ];
    expect(readParkedDrafts(payload({ people }))![0].people.get("U0ROSA")).toEqual({
      deactivated: false,
      firstNameUnique: true,
      handle: "rosa",
      name: "Rosa Lindqvist",
      nameUnique: true,
      title: "Staff Engineer",
    });
  });

  it("carries a member Slack says has left as deactivated, and REFUSES a deactivated flag that is not a boolean", () => {
    const left = [{ deactivated: true, name: "Seth Left", nativeId: "U0LEFT" }];
    expect([
      readParkedDrafts(payload({ people: left }))![0].people.get("U0LEFT")!.deactivated,
      readParkedDrafts(payload({ people: [{ deactivated: "yes", name: "Seth Left", nativeId: "U0LEFT" }] })),
    ]).toEqual([true, undefined]);
  });

  it("REFUSES a title that is present but not text, or a name flag that is not a boolean", () => {
    expect(readParkedDrafts(payload({ people: [{ name: "Rosa", nativeId: "U0ROSA", title: 7 }] }))).toBe(undefined);
    expect(readParkedDrafts(payload({ people: [{ firstNameUnique: "yes", name: "Rosa", nativeId: "U0ROSA" }] }))).toBe(
      undefined,
    );
    expect(readParkedDrafts(payload({ people: [{ name: "Rosa", nameUnique: 1, nativeId: "U0ROSA" }] }))).toBe(
      undefined,
    );
  });

  it("carries each member's avatar, so the card draws the owner's face and a DM peer's rather than a disc", () => {
    const people = [
      { avatarUrl: "https://avatars.example/j_72.png", handle: "jasper", name: "Jasper", nativeId: "U0JASPER" },
    ];
    expect(readParkedDrafts(payload({ people }))![0].people.get("U0JASPER")!.avatarUrl).toBe(
      "https://avatars.example/j_72.png",
    );
  });

  it("REFUSES an avatar that is present but not text, rather than drawing a broken picture", () => {
    expect(readParkedDrafts(payload({ people: [{ avatarUrl: 72, name: "Jasper", nativeId: "U0JASPER" }] }))).toBe(
      undefined,
    );
  });

  it("carries where a member sits in the org chart, and reads an absent block as none", () => {
    const org = {
      department: "Engineering",
      title: { source: "vanta", value: "Staff Engineer - Platform" },
      vantaGroups: ["Security council", "Everyone"],
      vantaStatus: "ON_LEAVE",
    };
    const people = [
      { name: "Jared", nativeId: "U0JARED", org },
      { name: "Jasper", nativeId: "U0JASPER" },
    ];
    const roster = readParkedDrafts(payload({ people }))![0].people;
    expect([roster.get("U0JARED")!.org, roster.get("U0JASPER")!.org]).toEqual([
      { ...org, orgUnit: undefined },
      undefined,
    ]);
  });

  it("REFUSES an org block that is malformed, rather than drawing a team the CLI never said", () => {
    const bad = [
      "Engineering",
      { vantaGroups: "Everyone" },
      { department: 7, vantaGroups: [] },
      { title: { source: "hibob", value: "CEO" }, vantaGroups: [] },
      { title: "CEO", vantaGroups: [] },
    ];
    expect(bad.map((org) => readParkedDrafts(payload({ people: [{ name: "X", nativeId: "U0X", org }] })))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads an absent roster as an empty one, which is what a CLI older than the field prints", () => {
    expect(readParkedDrafts(payload())![0].people.size).toBe(0);
  });

  it("REFUSES a roster that is malformed or names one id twice, rather than risk a wrong name", () => {
    expect(readParkedDrafts(payload({ people: "Ada" }))).toBe(undefined);
    expect(readParkedDrafts(payload({ people: [{ name: 7, nativeId: "U0SYNADAOWN" }] }))).toBe(undefined);
    const twice = [
      { name: "Ada Owner", nativeId: "U0SYNADAOWN" },
      { name: "Someone Else", nativeId: "U0SYNADAOWN" },
    ];
    expect(readParkedDrafts(payload({ people: twice }))).toBe(undefined);
  });

  it("reads an absent media field as a text-only draft, which every row before the field is", () => {
    expect(readParkedDrafts(payload())![0].media).toEqual([]);
  });

  it("carries each stored attachment's name, size and hash, in attach order", () => {
    const media = [
      { bytes: 2747, name: "walkthrough.mp4", sha256: "a".repeat(64) },
      { bytes: 12, name: "still.png", sha256: "b".repeat(64) },
    ];
    expect(readParkedDrafts(withMedia({ media }))![0].media).toEqual(media);
  });

  it("REFUSES the whole reading on an attachment it cannot read whole, rather than draw one missing", () => {
    const good = { bytes: 2747, name: "walkthrough.mp4", sha256: "a".repeat(64) };
    const malformed: readonly unknown[] = [
      "walkthrough.mp4",
      [{ ...good, name: "" }],
      [{ ...good, bytes: 0 }],
      [{ ...good, bytes: 1.5 }],
      [{ ...good, sha256: "A".repeat(64) }],
      [{ bytes: 2747, name: "walkthrough.mp4" }],
      [good, null],
    ];
    expect(malformed.length).toBeGreaterThan(0);
    expect(malformed.map((media) => readParkedDrafts(withMedia({ media })))).toEqual(malformed.map(() => undefined));
  });

  it("lifts a user mention out of a plain line as the chip Slack draws, leaving the rest verbatim", () => {
    const lines = readParkedDrafts(payload({ blocks: { text: "<@U0ARI|ari> *not bold* <@W0GRID>" } }))![0].lines;
    expect(lines[0].runs).toEqual([
      { kind: "user", userId: "U0ARI" },
      { bold: false, code: false, italic: false, kind: "text", text: " *not bold* " },
      { kind: "user", userId: "W0GRID" },
    ]);
  });
});

/** A `slack draft record --as bot` row's payload: the card's words in its one wrapper, its own `text` empty. */
const CARD = {
  attachments: [
    {
      blocks: [
        { elements: [{ text: ":robot_face:  *acme-bot*", type: "mrkdwn" }], type: "context" },
        { type: "divider" },
        {
          elements: [
            { elements: [{ text: "Checkout 500s since the 14:02 deploy.", type: "text" }], type: "rich_text_section" },
          ],
          type: "rich_text",
        },
        { type: "divider" },
        { elements: [{ text: "Details", type: "mrkdwn" }], type: "context" },
      ],
      color: "#7c3aed",
      fallback: "Checkout 500s since the 14:02 deploy.",
    },
  ],
  metadata: { event_payload: {}, event_type: "slopweaver_card" },
  text: "",
};

describe("readParkedDrafts on a bot row (a finding shared in a channel posts as the bot)", () => {
  it("reads an absent actor as the owner, the register's contract before --as bot", () => {
    expect(readParkedDrafts(payload())![0].actor).toBe("me");
  });

  it("draws a bot card's words off its wrapper, chrome lines and all, with the wrapper's fallback", () => {
    const draft = readParkedDrafts(withDraft({ fields: { actor: "bot", payload: CARD } }))![0];
    expect(draft.actor).toBe("bot");
    expect(draft.fallback).toBe("Checkout 500s since the 14:02 deploy.");
    expect(
      draft.lines.map((line) => line.runs.map((run) => (run.kind === "text" ? run.text : run.kind)).join("")),
    ).toEqual([":robot_face:  *acme-bot*", "Checkout 500s since the 14:02 deploy.", "Details"]);
  });

  it("refuses the reading for an actor it does not know, rather than drawing the owner's face over the bot's words", () => {
    expect(readParkedDrafts(withDraft({ fields: { actor: "robot" } }))).toBe(undefined);
  });

  it("refuses the reading for a card block it does not draw", () => {
    const card = { ...CARD, attachments: [{ ...CARD.attachments[0], blocks: [{ type: "image" }] }] };
    expect(readParkedDrafts(withDraft({ fields: { actor: "bot", payload: card } }))).toBe(undefined);
  });

  it("draws a bot row member bronze cannot name as the handle the install's profile declares", () => {
    const bag = withDraft({ fields: { actor: "bot", authorId: "B0SYNBOT", payload: CARD } }) as Record<string, unknown>;
    const draft = readParkedDrafts({ ...bag, botHandles: ["acme-bot"] })![0];
    expect(draft.botHandles).toEqual(["acme-bot"]);
    expect(draftAuthorName({ draft })).toBe("acme-bot");
  });

  it("names the gap on a bot row when the install's profile declares no handle", () => {
    const draft = readParkedDrafts(withDraft({ fields: { actor: "bot", authorId: "B0SYNBOT", payload: CARD } }))![0];
    expect(draftAuthorName({ draft })).toBe("Bot (profile.json names no handle)");
  });

  it("refuses the reading when the declared handles are not a list of strings", () => {
    const bag = payload() as Record<string, unknown>;
    expect(readParkedDrafts({ ...bag, botHandles: [7] })).toBe(undefined);
  });
});

describe("readParkedDrafts — the act badge", () => {
  it("reads each act its recorder declared", () => {
    const acts = ["reply", "bump", "review-ask"].map((act) => readParkedDrafts(withDraft({ fields: { act } }))![0].act);
    expect(acts).toEqual(["reply", "bump", "review-ask"]);
  });

  it("reads a row recorded before the field as no act, never one guessed from its why", () => {
    const draft = readParkedDrafts(withDraft({ fields: { why: "chase: claude plan domain, Seth and Ansel" } }))![0];
    expect(draft.why).toBe("chase: claude plan domain, Seth and Ansel");
    expect(draft.act).toBe(undefined);
  });

  it("draws no badge for an act this build does not know, rather than refusing every draft card", () => {
    const drafts = readParkedDrafts(withDraft({ fields: { act: "question" } }))!;
    expect(drafts.length).toBe(1);
    expect(drafts[0].act).toBe(undefined);
  });
});
