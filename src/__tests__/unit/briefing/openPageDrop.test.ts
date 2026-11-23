/**
 * `briefing card --drop`'s pure core: one row out by exact url, every other row and key untouched, and only
 * when the owner's lock-in ruling or a finished board row publishing the page settles it.
 */
import { describe, expect, it } from "vitest";

import { dropEvidenceText, dropOpenPageRow, type SettlingRowReading } from "../../../briefing/openPageDrop.js";
import { OpenPageDropErrors } from "../../../briefing/openPageDropErrors.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { boardRow, DOCUMENT, LOCAL, lockIn, NOW, OTHER, row, settledAsk, TRELICA } from "./openPageDropFixtures.js";

describe("dropOpenPageRow — the lock-in ledger", () => {
  it("drops the one row an approved ruling settled, keeping every other row, key and the order", () => {
    const ledgerText = lockIn({ identity: `artifact:${TRELICA.slice(-36)}`, outcome: "approved-as-proposed" });
    const dropped = unwrap(
      dropOpenPageRow({ document: DOCUMENT, ledgerText, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(dropped.document).toEqual([DOCUMENT[0], DOCUMENT[2]]);
    expect(dropped.position).toBe(2);
    expect(dropped.rows).toBe(2);
    expect(dropped.evidence).toEqual({
      key: "artifact:3eb11d97-9d46-46f6-ae79-b85e441e86b8",
      kind: "lock-in",
      outcome: "approved-as-proposed",
      resolvedAtIso: "2026-09-12T21:27:58.761Z",
    });
  });

  it("still settles on the real ledger row's malformed againstWhenIso, which resolutionHolds would misread", () => {
    const ledgerText = lockIn({
      againstWhenIso: "2026-09-12T20:0xZ",
      identity: "artifact:3eb11d97-9d46-46f6-ae79-b85e441e86b8",
      outcome: "approved-as-proposed",
    });
    const dropped = unwrap(
      dropOpenPageRow({ document: DOCUMENT, ledgerText, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(dropped.position).toBe(2);
    expect(dropped.evidence.kind).toBe("lock-in");
  });

  it("finds a ruling under the short artifact key and under a local page's page:<slug> key", () => {
    const short = unwrap(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: lockIn({ identity: "artifact:3eb11d97", outcome: "rejected" }),
        nowIso: NOW,
        settledBy: undefined,
        url: TRELICA,
      }),
    );
    const local = unwrap(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: lockIn({ identity: "page:worker-card-clock", outcome: "dropped" }),
        nowIso: NOW,
        settledBy: undefined,
        url: LOCAL,
      }),
    );

    expect(short.evidence).toMatchObject({ key: "artifact:3eb11d97", outcome: "rejected" });
    expect(local.evidence).toMatchObject({ key: "page:worker-card-clock", outcome: "dropped" });
    expect(local.position).toBe(3);
  });

  it("drops on an edited ruling recorded against the url itself", () => {
    const dropped = unwrap(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: lockIn({ identity: OTHER, outcome: "edited" }),
        nowIso: NOW,
        settledBy: undefined,
        url: OTHER,
      }),
    );

    expect(dropped.evidence).toMatchObject({ key: OTHER, outcome: "edited" });
    expect(dropped.document).toEqual([DOCUMENT[1], DOCUMENT[2]]);
  });

  it("refuses a page whose latest word is noted or deferred, naming each", () => {
    const noted = unwrapErr(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: lockIn({ identity: TRELICA, outcome: "noted", verb: "note" }),
        nowIso: NOW,
        settledBy: undefined,
        url: TRELICA,
      }),
    );
    const deferred = unwrapErr(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: [
          lockIn({ identity: "artifact:3eb11d97", outcome: "approved-as-proposed" }),
          lockIn({
            identity: "artifact:3eb11d97",
            outcome: "deferred",
            over: { deferredUntilIso: "2026-12-01T00:00:00Z" },
            verb: "defer",
          }),
        ].join("\n"),
        nowIso: NOW,
        settledBy: undefined,
        url: TRELICA,
      }),
    );

    expect(noted).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: [`lock-in: the owner's latest word under ${TRELICA} is noted, which does not settle a page`],
        url: TRELICA,
      }),
    );
    expect(deferred.code).toBe("UNSETTLED");
    expect(deferred).toMatchObject({
      reasons: ["lock-in: the owner's latest word under artifact:3eb11d97 is deferred, which does not settle a page"],
    });
  });

  it("refuses a page the owner deferred under its url after approving it under the short id", () => {
    const ledgerText = [
      lockIn({
        identity: "artifact:3eb11d97",
        outcome: "approved-as-proposed",
        over: { tsIso: "2026-09-12T21:00:00Z" },
      }),
      lockIn({
        identity: TRELICA,
        outcome: "deferred",
        over: { deferredUntilIso: "2026-12-01T00:00:00Z", tsIso: "2026-09-12T22:00:00Z" },
        verb: "defer",
      }),
    ].join("\n");
    const error = unwrapErr(
      dropOpenPageRow({ document: DOCUMENT, ledgerText, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(error).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: [`lock-in: the owner's latest word under ${TRELICA} is deferred, which does not settle a page`],
        url: TRELICA,
      }),
    );
  });

  it("takes the owner's last word in file order when two aliases carry the same instant", () => {
    const at = { tsIso: "2026-09-12T22:00:00.000Z" };
    const ledgerText = [
      lockIn({ identity: TRELICA, outcome: "approved-as-proposed", over: at }),
      lockIn({
        identity: "artifact:3eb11d97",
        outcome: "deferred",
        over: { ...at, deferredUntilIso: "2026-12-01T00:00:00Z" },
        verb: "defer",
      }),
    ].join("\n");
    const error = unwrapErr(
      dropOpenPageRow({ document: DOCUMENT, ledgerText, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(error).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: ["lock-in: the owner's latest word under artifact:3eb11d97 is deferred, which does not settle a page"],
        url: TRELICA,
      }),
    );
  });

  it("drops on an approval under one alias that follows a deferral under another", () => {
    const ledgerText = [
      lockIn({
        identity: TRELICA,
        outcome: "deferred",
        over: { deferredUntilIso: "2026-12-01T00:00:00Z", tsIso: "2026-09-12T21:00:00Z" },
        verb: "defer",
      }),
      lockIn({
        identity: "artifact:3eb11d97",
        outcome: "approved-as-proposed",
        over: { tsIso: "2026-09-12T22:00:00Z" },
      }),
    ].join("\n");
    const dropped = unwrap(
      dropOpenPageRow({ document: DOCUMENT, ledgerText, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(dropped.evidence).toEqual({
      key: "artifact:3eb11d97",
      kind: "lock-in",
      outcome: "approved-as-proposed",
      resolvedAtIso: "2026-09-12T22:00:00Z",
    });
  });

  it("refuses when a later line naming the page does not decode, and ignores one naming another page", () => {
    const approved = lockIn({ identity: TRELICA, outcome: "approved-as-proposed" });
    const undecoded = ({ identity }: { identity: string }): string =>
      JSON.stringify({ identity, outcome: "deferred", schemaVersion: 1, tsIso: "2026-09-12T22:00:00Z", verb: "defer" });
    const run = ({ ledgerText }: { ledgerText: string }) =>
      dropOpenPageRow({ document: DOCUMENT, ledgerText, nowIso: NOW, settledBy: undefined, url: TRELICA });

    expect(unwrapErr(run({ ledgerText: [approved, undecoded({ identity: TRELICA })].join("\n") }))).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: [
          "lock-in: 1 ledger line(s) that may name this page did not decode, so the owner's last word is unknown",
        ],
        url: TRELICA,
      }),
    );
    expect(unwrap(run({ ledgerText: [approved, undecoded({ identity: OTHER })].join("\n") })).evidence.kind).toBe(
      "lock-in",
    );
  });

  it("refuses on an undecodable line under the short id of an uppercase artifact url, in any casing", () => {
    const upper = TRELICA.toUpperCase().replace("HTTPS://CLAUDE.AI/CODE/ARTIFACT/", "https://claude.ai/code/artifact/");
    const undecoded = JSON.stringify({
      identity: "artifact:3EB11D97",
      outcome: "deferred",
      schemaVersion: 1,
      tsIso: "2026-09-12T22:00:00Z",
      verb: "defer",
    });
    const error = unwrapErr(
      dropOpenPageRow({
        document: [row({ url: upper }), DOCUMENT[0]],
        ledgerText: undecoded,
        nowIso: NOW,
        settledBy: boardRow({ lines: settledAsk({ artifact: upper }) }),
        url: upper,
      }),
    );

    expect(error).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: [
          "lock-in: 1 ledger line(s) that may name this page did not decode, so the owner's last word is unknown",
        ],
        url: upper,
      }),
    );
  });

  it("refuses a page nothing is recorded against, naming every key it tried", () => {
    const error = unwrapErr(
      dropOpenPageRow({ document: DOCUMENT, ledgerText: "", nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(error).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: [
          `lock-in: no resolution is recorded under ${TRELICA}, artifact:3eb11d97-9d46-46f6-ae79-b85e441e86b8, artifact:3eb11d97`,
        ],
        url: TRELICA,
      }),
    );
  });
});

