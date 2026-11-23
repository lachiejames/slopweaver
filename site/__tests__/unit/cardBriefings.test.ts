/*
 * The briefings a card hands the voice (`site/lib/cardBriefings.ts`), `site/lib/briefingRead.ts`'s read of the verb,
 * and `site/components/voice/cardBriefingRead.ts`'s read of them all. Of 20 briefings attached
 * to a card the voice opened, 5 were read whole, 10 in part and 5 never, and the card says which.
 */
import { describe, expect, it } from "vitest";

import { TOOL_OUTPUT_MAX, ToolOutputErrors, toolOutputOf } from "../../components/live/talkSession";
import { readCardBriefings } from "../../components/voice/cardBriefingRead";
import { withBriefings } from "../../components/voice/openCardAnswer";
import { BRIEFING_READ_BUDGET, BRIEFING_READ_TITLE, briefingReadArgv, briefingReadOf } from "../../lib/briefingRead";
import {
  briefingReadFromBody,
  CARD_ANSWER_MAX_BYTES,
  cardBriefingOf,
  couldNotOpenSay,
  leftOutSay,
  type ReadCardBriefing,
  withFittedBriefings,
} from "../../lib/cardBriefings";

/** A briefing's real path under a pages directory. */
const PAGE = "/h/.slopweaver/pages/a/index.html";

/** Where a test's read briefings came from: the page above, nothing masked. */
const SOURCE = { masked: false, path: PAGE } as const;

/** UTF-8 bytes of a value as JSON — what the page's cap counts. */
function bytesOf({ value }: { value: unknown }): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

describe("cardBriefingOf", () => {
  it("carries its own sentence for a briefing that would not open, and another for one read in part", () => {
    const read = { masked: true, nextFrom: null, ok: true, path: PAGE, text: "words", whole: true } as const;
    expect([
      cardBriefingOf({ file: undefined, read, slug: "a" }),
      cardBriefingOf({ file: undefined, read: { ...read, nextFrom: 524_288, text: "first", whole: false }, slug: "b" }),
      cardBriefingOf({ file: undefined, read: { ok: false, why: "ENOENT" }, slug: "c" }),
    ]).toEqual([
      { read: true, slug: "a", source: { masked: true, path: PAGE }, text: "words" },
      {
        read: "partial",
        // The verb's own offset counts words before the window was masked, so it stands even for a masked read.
        rest: { from: 524_288, path: PAGE },
        say: "I could only read the first part of the b briefing.",
        slug: "b",
        source: { masked: true, path: PAGE },
        text: "first",
      },
      { read: false, say: "I couldn't open the c briefing, so I can't read that to you.", slug: "c", why: "ENOENT" },
    ]);
  });

  // MEASURED: the Queue tool's deadline ran out, the voice said it could not read the briefing, then read it whole.
  it("hands a failed read of a briefing whose file the card names to file_read from the top, nothing carried", () => {
    const timeUp = { ok: false, why: "the Queue tool's time ran out before this was read" } as const;
    expect(cardBriefingOf({ file: PAGE, read: timeUp, slug: "a" })).toEqual({
      read: "partial",
      rest: { from: 0, path: PAGE },
      say: "I couldn't open the a briefing, so I can't read that to you.",
      slug: "a",
      source: SOURCE,
      text: "",
    });
  });

  it("keeps that hand-off's rest from the top through a fit that has to cut every other briefing", () => {
    const handed = cardBriefingOf({ file: PAGE, read: { ok: false, why: "ENOENT" }, slug: "a" });
    const big: ReadCardBriefing = { read: true, slug: "b", source: SOURCE, text: "b".repeat(8000) };
    const fitted = withFittedBriefings({ answer: {}, briefings: [handed, big], capBytes: 24 * 1024, maxBytes: 2048 });
    expect(fitted.briefings[0]).toEqual({
      read: "partial",
      rest: { from: 0, path: PAGE },
      say: "I couldn't open the a briefing, so I can't read that to you.",
      slug: "a",
      text: "",
    });
    expect(fitted.briefings[1].read).toBe("partial");
  });
});

