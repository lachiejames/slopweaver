/**
 * One open-pages row held to the page's own gates, then placed: what passes, what is refused and by which
 * rule, and the one property the verb exists for — a refused row changes nothing, an accepted one lands whole.
 */
import { describe, expect, it } from "vitest";

import { OPEN_ARTIFACTS_MAX_ITEMS } from "../../../briefing/caps.js";
import { gateOpenPageRow, otherRowRefusals, placeOpenPageRow } from "../../../briefing/openPageRow.js";
import type { OpenPageRowError } from "../../../briefing/openPageRowErrors.js";
import type { ReadPublishedPage } from "../../../briefing/publishedPageRead.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-09-16T20:00:00Z";
const PAGES = "/Users/owner/.slopweaver/pages";
const FIRST = `file://${PAGES}/first/index.html`;
const SECOND = `file://${PAGES}/second/index.html`;

/** One row carrying every field a card needs, under every cap. */
function row({ url = FIRST, over = {} }: { url?: string; over?: Record<string, unknown> } = {}): Record<
  string,
  unknown
> {
  return {
    ask: "Your word on which reader the fleet ships.",
    ifSilent: "The branch waits and a stale seat keeps failing to record a ruling.",
    label: "a stale branch cannot read a journal line newer main wrote",
    landedIso: "2026-09-16T19:30:00Z",
    lean: "C, because A removes the wedge by construction and B makes any surviving refusal self-servicing.",
    options: [
      { letter: "A", text: "Tell the supervisor A and the session ships the tolerant reader alone." },
      { letter: "B", text: "Tell the supervisor B and the session ships the self-servicing refusal alone." },
      { letter: "C", text: "Tell the supervisor C and the session ships both in one change." },
    ],
    question: "Which journal fix does the fleet ship, the tolerant reader, the self-servicing refusal, or both?",
    url,
    what: "A session on a two-day-old branch tried to record your ruling and was refused. The journal held a line its older parser could not read. A makes an unknown event kind readable. B makes the refusal name the kind and tell the session to pull.",
    whyYou: "Which of two journal readers the fleet trusts across every branch is a preference only you can set.",
    ...over,
  };
}

/** A page reader answering every page with bytes that mark nothing, so a row's typed pair stands. */
const UNMARKED: ReadPublishedPage = () => ok("<p>A page that marks nothing.</p>");

/** The gate with every leg on and no private voice rules, as the verb runs it by default. */
function gate({
  value,
  ledgerText = "",
  readPage = UNMARKED,
}: {
  value: unknown;
  ledgerText?: string;
  readPage?: ReadPublishedPage;
}): ReturnType<typeof gateOpenPageRow> {
  return gateOpenPageRow({
    applyFraming: true,
    applyVoice: true,
    ledgerText,
    nowIso: NOW,
    pagesDirectory: PAGES,
    readPage,
    row: value,
    rules: [],
  });
}

/** The defect lines a refusal carries; the code assertion beside each call is what makes this narrowing honest. */
function defectsOf({ error }: { error: OpenPageRowError }): readonly string[] {
  if (error.code === "ROW_REFUSED" || error.code === "DOCUMENT_REFUSED") {
    return error.defects;
  }
  return [];
}

/** One lock-in ledger line recording the owner's ruling against a page. */
function ledgerLine({ url, outcome }: { url: string; outcome: string }): string {
  return JSON.stringify({
    againstWhenIso: "2026-09-16T19:30:00Z",
    identity: url,
    outcome,
    proposed: "react to the journal page",
    tsIso: "2026-09-16T19:45:00Z",
    verb: "note",
  });
}