describe("dropOpenPageRow — the document", () => {
  const settles = lockIn({ identity: TRELICA, outcome: "approved-as-proposed" });

  it("refuses a url no row names exactly, a prefix included", () => {
    const error = unwrapErr(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: settles,
        nowIso: NOW,
        settledBy: undefined,
        url: TRELICA.slice(0, -1),
      }),
    );

    expect(error).toEqual(OpenPageDropErrors.urlNotFound({ rows: 3, url: TRELICA.slice(0, -1) }));
    expect(error.message).toBe(`none of the 3 row(s) names ${TRELICA.slice(0, -1)} exactly`);
  });

  it("refuses a url two rows name, listing both positions", () => {
    const document = [...DOCUMENT, row({ url: TRELICA })];
    const error = unwrapErr(
      dropOpenPageRow({ document, ledgerText: settles, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(error).toEqual(OpenPageDropErrors.urlDuplicated({ positions: [2, 4], url: TRELICA }));
  });

  it("refuses a document that is not an array", () => {
    const error = unwrapErr(
      dropOpenPageRow({ document: { rows: [] }, ledgerText: settles, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(error.code).toBe("DOCUMENT_NOT_AN_ARRAY");
  });

  it("refuses when the document left behind would not survive the render's index gate", () => {
    const document = [{ label: "no ask or landedIso", url: OTHER }, row({ url: TRELICA })];
    const error = unwrapErr(
      dropOpenPageRow({ document, ledgerText: settles, nowIso: NOW, settledBy: undefined, url: TRELICA }),
    );

    expect(error.code).toBe("DOCUMENT_REFUSED");
    expect(error).toMatchObject({
      defects: ["--open-artifacts entry 0 needs a label, url, ask and landedIso, all strings"],
    });
  });

  it("drops the only row, leaving an empty document", () => {
    const dropped = unwrap(
      dropOpenPageRow({
        document: [row({ url: TRELICA })],
        ledgerText: settles,
        nowIso: NOW,
        settledBy: undefined,
        url: TRELICA,
      }),
    );

    expect(dropped.document).toEqual([]);
    expect(dropped.rows).toBe(0);
    expect(dropped.position).toBe(1);
  });
});

describe("dropOpenPageRow — --settled-by <slug>", () => {
  /** Drop TRELICA from DOCUMENT with no ledger and this board row. */
  const drop = ({ settledBy }: { settledBy: SettlingRowReading }) =>
    dropOpenPageRow({ document: DOCUMENT, ledgerText: "", nowIso: NOW, settledBy, url: TRELICA });

  it("drops on a settled ask whose artifact: line is the url", () => {
    const dropped = unwrap(drop({ settledBy: boardRow({ lines: settledAsk({ artifact: TRELICA }) }) }));

    expect(dropped.evidence).toEqual({
      artifactFrom: "front-matter",
      kind: "board-row",
      settledBecause: "settlement: filed",
      slug: "the-row",
    });
    expect(dropped.document).toEqual([DOCUMENT[0], DOCUMENT[2]]);
  });

  it("refuses a settled row when a ledger line naming the page does not decode, the owner's last word unknown", () => {
    const undecoded = JSON.stringify({
      identity: TRELICA,
      outcome: "deferred",
      schemaVersion: 1,
      tsIso: "2026-09-12T22:00:00Z",
      verb: "defer",
    });
    const settledBy = boardRow({ lines: settledAsk({ artifact: TRELICA }) });

    expect(
      unwrapErr(dropOpenPageRow({ document: DOCUMENT, ledgerText: undecoded, nowIso: NOW, settledBy, url: TRELICA })),
    ).toEqual(
      OpenPageDropErrors.unsettled({
        reasons: [
          "lock-in: 1 ledger line(s) that may name this page did not decode, so the owner's last word is unknown",
        ],
        url: TRELICA,
      }),
    );
  });

  it("drops on a closed row whose artifact event is the url", () => {
    const events: RunEvent[] = [
      { atIso: "2026-09-12T20:00:00Z", kind: "artifact", url: TRELICA },
      { atIso: "2026-09-13T20:00:00Z", kind: "closed", residue: [], summary: "merged as #1398" },
    ];
    const dropped = unwrap(drop({ settledBy: boardRow({ events, lines: ["status: ready"] }) }));

    expect(dropped.evidence).toEqual({
      artifactFrom: "journal",
      kind: "board-row",
      settledBecause: "status done (from closed-event)",
      slug: "the-row",
    });
  });

  it("drops on a live row that carries a dated ruling", () => {
    const events: RunEvent[] = [
      { atIso: "2026-09-12T20:00:00Z", kind: "artifact", url: TRELICA },
      {
        anchor: "transcript:abc#def",
        atIso: "2026-09-14T08:00:00Z",
        decidedIso: "2026-09-13T22:00:00Z",
        kind: "ruling",
        ruling: "go with D",
      },
    ];
    const dropped = unwrap(drop({ settledBy: boardRow({ events, lines: ["status: ready"] }) }));

    expect(dropped.evidence).toMatchObject({ settledBecause: "a ruling decided 2026-09-13T22:00:00Z" });
  });

  it("refuses a live row whose only ruling's instant does not parse, since it carries no dated ruling", () => {
    const events: RunEvent[] = [
      { atIso: "2026-09-12T20:00:00Z", kind: "artifact", url: TRELICA },
      { anchor: "transcript:abc#def", atIso: "not-a-date", kind: "ruling", ruling: "go with D" },
    ];
    const error = unwrapErr(drop({ settledBy: boardRow({ events, lines: ["status: ready"] }) }));

    expect(error).toMatchObject({
      code: "UNSETTLED",
      reasons: [
        `lock-in: no resolution is recorded under ${TRELICA}, artifact:3eb11d97-9d46-46f6-ae79-b85e441e86b8, artifact:3eb11d97`,
        "--settled-by the-row: the row carries no settlement, no terminal status and no dated ruling",
      ],
    });
  });

  it("refuses a live, unruled row, carrying the ledger's reason beside the row's", () => {
    const events: RunEvent[] = [{ atIso: "2026-09-12T20:00:00Z", kind: "artifact", url: TRELICA }];
    const error = unwrapErr(drop({ settledBy: boardRow({ events, lines: ["status: ready"] }) }));

    expect(error).toMatchObject({
      code: "UNSETTLED",
      reasons: [
        `lock-in: no resolution is recorded under ${TRELICA}, artifact:3eb11d97-9d46-46f6-ae79-b85e441e86b8, artifact:3eb11d97`,
        "--settled-by the-row: the row carries no settlement, no terminal status and no dated ruling",
      ],
    });
  });

  it("refuses a settled row that publishes another url", () => {
    const error = unwrapErr(drop({ settledBy: boardRow({ lines: settledAsk({ artifact: OTHER }) }) }));

    expect(error).toMatchObject({
      reasons: [
        expect.stringContaining("lock-in: no resolution"),
        `--settled-by the-row: the row names ${TRELICA} neither in its artifact: line nor in an artifact event`,
      ],
    });
  });

  it("refuses a url that is no address, whether the row's null is the placeholder or quoted", () => {
    const errors = ["null", '"null"'].map((artifact) =>
      unwrapErr(
        dropOpenPageRow({
          document: [row({ url: "null" }), DOCUMENT[0]],
          ledgerText: "",
          nowIso: NOW,
          settledBy: boardRow({ lines: settledAsk({ artifact }) }),
          url: "null",
        }),
      ),
    );
    const refused = {
      code: "UNSETTLED",
      reasons: [
        expect.stringContaining("lock-in: no resolution"),
        "--settled-by the-row: null is not an address, so no row can have published it",
      ],
    };

    expect(errors).toMatchObject([refused, refused]);
  });

  it("refuses an unreadable row, saying why", () => {
    const error = unwrapErr(drop({ settledBy: { kind: "unreadable", slug: "gone", why: "no doc carries it" } }));

    expect(error).toMatchObject({
      reasons: [expect.stringContaining("lock-in"), "--settled-by gone: no doc carries it"],
    });
  });

  it("prefers a deciding lock-in ruling over the named row, even an unreadable one", () => {
    const dropped = unwrap(
      dropOpenPageRow({
        document: DOCUMENT,
        ledgerText: lockIn({ identity: TRELICA, outcome: "approved-as-proposed" }),
        nowIso: NOW,
        settledBy: { kind: "unreadable", slug: "gone", why: "no doc carries it" },
        url: TRELICA,
      }),
    );

    expect(dropped.evidence.kind).toBe("lock-in");
  });
});

describe("dropEvidenceText", () => {
  it("names the ledger key and outcome, or the board row and why it is over", () => {
    expect(
      dropEvidenceText({
        evidence: {
          key: "artifact:3eb11d97",
          kind: "lock-in",
          outcome: "approved-as-proposed",
          resolvedAtIso: "2026-09-12T21:27:58.761Z",
        },
      }),
    ).toBe("the owner's lock-in approved-as-proposed under artifact:3eb11d97 (2026-09-12T21:27:58.761Z)");
    expect(
      dropEvidenceText({
        evidence: { artifactFrom: "journal", kind: "board-row", settledBecause: "settlement: filed", slug: "the-row" },
      }),
    ).toBe("board row the-row (settlement: filed; its journal artifact names the page)");
  });
});