describe("briefingReadFromBody", () => {
  it("reads the route's two shapes and calls anything else a failed read, a part naming no offset included", () => {
    const part = { masked: false, nextFrom: 9, ok: true, path: PAGE, text: "w", whole: false };
    const notARead = { ok: false, why: "the briefing route answered something that is not a read" };
    expect([
      briefingReadFromBody({ body: part }),
      briefingReadFromBody({ body: { ok: false, why: "no" } }),
      briefingReadFromBody({ body: { ok: true } }),
      briefingReadFromBody({ body: "oops" }),
      briefingReadFromBody({ body: { ...part, nextFrom: undefined } }),
      briefingReadFromBody({ body: { ...part, nextFrom: 0 } }),
      briefingReadFromBody({ body: { ...part, nextFrom: null } }),
      briefingReadFromBody({ body: { ...part, masked: undefined } }),
    ]).toEqual([part, { ok: false, why: "no" }, notARead, notARead, notARead, notARead, notARead, notARead]);
  });
});

describe("briefingReadOf", () => {
  it("asks the masking verb for the whole page's words in one window", () => {
    expect(briefingReadArgv({ file: "/h/pages/a/index.html" })).toEqual([
      "talk",
      "file",
      "read",
      "--path",
      "/h/pages/a/index.html",
      "--words",
      "--budget",
      String(BRIEFING_READ_BUDGET),
      "--json",
    ]);
  });

  it("hands on the verb's masked text untouched, whole when the verb has nothing left, in part when it does", () => {
    const masked = "token [redacted:github-token] &#95; <b>as printed</b>";
    const redactions = [{ count: 1, label: "github-token" }];
    const out = ({ nextFrom }: { nextFrom: number | null }): string =>
      JSON.stringify({ kind: "text", nextFrom, path: "~/elsewhere", redactions, resolvedPath: PAGE, text: masked });
    expect([
      briefingReadOf({
        expectedPath: PAGE,
        outcome: { err: "", ok: true, out: out({ nextFrom: null }), tookMs: 1 },
      }),
      briefingReadOf({
        expectedPath: PAGE,
        outcome: { err: "", ok: true, out: out({ nextFrom: 9 }), tookMs: 1 },
      }),
    ]).toEqual([
      { masked: true, nextFrom: null, ok: true, path: PAGE, text: masked, whole: true },
      { masked: true, nextFrom: 9, ok: true, path: PAGE, text: masked, whole: false },
    ]);
  });

  it("refuses a read that names no redactions or no offset to read the rest from", () => {
    const ran = ({ extra }: { extra: Record<string, unknown> }) =>
      ({
        err: "",
        ok: true,
        out: JSON.stringify({ kind: "text", resolvedPath: PAGE, text: "w", ...extra }),
        tookMs: 1,
      }) as const;
    const why = "the briefing's read named no offset to read the rest from";
    expect([
      briefingReadOf({ expectedPath: PAGE, outcome: ran({ extra: { nextFrom: null } }) }),
      briefingReadOf({ expectedPath: PAGE, outcome: ran({ extra: { redactions: [] } }) }),
      briefingReadOf({ expectedPath: PAGE, outcome: ran({ extra: { nextFrom: 1.5, redactions: [] } }) }),
      briefingReadOf({ expectedPath: PAGE, outcome: ran({ extra: { nextFrom: 0, redactions: [] } }) }),
    ]).toEqual([
      { ok: false, why },
      { ok: false, why },
      { ok: false, why },
      { ok: false, why },
    ]);
  });

  it("refuses a read answering any path but the page's address, words and all", () => {
    const out = JSON.stringify({ kind: "text", nextFrom: null, resolvedPath: "/tmp/outside.html", text: "OUTSIDE" });
    expect(briefingReadOf({ expectedPath: PAGE, outcome: { err: "", ok: true, out, tookMs: 1 } })).toEqual({
      ok: false,
      why: "the briefing's page was not read out of this console's store",
    });
  });

  it("says a failure in fixed words and never repeats the stderr, whose path may carry a credential", () => {
    const token = `${["gh", "p_"].join("")}${"A1".repeat(18)}`;
    const failedWith = ({ err, exitCode }: { err: string; exitCode: number | undefined }) =>
      ({ err, exitCode, notMeasured: `ran in /tmp/${token}`, ok: false, out: "", tookMs: 1 }) as const;
    const whys = [
      {
        err: `talk file: /tmp/${token}/pages/x/index.html is a published page's address, and the store holds no published page under it\n`,
        exitCode: 1,
      },
      {
        err: `talk file: /tmp/${token}/pages/x/index.html is a published page's address, and it could not be read from the store: relation does not exist\n`,
        exitCode: 1,
      },
      { err: `talk file: /tmp/${token}/pages/${token}/index.html does not exist\n`, exitCode: 1 },
      { err: `/tmp/${token}/x still looked like it held a credential (github-token) after redaction\n`, exitCode: 1 },
      { err: `/tmp/${token}/x cannot be read as a page's words: it is not an HTML page\n`, exitCode: 1 },
      { err: `something new about /tmp/${token}\n`, exitCode: 2 },
      { err: "", exitCode: undefined },
    ].map((failure) => briefingReadOf({ expectedPath: PAGE, outcome: failedWith(failure) }));
    expect(whys).toEqual([
      { ok: false, why: `${BRIEFING_READ_TITLE} exited 1: the store holds no published page by the briefing's name` },
      { ok: false, why: `${BRIEFING_READ_TITLE} exited 1: the store holding the briefing's page could not be read` },
      { ok: false, why: `${BRIEFING_READ_TITLE} exited 1: the briefing's page does not exist` },
      { ok: false, why: `${BRIEFING_READ_TITLE} exited 1: a credential survived masking, so none was returned` },
      { ok: false, why: `${BRIEFING_READ_TITLE} exited 1: the briefing's file is not a page one read takes whole` },
      { ok: false, why: `${BRIEFING_READ_TITLE} exited 2` },
      { ok: false, why: `${BRIEFING_READ_TITLE} did not finish` },
    ]);
    expect(JSON.stringify(whys)).not.toContain(token);
  });

  it("says why for a verb that failed, printed no JSON, read a binary file, or a page with no words", () => {
    const failed = {
      err: "ENOENT: no such file\n",
      exitCode: 1,
      notMeasured: "",
      ok: false,
      out: "",
      tookMs: 1,
    } as const;
    const ran = ({ out }: { out: string }): { err: string; ok: true; out: string; tookMs: number } => ({
      err: "",
      ok: true,
      out,
      tookMs: 1,
    });
    expect([
      briefingReadOf({ expectedPath: PAGE, outcome: failed }),
      briefingReadOf({ expectedPath: PAGE, outcome: ran({ out: "not json" }) }),
      briefingReadOf({ expectedPath: PAGE, outcome: ran({ out: JSON.stringify({ kind: "binary" }) }) }),
      briefingReadOf({
        expectedPath: PAGE,
        outcome: ran({ out: JSON.stringify({ kind: "text", nextFrom: null, resolvedPath: PAGE, text: "" }) }),
      }),
    ]).toEqual([
      { ok: false, why: "slopweaver talk file read --path <briefing> --words --json exited 1" },
      {
        ok: false,
        why: "slopweaver talk file read --path <briefing> --words --json printed something that is not JSON",
      },
      { ok: false, why: "the briefing's file is not text" },
      { ok: false, why: "the briefing's page carries no words" },
    ]);
  });
});