describe("gateOpenPageRow", () => {
  it("passes a row under every cap and reports the card it becomes", () => {
    const gated = unwrap(gate({ value: row() }));

    expect(gated.artifact.url).toBe(FIRST);
    expect(gated.artifact.rank).toBe(1);
    expect(gated.artifact.validity).toEqual({ mark: "valid" });
    expect(gated.card.question).toBe(
      "Which journal fix does the fleet ship, the tolerant reader, the self-servicing refusal, or both?",
    );
    expect(gated.card.subject).toEqual({
      text: "a stale branch cannot read a journal line newer main wrote",
      url: FIRST,
    });
    expect(gated.card.readiness).toEqual({ state: "ready" });
    expect(gated.card.premise).toEqual({ kind: "artifact", landedIso: "2026-09-16T19:30:00Z" });
    expect(gated.aboveFoldWords).toBe(164);
    expect(gated.typed).toEqual([
      {
        label: "a stale branch cannot read a journal line newer main wrote",
        url: FIRST,
        why: "the page marks no question and no lean",
      },
    ]);
  });

  it("builds the card from the page's marked question and lean when the row types neither", () => {
    const { question: _question, lean: _lean, ...untyped } = row();
    const readPage: ReadPublishedPage = () =>
      ok(
        '<p data-card="question">Which journal fix does the fleet ship first?</p>' +
          '<p data-card="lean">A, because it removes the wedge by construction.</p>',
      );
    const gated = unwrap(gate({ readPage, value: untyped }));

    expect(gated.card.question).toBe("Which journal fix does the fleet ship first?");
    expect(gated.card.lean).toEqual([{ kind: "text", text: "A, because it removes the wedge by construction." }]);
    expect(gated.typed).toEqual([]);
  });

  it("refuses a row typing a lean beside its page's marks", () => {
    const readPage: ReadPublishedPage = () =>
      ok('<p data-card="question">Which fix first?</p><p data-card="lean">A, by construction.</p>');
    const { question: _question, ...typesLean } = row();
    const error = unwrapErr(gate({ readPage, value: typesLean }));

    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toContain("types `lean` on its entry while the page marks its own");
  });

  it("refuses a row that is not an object", () => {
    const error = unwrapErr(gate({ value: [row()] }));

    expect(error.code).toBe("ROW_NOT_AN_OBJECT");
  });

  it("refuses a row missing the index fields, with the projection's own line", () => {
    const error = unwrapErr(gate({ value: { url: FIRST } }));

    expect(error).toMatchObject({
      code: "ROW_REFUSED",
      defects: ["--open-artifacts entry 0 needs a label, url, ask and landedIso, all strings"],
    });
  });

  it("refuses a row missing a card field, naming every key it lacks", () => {
    const error = unwrapErr(gate({ value: row({ over: { lean: undefined, whyYou: undefined } }) }));

    expect(error.code).toBe("ROW_REFUSED");
    expect(error.message).toBe("the row would render as a card the page gate refuses (1 defect(s))");
    expect(defectsOf({ error })[0]).toContain("it is missing whyYou, lean");
  });

  it("refuses an ask over the index schema's own cap, which no projection checks", () => {
    const ask = Array.from({ length: 31 }, (_, i) => `word${String(i)}`).join(" ");
    const error = unwrapErr(gate({ value: row({ over: { ask } }) }));

    expect(error).toMatchObject({
      code: "ROW_REFUSED",
      defects: [
        "ask: an open artifact's `ask` runs over the cap of 30 words above the fold. Cut it, or move the rest into the card's `detail` fold.",
      ],
    });
  });

  it("refuses a question over its word cap with the card gate's own line", () => {
    const question = `${Array.from({ length: 31 }, (_, i) => `word${String(i)}`).join(" ")}?`;
    const error = unwrapErr(gate({ value: row({ over: { question } }) }));

    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toBe(
      "question — 31 words above the fold, over the cap of 30. Cut the question down, or move the rest into a details fold inside the card.",
    );
  });

  it("refuses five options, the projection's cap", () => {
    const options = ["A", "B", "C", "D", "E"].map((letter) => ({
      letter,
      text: `Tell the supervisor ${letter} and the session does the ${letter} thing.`,
    }));
    const error = unwrapErr(gate({ value: row({ over: { options } }) }));

    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toContain("carries 5 options, over the cap of 4");
  });

  it("refuses a page with no local copy, naming the publish verb", () => {
    const error = unwrapErr(
      gate({ value: row({ url: "https://claude.ai/code/artifact/aaaaaaaa-0000-0000-0000-000000000000" }) }),
    );

    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toContain("page publish");
  });

  it("refuses a markdown document as the page", () => {
    const error = unwrapErr(gate({ value: row({ url: `file://${PAGES}/../handovers/some-row.md` }) }));

    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toContain("some-row.md");
  });

  it("refuses a landing instant in the future, since the card would claim an age it cannot have", () => {
    const error = unwrapErr(gate({ value: row({ over: { landedIso: "2026-09-17T00:00:00Z" } }) }));

    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toContain("is in the future");
  });

  it("refuses a page the owner's ruling already settled, naming the mark", () => {
    const ledgerText = ledgerLine({ outcome: "noted", url: FIRST });
    const error = unwrapErr(gate({ ledgerText, value: row() }));

    expect(error.code).toBe("ROW_ALREADY_RULED");
    expect(error.message).toContain("marks this page partly-ruled");
  });

  it("carries a detail fold through and refuses one that is a string", () => {
    const fold = {
      blocks: [{ content: [{ kind: "text", text: "One verified line." }], kind: "para" }],
      summary: "what",
    };
    expect(unwrap(gate({ value: row({ over: { detail: fold } }) })).card.detail).toEqual(fold);

    const error = unwrapErr(gate({ value: row({ over: { detail: "a flat string" } }) }));
    expect(error.code).toBe("ROW_REFUSED");
    expect(defectsOf({ error })[0]).toContain("is not a fold");
  });
});

