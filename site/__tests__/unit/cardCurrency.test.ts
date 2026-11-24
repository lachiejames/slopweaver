/**
 * The Queue card's currency mark: fresh only when BOTH halves were rechecked, its facts and the owner's steers, and
 * otherwise which half was; that a re-asked card never inherits an old reading; that a looks-answered or already-ruled
 * card leaves the waiting tiers and a fresh one leads its tier. The strict reader is `./cardCurrencyReader.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import type { CurrencyCard } from "../../lib/cardCurrency";
import { cardCurrencyOf, currencyOrdered } from "../../lib/cardCurrencyMark";
import { ASKED, ask, CHECKED, CONFIRMED, floored, markOf, READ, readingOf, said, v3Of } from "./cardCurrencyFixture";

const RULED = "2026-10-02T11:15:00.000Z";
const REPLY = "https://acme.slack.com/archives/C1/p1785114518000200";

describe("cardCurrencyOf", () => {
  it("says fresh only when its facts and the owner's steers were both rechecked, aged by the older of the two", () => {
    const mark = markOf({ card: floored(ask), reading: v3Of() });

    expect(mark.kind).toBe("fresh");
    expect(mark.fresh).toBe(true);
    expect(mark.words).toBe(`fresh · checked age(${CONFIRMED})`);
    expect(mark.lines).toEqual([
      `Facts: last confirmed age(${CONFIRMED}).`,
      `Your steers: checked age(${CHECKED}) against everything you said and every change to your standing rulings, memories and owner profile since it was asked; nothing new bears on it.`,
      "Done when you rule on it or it is settled.",
    ]);
    expect(mark.title).toBe(mark.lines.join("\n"));
    // No method fold on a card — what each source read is docs/console's, never the mark's.
    expect(Object.keys(mark).toSorted()).toEqual(["fresh", "kind", "lines", "said", "title", "unread", "words"]);
    expect(mark.said).toBeUndefined();
  });

  it("says facts only, never fresh, when the owner has said things since — and lists them only in the fold", () => {
    const mark = markOf({
      reading: { ...readingOf({ since: said }), said: { "transcript:c#1": { cut: "none", text: "merge it tonight" } } },
    });

    expect(mark.kind).toBe("facts-only");
    expect(mark.fresh).toBe(false);
    expect(mark.words).toBe(`facts checked age(${CONFIRMED}) · not your steers`);
    expect(mark.lines[1]).toBe(
      `Your steers: checked age(${CHECKED}); you have said things since it was asked that could bear on it, not yet folded in; they are listed below.`,
    );
    expect(mark.lines[3]).toContain("it may be superseded, stale or closed with nothing needed from you");
    expect(mark.said).toEqual({
      groups: [
        {
          heading: "Tied to this card",
          rows: [
            {
              atIso: "2026-10-02T10:06:00.000Z",
              lead: undefined,
              more: false,
              said: undefined,
              where: "Relayed from a console call, age(2026-10-02T10:06:00.000Z)",
            },
          ],
        },
        {
          heading: "Not yet tied to any card, so any of these could bear on this one",
          rows: [
            {
              atIso: "2026-10-02T10:05:00.000Z",
              lead: "merge it tonight",
              more: false,
              said: { cut: "none", text: "merge it tonight" },
              where: "In the supervisor chat, age(2026-10-02T10:05:00.000Z)",
            },
          ],
        },
      ],
      summary: "2 things you said since it was asked: 1 tied to this card, 1 not yet tied to any",
    });
  });

  it("keeps the Checked section to four lines and every word in the fold, however much the owner has said since", () => {
    const words = Array.from({ length: 148 }, (_, at) => ({
      atIso: `2026-10-02T11:${String(at % 60).padStart(2, "0")}:00.000Z`,
      filed: "unfiled" as const,
      pointer: `transcript:chair#${String(at)}`,
      source: "chair" as const,
    }));
    const long = "word ".repeat(40).trim();
    // A clock that names no instant, so any ISO left in the visible text is one the card drew itself.
    const mark = cardCurrencyOf({
      ageOf: () => "3m ago",
      card: ask,
      reading: {
        ...readingOf({ since: { gaps: [], standing: [], words } }),
        said: { "transcript:chair#0": { cut: "end", text: long } },
      },
    });
    const visible = [...mark.lines, mark.title].join("\n");

    expect(mark.lines.length).toBe(4);
    expect(mark.title.split("\n").length).toBe(4);
    expect(visible).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(visible).not.toContain("transcript:");
    expect(visible).not.toContain("chair ·");
    expect(mark.said!.summary).toBe("148 things you said since it was asked: none yet tied to a card");
    expect(mark.said!.groups.flatMap((group) => group.rows).length).toBe(148);
    expect(mark.said!.groups[0].rows[0]).toEqual({
      atIso: "2026-10-02T11:59:00.000Z",
      lead: undefined,
      more: false,
      said: undefined,
      where: "In the supervisor chat, 3m ago",
    });
    const first = mark.said!.groups.flatMap((group) => group.rows).find((row) => row.said !== undefined)!;
    expect(first.lead).toBe(`${"word ".repeat(25).trim()} …`);
    expect(first.more).toBe(true);
    expect(first.said).toEqual({ cut: "end", text: long });
  });

  it.each([
    ["none", "merge it tonight", false],
    ["end", "merge it tonight …", true],
    ["start", "… merge it tonight", true],
  ] as const)("marks a short quote the record cut at %s where its words are missing", (cut, lead, more) => {
    const mark = markOf({
      reading: { ...readingOf({ since: said }), said: { "transcript:c#1": { cut, text: "merge it tonight" } } },
    });
    const row = mark.said!.groups[1].rows[0];

    expect(row.lead).toBe(lead);
    expect(row.more).toBe(more);
  });

  it("says where a word was said, unquoted, when the reading predates carrying the owner's words", () => {
    const mark = markOf({ reading: readingOf({ since: said }) });

    expect(mark.said!.groups[1].rows[0]).toEqual({
      atIso: "2026-10-02T10:05:00.000Z",
      lead: undefined,
      more: false,
      said: undefined,
      where: "In the supervisor chat, age(2026-10-02T10:05:00.000Z)",
    });
  });

  it("counts since the re-confirmation when that is the floor", () => {
    const mark = markOf({ reading: readingOf({ floorIso: CONFIRMED, since: said }) });

    expect(mark.said!.summary).toBe(
      "2 things you said since it was last re-confirmed: 1 tied to this card, 1 not yet tied to any",
    );
  });

  it("says steers only when nothing has re-confirmed its facts since it was asked", () => {
    const mark = markOf({ card: floored({ ...ask, verifiedIso: undefined }), reading: v3Of() });

    expect(mark.kind).toBe("steers-only");
    expect(mark.words).toBe(`your steers checked age(${CHECKED}) · not its facts`);
    expect(mark.title).toContain("Facts: never re-confirmed since it was asked.");
  });

  it("counts a done-check's read as a facts check", () => {
    const mark = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({ done: { kind: "not-yet", readAtIso: READ } }),
    });

    expect(mark.kind).toBe("fresh");
    expect(mark.words).toBe(`fresh · checked age(${CHECKED})`);
  });

  it("says looks answered, with the owner's reply's link, when the done-check passed", () => {
    const mark = markOf({
      reading: readingOf({ done: { atIso: "2026-10-02T11:00:00.000Z", kind: "replied", permalink: REPLY } }),
    });

    expect(mark.kind).toBe("looks-answered");
    expect(mark.words).toBe("looks answered · you replied age(2026-10-02T11:00:00.000Z)");
    expect(mark.title).toContain(REPLY);
  });

  it("never says fresh when a source or the done-check would not read", () => {
    const gap = markOf({
      card: floored(ask),
      reading: v3Of({
        since: { gaps: ["your supervisor-chat turns could not be read: no pin"], standing: [], words: [] },
      }),
    });
    const done = markOf({ card: floored(ask), reading: v3Of({ done: { kind: "could-not-check", why: "no token" } }) });
    const unrun = markOf({
      card: floored(ask),
      reading: v3Of({ done: { checks: ["path: a.md"], kind: "declared-not-run" } }),
    });

    expect(gap.kind).toBe("facts-only");
    expect(gap.lines[1]).toBe(
      `Your steers: checked age(${CHECKED}); nothing that read since it was asked bears on it.`,
    );
    expect(gap.unread).toEqual([
      {
        subject: "one place what you said since is read from",
        why: "your supervisor-chat turns could not be read: no pin",
      },
    ]);
    expect(done.kind).toBe("steers-only");
    expect(done.lines[0]).toBe(`Facts: last confirmed age(${CONFIRMED}).`);
    expect(done.unread).toEqual([{ subject: "whether you have replied in its Slack thread", why: "no token" }]);
    expect(unrun.kind).toBe("steers-only");
    expect(unrun.lines[0]).toBe("Facts: its declared done-check was not run by the currency check.");
    expect(unrun.lines).toContain("Done when its declared checks pass, which the tick does not run.");
    // A declared check can name a path, so it never reaches the card's lines or its hover.
    expect(unrun.title).not.toContain("path: a.md");
    expect(unrun.unread).toEqual([]);
  });

  // A failed read inside the check is the staleness mark beside it, never a sentence in its lines, and a check
  // that ran over the card never reads "not checked yet".
  it("marks a failed read beside what the check last said, and names both halves a check that passed neither failed on", () => {
    const mark = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({
        done: { kind: "could-not-check", why: "no token" },
        since: { gaps: ["no pin"], standing: [], words: [] },
      }),
    });

    expect(mark.kind).toBe("unchecked");
    expect(mark.words).toBe("not re-confirmed · some steers unread");
    expect(mark.lines).toEqual([
      "Facts: never re-confirmed since it was asked.",
      `Your steers: checked age(${CHECKED}); nothing that read since it was asked bears on it.`,
      "Done when you reply in its Slack thread.",
      "Not ready to react to yet: it may be superseded, stale or closed with nothing needed from you.",
    ]);
    expect(mark.unread.map((fact) => fact.subject)).toEqual([
      "one place what you said since is read from",
      "whether you have replied in its Slack thread",
    ]);
  });

  // The owner's Queue once wore "checked 67s ago · not fresh" on every card: a seconds-old check read as a late one.
  // A card that failed both halves says what each half needs, and never an age or "not fresh".
  it("names what failed on an ask nothing re-confirmed and the owner spoke after, with no age and no warning mark", () => {
    const unfiled = said.words[0];
    const mark = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({
        fact: { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" },
        since: { gaps: [], standing: [], words: [unfiled] },
      }),
    });

    expect(mark.kind).toBe("unchecked");
    expect(mark.fresh).toBe(false);
    expect(mark.words).toBe("not re-confirmed · you said things since");
    expect(mark.words).not.toContain(CHECKED);
    expect(mark.unread).toEqual([]);
  });

  it("says not checked yet for a card no check covered, and names the failures for one a check covered", () => {
    const missed = markOf({ card: floored({ ...ask, key: "ask:other", verifiedIso: undefined }), reading: v3Of() });
    const none = markOf({ card: floored({ ...ask, verifiedIso: undefined }), reading: undefined });
    const covered = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({ since: { gaps: [], standing: [], words: [said.words[0]] } }),
    });

    expect([missed.kind, none.kind, covered.kind]).toEqual(["unchecked", "unchecked", "unchecked"]);
    expect(missed.words).toBe("not checked yet");
    expect(none.words).toBe("not checked yet");
    expect(covered.words).toBe("not re-confirmed · you said things since");
  });

  it("says the owner's guidance changed when only a standing change since bears on the card", () => {
    const mark = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({
        fact: { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" },
        since: {
          gaps: [],
          standing: [{ atIso: "2026-10-02T10:30:00.000Z", filed: "unfiled", pointer: "memory:a.md", source: "memory" }],
          words: [],
        },
      }),
    });

    expect(mark.words).toBe("not re-confirmed · your guidance changed since");
  });

  it("says a fact's read failed when the failure sits on the done-check, as an unread Slack thread's does", () => {
    const mark = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({
        done: { kind: "could-not-check", why: "ECONNRESET" },
        fact: { kind: "not-confirmed", why: "its Slack thread could not be read" },
        since: { gaps: [], standing: [], words: [said.words[0]] },
      }),
    });

    expect(mark.words).toBe("facts read failed · you said things since");
  });

  it("never passes facts a still-real check confirmed when its Slack thread would not read, and keeps what confirmed them", () => {
    const stillReal = { atIso: CONFIRMED, by: "its still-real check", kind: "confirmed" as const };
    const unreadThread = { kind: "could-not-check" as const, why: "ECONNRESET" };
    const quiet = markOf({ card: floored(ask), reading: v3Of({ done: unreadThread, fact: stillReal }) });
    const spoken = markOf({
      card: floored(ask),
      reading: v3Of({ done: unreadThread, fact: stillReal, since: { gaps: [], standing: [], words: [said.words[0]] } }),
    });

    expect(quiet.kind).toBe("steers-only");
    expect(quiet.fresh).toBe(false);
    expect(quiet.words).toBe(`your steers checked age(${CHECKED}) · not its facts`);
    expect(quiet.lines[0]).toBe(`Facts: last confirmed age(${CONFIRMED}), by its still-real check.`);
    expect(quiet.unread).toEqual([{ subject: "whether you have replied in its Slack thread", why: "ECONNRESET" }]);
    expect(spoken.kind).toBe("unchecked");
    expect(spoken.words).toBe("facts read failed · you said things since");
    expect(spoken.lines[0]).toBe(quiet.lines[0]);
    expect(spoken.unread).toEqual(quiet.unread);
  });

  it("passes facts a still-real check confirmed when its Slack thread read and found no reply", () => {
    const mark = markOf({
      card: floored(ask),
      reading: v3Of({
        done: { kind: "not-yet", readAtIso: READ },
        fact: { atIso: CONFIRMED, by: "its still-real check", kind: "confirmed" },
      }),
    });

    expect(mark.kind).toBe("fresh");
    expect(mark.words).toBe(`fresh · checked age(${CONFIRMED})`);
  });

  it("says a fact's read failed, and keeps its reason for the staleness mark", () => {
    const mark = markOf({
      card: floored({ ...ask, verifiedIso: undefined }),
      reading: v3Of({
        fact: {
          kind: "not-confirmed",
          unread: "the monitor pass file is locked",
          why: "its monitor's last pass would not read",
        },
        since: { gaps: [], standing: [], words: [said.words[0]] },
      }),
    });

    expect(mark.words).toBe("facts read failed · you said things since");
    expect(mark.unread).toEqual([{ subject: "how its facts were checked", why: "the monitor pass file is locked" }]);
  });

  it("keeps a source's own failure reason out of the lines and the badge's hover, for the staleness mark, aged", () => {
    const why = "session sess-123 at transcript:c#1, lease held since 2026-10-02T09:00:00.000Z";
    const mark = cardCurrencyOf({
      ageOf: () => "3m ago",
      card: ask,
      reading: readingOf({ done: { kind: "could-not-check", why }, since: { gaps: [why], standing: [], words: [] } }),
    });
    const visible = [...mark.lines, mark.title].join("\n");

    expect(visible).toContain("checked 3m ago");
    expect(visible).not.toContain("sess-123");
    expect(visible).not.toContain("transcript:");
    expect(visible).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
    expect(mark.unread.map((fact) => fact.why)).toEqual([
      "session sess-123 at transcript:c#1, lease held since 3m ago",
      "session sess-123 at transcript:c#1, lease held since 3m ago",
    ]);
  });

  it("never lets a re-asked card inherit the old reading", () => {
    const mark = markOf({ card: { ...ask, whenIso: "2026-10-02T11:30:00.000Z" }, reading: readingOf() });

    expect(mark.kind).toBe("facts-only");
    expect(mark.title).toContain(
      `Asked again age(2026-10-02T11:30:00.000Z), after the last check (age(${CHECKED})) read it.`,
    );
  });

  it("says not checked yet when neither half has been", () => {
    const fresh = { ...ask, verifiedIso: undefined };

    expect(markOf({ card: fresh, reading: undefined }).words).toBe("not checked yet");
    expect(markOf({ card: { ...fresh, key: "ask:other" }, reading: readingOf() }).kind).toBe("unchecked");
  });

  it("checks a hand step's steers under the ask it opens", () => {
    const mark = markOf({
      card: { aliases: ["ask:mirror"], key: "hand:step-1", kind: "hand", verifiedIso: READ, whenIso: ASKED },
      reading: readingOf(),
    });

    // Covered under the ask, so its steers read — but an ask-only reading predates the owner's standing set, so never passed.
    expect(mark.kind).toBe("facts-only");
    expect(mark.lines[1]).toContain("but not against your standing rulings, memories and owner profile");
  });

  it("never confirms a monitor's step through the ask it aliases on an ask-only reading", () => {
    const monitorStep: CurrencyCard = {
      aliases: ["ask:mirror"],
      key: "hand:mon-health-verdict",
      kind: "hand",
      verifiedIso: undefined,
      whenIso: ASKED,
    };
    const reading = readingOf({ done: { kind: "not-yet", readAtIso: READ } });

    expect(markOf({ card: monitorStep, reading }).kind).toBe("unchecked");
    expect(markOf({ card: { ...monitorStep, key: "ask:mirror", kind: "ask" }, reading }).kind).toBe("facts-only");
  });

  it("says a register card's facts were read and its steers were not — never live, never its first-shown age", () => {
    const mark = markOf({
      card: { key: "draft:abc", kind: "draft", verifiedIso: READ, whenIso: ASKED },
      reading: readingOf(),
    });

    expect(mark.kind).toBe("facts-only");
    expect(mark.fresh).toBe(false);
    expect(mark.words).toBe(`facts checked age(${READ}) · not your steers`);
    expect(mark.title).toContain("No check of what you have said since covers this kind of card.");
  });

  it("says the owner ruled on it when the ask a hand step opens already carries their ruling, whatever the reading says", () => {
    const mark = markOf({
      card: { key: "hand:vanta", kind: "hand", ruledIso: RULED, verifiedIso: READ, whenIso: ASKED },
      reading: readingOf(),
    });

    expect(mark.kind).toBe("ruled");
    expect(mark.fresh).toBe(false);
    expect(mark.words).toBe(`you ruled on it · age(${RULED})`);
    expect(mark.title).toContain(`decided age(${RULED})`);
    expect(mark.lines).toEqual([mark.title]);
  });
});

describe("currencyOrdered", () => {
  const draft = ({ key, tier }: { key: string; tier: string }): CurrencyCard & { tier: string } => ({
    key,
    kind: "draft",
    tier,
    verifiedIso: READ,
    whenIso: ASKED,
  });

  it("moves a looks-answered card to the check-ins, last, and leaves the rest in order", () => {
    const rows = [{ ...ask, tier: "team-blocked" }, draft({ key: "draft:abc", tier: "team-blocked" })];
    const reading = readingOf({ done: { atIso: "2026-10-02T11:00:00.000Z", kind: "replied", permalink: REPLY } });

    expect(currencyOrdered({ reading, rows }).map((row) => [row.key, row.tier])).toEqual([
      ["draft:abc", "team-blocked"],
      ["ask:mirror", "check-in"],
    ]);
  });

  it("moves a step whose ask the owner already ruled on to the check-ins even before any reading has arrived", () => {
    const rows = [
      { key: "hand:vanta", kind: "hand", ruledIso: RULED, tier: "fleet-blocked", verifiedIso: READ, whenIso: ASKED },
      draft({ key: "draft:abc", tier: "fleet-blocked" }),
    ];

    expect(currencyOrdered({ reading: undefined, rows }).map((row) => [row.key, row.tier])).toEqual([
      ["draft:abc", "fleet-blocked"],
      ["hand:vanta", "check-in"],
    ]);
  });

  it("leads each tier with its fresh cards, keeping the tiers and each group's own order", () => {
    const rows = [
      draft({ key: "draft:a", tier: "team-blocked" }),
      draft({ key: "draft:b", tier: "fleet-blocked" }),
      draft({ key: "draft:c", tier: "fleet-blocked" }),
      { ...floored(ask), tier: "fleet-blocked" },
    ];

    expect(currencyOrdered({ reading: v3Of(), rows }).map((row) => row.key)).toEqual([
      "draft:a",
      "ask:mirror",
      "draft:b",
      "draft:c",
    ]);
  });

  it("returns the rows themselves when nothing moves", () => {
    const rows = [{ ...ask, tier: "team-blocked" }];

    expect(currencyOrdered({ reading: undefined, rows })).toBe(rows);
  });
});
