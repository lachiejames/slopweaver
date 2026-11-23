/**
 * A top-level channel post opens with what it is and what it asks of the reader: the declaration, the match, and the
 * top-region check on every composed form. The worked example is the opener for a pilot channel.
 */
import { describe, expect, it } from "vitest";

import {
  dripArtifactSchema,
  oneCardArtifactSchema,
  oneListArtifactSchema,
} from "../../../../outbound/artifact/asMeSchema.js";
import { openingDeclarationSchema, openingIssue, openingTextOf } from "../../../../outbound/artifact/channelOpening.js";
import { noFoldArtifactSchema } from "../../../../outbound/artifact/noFoldSchema.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";

const OPENING = {
  asks: { kind: "react", text: "react on anything that feels off" },
  what: "a pilot of a bot that triages MFA asks",
} as const;

/** The recut's top: a greeting and tags, then what it is, then what it asks. */
const RECUT_TOP =
  "hey , this channel is a pilot of a bot that triages MFA asks before Seth or Lena step in. React on anything that " +
  "feels off.";

/** A top readers could not follow: detail first, no frame and no ask. */
const ORIGINAL_TOP =
  "Five real MFA asks from the support channel, each worded differently. I'd start very narrow: only the one where the " +
  "setup guide is the whole answer.";

/** One text run. */
function text({ value }: { value: string }): { text: string; type: "text" } {
  return { text: value, type: "text" };
}

/** Every issue message a parse produced, or none when it passed. */
function issues({ result }: { result: { success: boolean; error?: { issues: { message: string }[] } } }): string[] {
  return result.error === undefined ? [] : result.error.issues.map((issue) => issue.message);
}

describe("openingIssue", () => {
  it("passes a top carrying what it is, then what it asks, after a greeting", () => {
    expect(openingIssue({ opening: OPENING, region: "first line", topText: RECUT_TOP })).toBe(undefined);
  });

  it("refuses the original bot card's top, naming the missing what", () => {
    expect(openingIssue({ opening: OPENING, region: "tldr", topText: ORIGINAL_TOP })).toContain(
      'its tldr does not carry "a pilot of a bot that triages MFA asks"',
    );
  });

  it("refuses a top carrying what it is but not the ask, naming the ask", () => {
    const top = "This channel is a pilot of a bot that triages MFA asks.";
    expect(openingIssue({ opening: OPENING, region: "lead", topText: top })).toContain(
      'its lead does not carry "react on anything that feels off" after it',
    );
  });

  it("refuses the ask ahead of what it is", () => {
    const top = "React on anything that feels off: this is a pilot of a bot that triages MFA asks.";
    expect(openingIssue({ opening: OPENING, region: "lead", topText: top })).toContain("after it");
  });

  it("ignores case, runs of whitespace, a space before a comma and a declared trailing full stop", () => {
    const opening = {
      asks: { kind: "nothing", text: "nothing needed from you." },
      what: "A Pilot, of the bot.",
    } as const;
    const top = "a  pilot , of the bot.   Nothing needed from you today";
    expect(openingIssue({ opening, region: "lead", topText: top })).toBe(undefined);
  });

  it("reads a space on either side of a dash or other mark as no space at all", () => {
    const opening = { asks: { kind: "react", text: "React on it." }, what: "A pilot — for support." } as const;
    expect(openingIssue({ opening, region: "lead", topText: "a PILOT— for support.   react on it" })).toBe(undefined);
    expect(openingIssue({ opening, region: "lead", topText: "a pilot -for support. react on it" })).toContain(
      'its lead does not carry "A pilot — for support."',
    );
  });

  it("drops only a declared trailing full stop, so a declared exclamation mark must be in the top", () => {
    const opening = { asks: { kind: "react", text: "react now!" }, what: "a pilot bot" } as const;
    expect(openingIssue({ opening, region: "lead", topText: "A pilot bot. React now." })).toContain(
      'its lead does not carry "react now!" after it',
    );
    expect(openingIssue({ opening, region: "lead", topText: "A pilot bot. React now!" })).toBe(undefined);
  });

  it("matches whole words only, never a phrase inside a longer word", () => {
    const opening = { asks: { kind: "nothing", text: "asks now" }, what: "pilot bot" } as const;
    expect(openingIssue({ opening, region: "lead", topText: "Autopilot botnet asks nowhere." })).toContain(
      'its lead does not carry "pilot bot"',
    );
    expect(openingIssue({ opening, region: "lead", topText: "A pilot bot. It asks nowhere." })).toContain(
      '"asks now" after it',
    );
    expect(openingIssue({ opening, region: "lead", topText: "Autopilot, a pilot bot. It asks now." })).toBe(undefined);
  });

  it("reads a letter outside the basic plane as one letter at a phrase's edge", () => {
    const opening = { asks: { kind: "reply", text: "do now" }, what: "\u{10400} pilot" } as const;
    expect(openingIssue({ opening, region: "lead", topText: "x\u{10400} pilot do now" })).toContain(
      'its lead does not carry "\u{10400} pilot"',
    );
    expect(openingIssue({ opening, region: "lead", topText: "x \u{10400} pilot do now" })).toBe(undefined);
  });

  it("asks nothing of a form declaring no opening", () => {
    expect(openingIssue({ opening: undefined, region: "lead", topText: "" })).toBe(undefined);
  });
});

