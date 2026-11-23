import { describe, expect, it } from "vitest";

import { measureVersion, totalAges } from "../../../measurement/briefingCardAge.js";

/** The `landedIso` per page, as the `--open-artifacts` document carries it. */
const LANDED: ReadonlyMap<string, string> = new Map([
  ["https://claude.ai/code/artifact/1137d5b7", "2026-09-10T20:03:23Z"],
  ["https://claude.ai/code/artifact/7e7113f7", "2026-09-01T00:00:00Z"],
]);

/** One rendered page, in the shape `../../../outbound/briefing/render.ts` emits. */
function page({ cards }: { cards: readonly string[] }): string {
  return `<h1>Fleet Briefing</h1><h2>react now</h2>${cards.join("")}<h2>done</h2><div class="need">landed.</div>`;
}

/** One card, optionally carrying a subject link the open-pages document can date. */
function card({ question, url }: { question: string; url?: string }): string {
  const subject = url === undefined ? "" : `<div class="bg"><a href="${url}">the page</a></div>`;
  return `<div class="need"><div class="q">${question}</div>${subject}</div>`;
}

describe("measureVersion", () => {
  it("dates a card from the page its subject links, and leaves one with no subject undated", () => {
    const html = page({
      cards: [
        card({ question: "1. Which letters?", url: "https://claude.ai/code/artifact/1137d5b7#react-now" }),
        card({ question: "2. Sign in now or after the reset?" }),
      ],
    });

    const measured = measureVersion({
      html,
      landedByUrl: LANDED,
      renderedIso: "2026-09-11T21:18:59Z",
      source: "briefing-t238-0.html",
    });

    expect(measured.cards.length).toBe(2);
    expect(measured.cards[0]!.card).toBe(1);
    expect(measured.cards[0]!.question).toBe("1. Which letters?");
    expect(measured.cards[0]!.ageHours).toBeCloseTo(25.26, 2);
    expect(measured.cards[1]!.ageHours).toBeUndefined();
  });

  it("reads only the react-now block, so a landed note below the line is not a card", () => {
    const measured = measureVersion({
      html: page({ cards: [card({ question: "1. Ship it?" })] }),
      landedByUrl: LANDED,
      renderedIso: "2026-09-11T21:18:59Z",
      source: "one.html",
    });

    expect(measured.cards.length).toBe(1);
  });

  it("measures nothing on a page carrying no react-now heading, rather than guessing at one", () => {
    const measured = measureVersion({
      html: '<h1>Something else</h1><div class="need"><div class="q">hello</div></div>',
      landedByUrl: LANDED,
      renderedIso: "2026-09-11T21:18:59Z",
      source: "other.html",
    });

    expect(measured.cards).toEqual([]);
  });

  it("dates the oldest card on the version the owner read at the age the finding states", () => {
    const html = page({
      cards: [card({ question: "1. Voice setup?", url: "https://claude.ai/code/artifact/7e7113f7" })],
    });

    const measured = measureVersion({
      html,
      landedByUrl: LANDED,
      renderedIso: "2026-09-11T21:18:59Z",
      source: "briefing-t238-0.html",
    });

    expect(measured.cards[0]!.ageHours).toBeCloseTo(261.32, 2);
  });
});

describe("totalAges", () => {
  it("counts appearances, datable premises and the ones past the threshold separately", () => {
    const versions = [
      {
        cards: [
          { ageHours: 25.3, card: 1, question: "a" },
          { ageHours: undefined, card: 2, question: "b" },
        ],
        renderedIso: "2026-09-11T21:18:59Z",
        source: "one.html",
      },
      {
        cards: [
          { ageHours: 6, card: 1, question: "c" },
          { ageHours: 261.3, card: 2, question: "d" },
        ],
        renderedIso: "2026-09-11T21:48:29Z",
        source: "two.html",
      },
    ];

    expect(totalAges({ thresholdHours: 12, versions })).toEqual({
      appearances: 4,
      datable: 3,
      oldestHours: 261.3,
      overThreshold: 2,
    });
  });

  it("reports no oldest age at all when nothing was datable, rather than zero", () => {
    const versions = [
      { cards: [{ ageHours: undefined, card: 1, question: "a" }], renderedIso: "2026-09-11T21:18:59Z", source: "x" },
    ];

    expect(totalAges({ thresholdHours: 12, versions }).oldestHours).toBeUndefined();
  });

  it("counts a premise exactly at the threshold as inside it", () => {
    const versions = [
      { cards: [{ ageHours: 12, card: 1, question: "a" }], renderedIso: "2026-09-11T21:18:59Z", source: "x" },
    ];

    expect(totalAges({ thresholdHours: 12, versions }).overThreshold).toBe(0);
  });
});