describe("withFittedBriefings", () => {
  const answer = { card: { key: "ask:x" } };
  /** The page's own cap, `../../components/live/talkSession.ts` `TOOL_OUTPUT_MAX`. */
  const capBytes = 24 * 1024;

  it("attaches every briefing whole when the answer fits, its source stripped", () => {
    const briefings: ReadCardBriefing[] = [{ read: true, slug: "a", source: SOURCE, text: "short" }];
    expect(withFittedBriefings({ answer, briefings, capBytes, maxBytes: 1024 })).toEqual({
      ...answer,
      briefings: [{ read: true, slug: "a", text: "short" }],
    });
  });

  it("cuts every read briefing to an equal share under the cap, marks each partial, and drops none", () => {
    const briefings: ReadCardBriefing[] = [
      { read: true, slug: "a", source: SOURCE, text: "a".repeat(4000) },
      { read: true, slug: "b", source: SOURCE, text: "“b”".repeat(2000) },
      { read: false, say: "I couldn't open the c briefing, so I can't read that to you.", slug: "c", why: "ENOENT" },
    ];
    const fitted = withFittedBriefings({ answer, briefings, capBytes, maxBytes: 4096 });
    expect(bytesOf({ value: fitted })).toBeLessThanOrEqual(4096);
    expect(fitted.briefings.map((one) => [one.slug, one.read])).toEqual([
      ["a", "partial"],
      ["b", "partial"],
      ["c", false],
    ]);
    const carried = (fitted.briefings[0] as { text: string }).text;
    expect(fitted.briefings[0]).toEqual({
      read: "partial",
      rest: { from: carried.length, path: PAGE },
      say: "I could only read the first part of the a briefing.",
      slug: "a",
      text: carried,
    });
    expect(carried.length).toBeGreaterThan(1000);
  });

  it("names the first unreadable briefings that fit and counts the rest when even bare entries are over the cap", () => {
    const briefings: ReadCardBriefing[] = Array.from({ length: 200 }, (_, index) => {
      const slug = `missing-${String(index).padStart(3, "0")}`;
      return { read: false, say: couldNotOpenSay({ slug }), slug, why: "ENOENT" };
    });
    const fitted = withFittedBriefings({ answer, briefings, capBytes, maxBytes: CARD_ANSWER_MAX_BYTES });
    expect(bytesOf({ value: fitted })).toBeLessThanOrEqual(CARD_ANSWER_MAX_BYTES);
    expect(fitted.briefings[0].slug).toBe("missing-000");
    expect(fitted.briefings.length + fitted.briefingsLeftOut!.count).toBe(200);
    expect(fitted.briefingsLeftOut!.say).toBe(
      `This card links ${String(fitted.briefingsLeftOut!.count)} more briefings I couldn't fit in, so I can't read those to you.`,
    );
    expect(
      bytesOf({ value: { ...fitted, briefings: briefings.slice(0, fitted.briefings.length + 1) } }),
    ).toBeGreaterThan(CARD_ANSWER_MAX_BYTES);
  });

  it("still names a briefing it cannot fit when the bare card sits just under the budget, under the page's cap", () => {
    const bare = { card: { key: "ask:x", what: "x".repeat(CARD_ANSWER_MAX_BYTES - 60) } };
    expect(bytesOf({ value: bare })).toBeLessThanOrEqual(CARD_ANSWER_MAX_BYTES);
    const fitted = withFittedBriefings({
      answer: bare,
      briefings: [{ read: true, slug: "a", source: SOURCE, text: "briefing text" }],
      capBytes,
      maxBytes: CARD_ANSWER_MAX_BYTES,
    });
    expect([fitted.briefings.map((one) => [one.slug, one.read]), fitted.briefingsLeftOut]).toEqual([
      [["a", true]],
      undefined,
    ]);
    expect(bytesOf({ value: fitted })).toBeLessThanOrEqual(capBytes);
  });

  // A card past the budget but under the page's cap was fitted to the
  // budget alone, so its one briefing was counted out and the sentence could carry it over the cap.
  it("fits a card past the budget but under the page's cap to the page's cap, never over it", () => {
    // 260 leaves the bare partial entry room for its `rest`, which a cut one carries.
    const bare = { card: { key: "ask:x", what: "x".repeat(capBytes - 260) } };
    expect([bytesOf({ value: bare }) > CARD_ANSWER_MAX_BYTES, bytesOf({ value: bare }) < capBytes]).toEqual([
      true,
      true,
    ]);
    const fitted = withFittedBriefings({
      answer: bare,
      briefings: [{ read: true, slug: "a", source: SOURCE, text: "a".repeat(4000) }],
      capBytes,
      maxBytes: CARD_ANSWER_MAX_BYTES,
    });
    expect([fitted.briefings.map((one) => [one.slug, one.read]), fitted.briefingsLeftOut]).toEqual([
      [["a", "partial"]],
      undefined,
    ]);
    expect(bytesOf({ value: fitted })).toBeLessThanOrEqual(capBytes);
  });

  // A second counterexample: one bare entry is smaller than the sentence counting it out, so a search that
  // assumed each one more kept is larger tried none, found it over, and handed back an answer over the page's cap.
  // A cut briefing's entry carries its `rest` and is larger than that sentence, so the counterexample is an unreadable briefing's entry, which still is not.
  it("keeps a lone briefing as a bare entry where the sentence counting it out would not fit", () => {
    const entry: ReadCardBriefing = { read: false, say: couldNotOpenSay({ slug: "a" }), slug: "a", why: "x" };
    const empty = { card: { key: "ask:x", what: "" } };
    const room = capBytes - bytesOf({ value: { ...empty, briefings: [entry] } });
    const bare = { card: { key: "ask:x", what: "x".repeat(room) } };
    const leftOut = { count: 1, say: leftOutSay({ count: 1 }) };
    expect([
      bytesOf({ value: { ...bare, briefings: [entry] } }),
      bytesOf({ value: { ...bare, briefings: [], briefingsLeftOut: leftOut } }) > capBytes,
    ]).toEqual([capBytes, true]);
    const fitted = withFittedBriefings({ answer: bare, briefings: [entry], capBytes, maxBytes: CARD_ANSWER_MAX_BYTES });
    expect([fitted.briefings, fitted.briefingsLeftOut]).toEqual([[entry], undefined]);
    expect(bytesOf({ value: fitted })).toBe(capBytes);
  });

  it("says one more briefing in the singular", () => {
    expect(leftOutSay({ count: 1 })).toBe(
      "This card links one more briefing I couldn't fit in, so I can't read that to you.",
    );
  });
});