describe("openingDeclarationSchema", () => {
  it("takes each of the five asks", () => {
    const kinds = ["nothing", "react", "reply", "review", "decide"];
    expect(
      kinds.map((kind) => openingDeclarationSchema.safeParse({ ...OPENING, asks: { ...OPENING.asks, kind } }).success),
    ).toEqual([true, true, true, true, true]);
  });

  it("refuses an ask outside the five, a one-word phrase and an unknown key", () => {
    expect(openingDeclarationSchema.safeParse({ ...OPENING, asks: { ...OPENING.asks, kind: "action" } }).success).toBe(
      false,
    );
    expect(issues({ result: openingDeclarationSchema.safeParse({ ...OPENING, what: "hey" }) })).toEqual([
      "a declared opening phrase carries at least 2 words, copied from the top region",
    ]);
    expect(openingDeclarationSchema.safeParse({ ...OPENING, why: "extra" }).success).toBe(false);
  });
});

describe("every composed form checks its own top region", () => {
  const frame = text({ value: "This is a pilot of a bot that triages MFA asks. React on anything that feels off." });
  const detail = text({ value: ORIGINAL_TOP });

  it("drip: the first message, not a later one", () => {
    const schema = dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 200 });
    const later = { kind: "drip", messages: [{ runs: [detail] }, { runs: [frame] }], opening: OPENING };
    const first = { ...later, messages: [{ runs: [frame] }, { runs: [detail] }] };
    expect(issues({ result: schema.safeParse(later) })[0]).toContain("its first message does not carry");
    expect(issues({ result: schema.safeParse(first) })).toEqual([]);
  });

  it("one-card: the first line, not the third", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 600, maxLines: 3 });
    const card = { kind: "one-card", lines: [{ runs: [detail] }, { runs: [frame] }], opening: OPENING };
    expect(issues({ result: schema.safeParse(card) })[0]).toContain("its first line does not carry");
  });

  it("one-list and no-fold: the lead, not a bullet", () => {
    const list = oneListArtifactSchema({ cardVisibleMax: 600, maxBullets: 5, maxTrailing: 2 });
    const form = { bullets: [[frame]], lead: [text({ value: "Five MFA asks." })], opening: OPENING };
    expect(issues({ result: list.safeParse({ ...form, kind: "one-list", trailing: [] }) })[0]).toContain(
      "its lead does not carry",
    );
    expect(issues({ result: noFoldArtifactSchema.safeParse({ ...form, kind: "no-fold" }) })[0]).toContain(
      "its lead does not carry",
    );
  });

  it("refuses a top region missing both a declared reach and a declared opening, once each", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 600, maxLines: 3 });
    const card = {
      kind: "one-card",
      lines: [{ runs: [detail] }],
      opening: OPENING,
      problem: { affects: "a few", kind: "possible" },
    };
    const found = issues({ result: schema.safeParse(card) });
    expect(found.length).toBe(2);
    expect(found[0]).toContain("a few");
    expect(found[1]).toContain('its first line does not carry "a pilot of a bot that triages MFA asks"');
  });

  it("update: the tldr, read after its intro", () => {
    const card = {
      detail: [{ runs: [text({ value: "The five asks." })], type: "paragraph" }],
      kind: "update",
      opening: OPENING,
      tldr: "Five real MFA asks from the support channel.",
    };
    expect(issues({ result: updateArtifactSchema.safeParse(card) })).toEqual([
      expect.stringContaining("its intro and tldr does not carry"),
    ]);
    const framed = { ...card, tldr: "A pilot of a bot that triages MFA asks. React on anything that feels off." };
    expect(issues({ result: updateArtifactSchema.safeParse(framed) })).toEqual([]);
    const intro = {
      ...card,
      intro: ["This is a pilot of a bot that triages MFA asks."],
      tldr: "React on anything that feels off.",
    };
    expect(issues({ result: updateArtifactSchema.safeParse(intro) })).toEqual([]);
  });

  it("does not count words inside code or a link label", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 600, maxLines: 3 });
    const ask = text({ value: " React on anything that feels off." });
    const inCode = [{ code: true, text: "a pilot of a bot that triages MFA asks", type: "text" as const }, ask];
    const inLabel = [
      { label: "a pilot of a bot that triages MFA asks", type: "link" as const, url: "https://example.invalid/pilot" },
      ask,
    ];
    const missingWhat = 'its first line does not carry "a pilot of a bot that triages MFA asks"';
    expect(
      issues({ result: schema.safeParse({ kind: "one-card", lines: [{ runs: inCode }], opening: OPENING }) })[0],
    ).toContain(missingWhat);
    expect(
      issues({ result: schema.safeParse({ kind: "one-card", lines: [{ runs: inLabel }], opening: OPENING }) })[0],
    ).toContain(missingWhat);
  });

  it("does not count words inside a quote", () => {
    const quoted = [{ quoted: true, text: "a pilot of a bot that triages MFA asks", type: "text" as const }];
    expect(openingIssue({ opening: OPENING, region: "lead", topText: openingTextOf({ runs: quoted }) })).toContain(
      'its lead does not carry "a pilot of a bot that triages MFA asks"',
    );
  });

  it("reads a bold span starting mid-word as the one word Slack renders", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 600, maxLines: 3 });
    const runs = [
      text({ value: "This is a pi" }),
      { bold: true, text: "lot of a bot that triages MFA asks.", type: "text" as const },
    ];
    const ask = text({ value: " React on anything that feels off." });
    expect(
      issues({ result: schema.safeParse({ kind: "one-card", lines: [{ runs: [...runs, ask] }], opening: OPENING }) }),
    ).toEqual([]);
  });

  it("drops an authored object-replacement mark on both sides, so only a skipped run stands as one", () => {
    const opening = { asks: { kind: "reply", text: "do now" }, what: "alpha \u{FFFC} beta" } as const;
    const runs = [text({ value: "alpha \u{FFFC} beta do now" })];
    expect(openingIssue({ opening, region: "lead", topText: openingTextOf({ runs }) })).toBe(undefined);
  });

  it("refuses a phrase reaching across a code run, whose words are not the author's", () => {
    const runs = [
      text({ value: "This is a pilot of a" }),
      { code: true, text: "bot", type: "text" as const },
      text({ value: "that triages MFA asks. React on anything that feels off." }),
    ];
    expect(openingIssue({ opening: OPENING, region: "lead", topText: openingTextOf({ runs }) })).toContain(
      'its lead does not carry "a pilot of a bot that triages MFA asks"',
    );
  });

  it("parses a form declaring no opening, since the schema does not know where it goes", () => {
    const schema = oneCardArtifactSchema({ cardVisibleMax: 600, maxLines: 3 });
    expect(issues({ result: schema.safeParse({ kind: "one-card", lines: [{ runs: [detail] }] }) })).toEqual([]);
  });
});