describe("placeOpenPageRow", () => {
  it("appends at the end, leaving every other row as it was", () => {
    const first = row({ url: FIRST });
    const second = row({ url: SECOND, over: { readiness: { state: "ready" }, previousUrl: null } });
    const placed = unwrap(
      placeOpenPageRow({ document: [first], nowIso: NOW, replace: false, row: second, url: SECOND }),
    );

    expect(placed.action).toBe("appended");
    expect(placed.position).toBe(2);
    expect(placed.document).toEqual([first, second]);
  });

  it("refuses a url a row already names, giving its position", () => {
    const error = unwrapErr(
      placeOpenPageRow({
        document: [row({ url: SECOND }), row()],
        nowIso: NOW,
        replace: false,
        row: row(),
        url: FIRST,
      }),
    );

    expect(error.code).toBe("DUPLICATE_URL");
    expect(error.message).toBe(`row 2 already names ${FIRST} — pass --replace to swap it in place`);
  });

  it("swaps the row in place under --replace, keeping its position", () => {
    const fresh = row({ over: { lean: "B, on reflection." } });
    const placed = unwrap(
      placeOpenPageRow({ document: [row({ url: SECOND }), row()], nowIso: NOW, replace: true, row: fresh, url: FIRST }),
    );

    expect(placed.action).toBe("replaced");
    expect(placed.position).toBe(2);
    expect(placed.document).toEqual([row({ url: SECOND }), fresh]);
  });

  it("refuses the row that would carry the index past its cap", () => {
    const full = Array.from({ length: OPEN_ARTIFACTS_MAX_ITEMS }, (_, i) =>
      row({ url: `file://${PAGES}/p${String(i)}/index.html` }),
    );
    const error = unwrapErr(placeOpenPageRow({ document: full, nowIso: NOW, replace: false, row: row(), url: FIRST }));

    expect(error).toMatchObject({ already: false, code: "OVER_CAP", rows: OPEN_ARTIFACTS_MAX_ITEMS + 1 });
    expect(error.message).toBe(
      `the edit would make ${String(OPEN_ARTIFACTS_MAX_ITEMS + 1)} rows, over the cap of ` +
        `${String(OPEN_ARTIFACTS_MAX_ITEMS)} the render refuses — settle or drop a page before adding one`,
    );
  });

  it("refuses a REPLACE into a document already over the cap, which the render refuses whole", () => {
    const over = Array.from({ length: OPEN_ARTIFACTS_MAX_ITEMS + 1 }, (_, i) =>
      row({ url: `file://${PAGES}/p${String(i)}/index.html` }),
    );
    const url = `file://${PAGES}/p3/index.html`;
    const error = unwrapErr(placeOpenPageRow({ document: over, nowIso: NOW, replace: true, row: row({ url }), url }));

    expect(error).toMatchObject({ already: true, code: "OVER_CAP", rows: OPEN_ARTIFACTS_MAX_ITEMS + 1 });
    expect(error.message).toBe(
      `the document already carries ${String(OPEN_ARTIFACTS_MAX_ITEMS + 1)} rows, over the cap of ` +
        `${String(OPEN_ARTIFACTS_MAX_ITEMS)} the render refuses — settle or drop a page before editing this one`,
    );
  });

  it("refuses a document that is not an array", () => {
    const error = unwrapErr(
      placeOpenPageRow({ document: { rows: [] }, nowIso: NOW, replace: false, row: row(), url: FIRST }),
    );

    expect(error.code).toBe("DOCUMENT_NOT_AN_ARRAY");
  });

  it("refuses a document whose other row the render could not read, so the file it writes is never one the render refuses", () => {
    const error = unwrapErr(
      placeOpenPageRow({ document: [{ label: "no url" }], nowIso: NOW, replace: false, row: row(), url: FIRST }),
    );

    expect(error).toMatchObject({
      code: "DOCUMENT_REFUSED",
      defects: ["--open-artifacts entry 0 needs a label, url, ask and landedIso, all strings"],
    });
  });
});

describe("otherRowRefusals", () => {
  it("reports what --open-page-cards would refuse in the rows other than the one placed", () => {
    const document = [row(), row({ url: SECOND, over: { lean: undefined } })];
    const lines = otherRowRefusals({
      document,
      ledgerText: "",
      nowIso: NOW,
      pagesDirectory: PAGES,
      readPage: UNMARKED,
      url: FIRST,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("it is missing lean");
  });

  it("is empty when every other row projects to a card", () => {
    const document = [row(), row({ url: SECOND })];

    expect(
      otherRowRefusals({
        document,
        ledgerText: "",
        nowIso: NOW,
        pagesDirectory: PAGES,
        readPage: UNMARKED,
        url: FIRST,
      }),
    ).toEqual([]);
  });
});