describe("withBriefings", () => {
  it("names each briefing not read whole as a failure the console window shows", () => {
    const { failures } = withBriefings({
      answer: {},
      briefings: [
        { read: true, slug: "a", source: SOURCE, text: "w" },
        { read: "partial", rest: { from: 1, path: PAGE }, say: "s", slug: "b", source: SOURCE, text: "w" },
        { read: false, say: "s", slug: "c", why: "ENOENT" },
      ],
      cardKey: "ask:x",
    });
    expect(failures).toEqual([
      { cardKey: "ask:x", part: "briefing", why: "b: read in part" },
      { cardKey: "ask:x", part: "briefing", why: "c: ENOENT" },
    ]);
  });

  it("names the briefings left out past the answer's size as one failure", () => {
    const briefings: ReadCardBriefing[] = Array.from({ length: 200 }, (_, index) => {
      const slug = `missing-${String(index).padStart(3, "0")}`;
      return { read: false, say: couldNotOpenSay({ slug }), slug, why: "ENOENT" };
    });
    const { answer, failures } = withBriefings({ answer: {}, briefings, cardKey: "ask:x" });
    const leftOut = answer.briefingsLeftOut!.count;
    expect(failures.length).toBe(200 - leftOut + 1);
    expect(failures.at(-1)).toEqual({
      cardKey: "ask:x",
      part: "briefing",
      why: `${String(leftOut)} more past the answer's size, not read`,
    });
  });

  // A card under the page's cap by less than the sentence counting its briefing out has room
  // for nothing about that briefing. It is refused whole, and that refusal, naming the tool, is what the model is
  // handed and says — never the card with its briefing silently missing.
  it("refuses whole, naming the tool, a card under the cap with no room for even the sentence counting its briefing", () => {
    const bare = { card: { key: "ask:x", what: "x".repeat(TOOL_OUTPUT_MAX - 76 - 34) } };
    expect(bytesOf({ value: bare })).toBe(TOOL_OUTPUT_MAX - 76);
    const { answer } = withBriefings({
      answer: bare,
      briefings: [{ read: true, slug: "a", source: SOURCE, text: "briefing text" }],
      cardKey: "ask:x",
    });
    expect(toolOutputOf({ answer, tool: "read_card" })).toEqual(
      ToolOutputErrors.overCap({ bytes: bytesOf({ value: answer }), tool: "read_card" }),
    );
  });
});

describe("readCardBriefings", () => {
  it("reads every slug in order, and a read that throws comes back as one it could not open", async () => {
    const briefings = await readCardBriefings({
      readBriefing: async ({ slug }) => {
        if (slug === "b") {
          throw new Error("the route is down");
        }
        return { masked: false, nextFrom: null, ok: true, path: PAGE, text: `words of ${slug}`, whole: true };
      },
      files: new Map(),
      slugs: ["a", "b"],
    });
    expect(briefings).toEqual([
      { read: true, slug: "a", source: SOURCE, text: "words of a" },
      {
        read: false,
        say: "I couldn't open the b briefing, so I can't read that to you.",
        slug: "b",
        why: "the route is down",
      },
    ]);
  });

  it("hands each failed read to file_read at the file the card names for THAT slug, and only that one", async () => {
    const other = "/h/.slopweaver/pages/b/index.html";
    const briefings = await readCardBriefings({
      readBriefing: async ({ slug }) => {
        if (slug === "b") {
          throw new Error("the route is down");
        }
        return { ok: false, why: "the Queue tool's time ran out before this was read" };
      },
      files: new Map([["b", other]]),
      slugs: ["a", "b"],
    });
    expect(briefings).toEqual([
      {
        read: false,
        say: "I couldn't open the a briefing, so I can't read that to you.",
        slug: "a",
        why: "the Queue tool's time ran out before this was read",
      },
      {
        read: "partial",
        rest: { from: 0, path: other },
        say: "I couldn't open the b briefing, so I can't read that to you.",
        slug: "b",
        source: { masked: false, path: other },
        text: "",
      },
    ]);
  });
});
