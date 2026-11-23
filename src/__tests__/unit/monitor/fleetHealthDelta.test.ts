/**
 * What changed since the last fleet-health note, whether it is worth a note now, and the lines behind the note's
 * disclosure — so ten identical notes never go up in one morning.
 */
import { describe, expect, it } from "vitest";

import { DETAIL_LINE_CAP, DETAILS_MAX, detailActMarker, detailEntry } from "../../../hand/details.js";
import {
  deltaClause,
  detailsOnTheNote,
  type FailingRow,
  fleetHealthDelta,
  fleetHealthLines,
  fleetHealthPacing,
  inWakingHours,
  isNews,
} from "../../../monitor/fleetHealthDelta.js";
import { rowFatesOf } from "../../../monitor/fleetHealthFate.js";
import type { FleetHealthDelta, FleetHealthShown } from "../../../monitor/types.js";

/** 09:37 in Melbourne (AEST, +10), inside the owner's waking hours. */
const MORNING = "2026-09-29T23:37:00.000Z";

/**
 * A remembered note.
 *
 * @param broken the rows it showed failing
 * @param shownIso when it went up
 * @param botDown whether it showed the listener off the air
 * @param signals the job signals it showed tripped
 * @param yours the rows it gave a button, as `<recipe id> <card id>`
 * @returns the memory
 */
function shown({
  broken = ["a", "b"],
  shownIso = "2026-09-29T23:27:00.000Z",
  botDown = false,
  signals = ["syncs"],
  yours = [],
}: {
  broken?: readonly string[];
  shownIso?: string;
  botDown?: boolean;
  signals?: readonly string[];
  yours?: readonly string[];
}): FleetHealthShown {
  return { botDown, broken, shownIso, signals, yours };
}

/** The delta for no change at all. */
const QUIET: FleetHealthDelta = {
  bot: "up",
  handMoved: [],
  newlyFailing: [],
  recovered: [],
  stillFailing: ["a"],
  tripped: [],
  untripped: [],
};

describe("fleetHealthDelta", () => {
  it("files each row failing now as new or still failing, and each gone one as recovered", () => {
    expect(
      fleetHealthDelta({
        botDown: false,
        broken: ["c", "a"],
        noteUp: false,
        shown: shown({}),
        signals: ["syncs"],
        yours: [],
      }),
    ).toEqual({
      bot: "up",
      handMoved: [],
      newlyFailing: ["c"],
      recovered: ["b"],
      stillFailing: ["a"],
      tripped: [],
      untripped: [],
    });
  });

  it("files every row and signal as new when no note is remembered", () => {
    expect(
      fleetHealthDelta({
        botDown: true,
        broken: ["b", "a"],
        noteUp: false,
        shown: undefined,
        signals: ["syncs", "deaths"],
        yours: [],
      }),
    ).toEqual({
      bot: "down",
      handMoved: [],
      newlyFailing: ["a", "b"],
      recovered: [],
      stillFailing: [],
      tripped: ["syncs", "deaths"],
      untripped: [],
    });
  });

  it("files a job signal tripping or clearing against the last note", () => {
    expect(
      fleetHealthDelta({
        botDown: false,
        broken: ["a", "b"],
        noteUp: false,
        shown: shown({}),
        signals: ["deaths"],
        yours: [],
      }),
    ).toEqual({
      bot: "up",
      handMoved: [],
      newlyFailing: [],
      recovered: [],
      stillFailing: ["a", "b"],
      tripped: ["deaths"],
      untripped: ["syncs"],
    });
  });

  it("reads the listener against the last note: down, still down, back or up", () => {
    const bots = [
      { botDown: true, wasDown: false },
      { botDown: true, wasDown: true },
      { botDown: false, wasDown: true },
      { botDown: false, wasDown: false },
    ].map(
      ({ botDown, wasDown }) =>
        fleetHealthDelta({
          botDown,
          broken: [],
          noteUp: false,
          shown: shown({ botDown: wasDown }),
          signals: [],
          yours: [],
        }).bot,
    );
    expect(bots).toEqual(["down", "still-down", "back", "up"]);
  });

  it("moves a row whose card for the owner arrived or was replaced, and one whose card closed only while the note is up", () => {
    const last = shown({ broken: ["a", "b", "c"], yours: ["a mon-signin-go-xero-com", "c card-c"] });
    const moved = [false, true].map(
      (noteUp) =>
        fleetHealthDelta({
          botDown: false,
          broken: ["a", "b", "c"],
          noteUp,
          shown: last,
          signals: ["syncs"],
          yours: ["a mon-signin-go-xero-com.2", "b card-b"],
        }).handMoved,
    );
    expect(moved).toEqual([
      ["a", "b"],
      ["a", "b", "c"],
    ]);
  });

  it("moves nothing when the same cards wait on the same rows", () => {
    expect(
      fleetHealthDelta({
        botDown: false,
        broken: ["a", "b"],
        noteUp: true,
        shown: shown({ yours: ["a card-a"] }),
        signals: ["syncs"],
        yours: ["a card-a"],
      }).handMoved,
    ).toEqual([]);
  });
});

describe("isNews", () => {
  it("counts a new failure, a recovery, a signal and the bot moving, and never the same rows failing again", () => {
    expect(
      [
        QUIET,
        { ...QUIET, newlyFailing: ["x"] },
        { ...QUIET, recovered: ["x"] },
        { ...QUIET, tripped: ["deaths"] },
        { ...QUIET, untripped: ["deaths"] },
        { ...QUIET, bot: "down" as const },
        { ...QUIET, bot: "back" as const },
        { ...QUIET, bot: "still-down" as const },
        { ...QUIET, handMoved: ["a"] },
      ].map((delta) => isNews({ delta })),
    ).toEqual([false, true, true, true, true, true, true, false, true]);
  });

  it("paces a card for the owner moving as bad news", () => {
    expect(fleetHealthPacing({ delta: { ...QUIET, handMoved: ["a"] }, nowIso: MORNING, shown: shown({}) })).toEqual({
      kind: "hold",
      why: "bad news waits until 23:57Z, 30 min after the last note",
    });
  });

  it("paces a signal tripping as bad news and one clearing as good", () => {
    expect(
      [
        { ...QUIET, tripped: ["deaths"] },
        { ...QUIET, untripped: ["deaths"] },
      ].map((delta) => fleetHealthPacing({ delta, nowIso: MORNING, shown: shown({}) })),
    ).toEqual([
      { kind: "hold", why: "bad news waits until 23:57Z, 30 min after the last note" },
      { kind: "hold", why: "good news waits until 01:27Z, 120 min after the last note" },
    ]);
  });
});

describe("fleetHealthPacing", () => {
  it("holds a pass with nothing new, naming the note it matches", () => {
    expect(fleetHealthPacing({ delta: QUIET, nowIso: MORNING, shown: shown({}) })).toEqual({
      kind: "hold",
      why: "nothing changed since the note at 23:27Z — the same rows are failing",
    });
  });

  it("holds news outside the owner's waking hours, whatever the spacing", () => {
    expect(
      fleetHealthPacing({
        delta: { ...QUIET, newlyFailing: ["x"] },
        nowIso: "2026-09-29T15:37:00.000Z",
        shown: undefined,
      }),
    ).toEqual({ kind: "hold", why: "news waits for the morning — notes go up 7:00–22:00 Australia/Melbourne" });
  });

  it("shows the first news of a morning with no remembered note at once", () => {
    expect(fleetHealthPacing({ delta: { ...QUIET, newlyFailing: ["x"] }, nowIso: MORNING, shown: undefined })).toEqual({
      kind: "show",
    });
  });

  it("spaces bad news 30 minutes after the last note, and shows it on the minute", () => {
    const bad = { ...QUIET, newlyFailing: ["x"] };
    expect(
      fleetHealthPacing({ delta: bad, nowIso: MORNING, shown: shown({ shownIso: "2026-09-29T23:10:00.000Z" }) }),
    ).toEqual({
      kind: "hold",
      why: "bad news waits until 23:40Z, 30 min after the last note",
    });
    expect(
      fleetHealthPacing({ delta: bad, nowIso: MORNING, shown: shown({ shownIso: "2026-09-29T23:07:00.000Z" }) }),
    ).toEqual({
      kind: "show",
    });
  });

  it("spaces good news alone two hours after the last note", () => {
    const good = { ...QUIET, recovered: ["b"] };
    expect(
      fleetHealthPacing({ delta: good, nowIso: MORNING, shown: shown({ shownIso: "2026-09-29T22:00:00.000Z" }) }),
    ).toEqual({
      kind: "hold",
      why: "good news waits until 00:00Z, 120 min after the last note",
    });
    expect(
      fleetHealthPacing({ delta: good, nowIso: MORNING, shown: shown({ shownIso: "2026-09-29T21:30:00.000Z" }) }),
    ).toEqual({
      kind: "show",
    });
  });
});

describe("inWakingHours", () => {
  it("opens at 07:00 and closes at 22:00 in Melbourne, across the daylight-saving change", () => {
    expect(
      [
        "2026-09-29T20:59:00.000Z",
        "2026-09-29T21:00:00.000Z",
        "2026-09-30T11:59:00.000Z",
        "2026-09-30T12:00:00.000Z",
        // AEDT (+11) once daylight saving starts: 07:00 local falls on the previous UTC day.
        "2026-10-05T19:59:00.000Z",
        "2026-10-05T20:00:00.000Z",
      ].map((nowIso) => inWakingHours({ nowIso })),
    ).toEqual([false, true, true, false, false, true]);
  });
});

describe("deltaClause", () => {
  it("counts each change, leads with deaths tripping, and says nothing when neither moved", () => {
    expect(deltaClause({ delta: { ...QUIET, newlyFailing: ["x"], recovered: ["y", "z"] } })).toBe(
      "1 scheduled job newly failing, 2 recovered, 1 still failing",
    );
    expect(deltaClause({ delta: { ...QUIET, newlyFailing: ["x"], stillFailing: [], tripped: ["deaths"] } })).toBe(
      "syncs are dying mid-run, 1 scheduled job newly failing",
    );
    expect(deltaClause({ delta: { ...QUIET, bot: "back", stillFailing: [] } })).toBe("");
  });
});

describe("fleetHealthLines", () => {
  /** 3h37m after the rows' own failure, so each reads `3h ago`. */
  const PASS = "2026-09-29T15:37:00.000Z";

  /**
   * A failing row.
   *
   * @param recipeId the row
   * @param state whether its newest run failed
   * @param lastFailedIso when it last failed
   * @returns the row, failed twice
   */
  function row({
    recipeId,
    state = "failing",
    lastFailedIso = "2026-09-29T12:00:00.000Z",
  }: {
    recipeId: string;
    state?: FailingRow["state"];
    lastFailedIso?: string;
  }): FailingRow {
    return { failures: 2, lastFailedIso, recipeId, state, why: "exit 1" };
  }

  it("names the bot, then each new, still-failing, recovered and earlier-failed row, with its age and why", () => {
    expect(
      fleetHealthLines({
        botLine: "the listener has been off the air for 3h",
        delta: {
          ...QUIET,
          bot: "still-down",
          handMoved: [],
          newlyFailing: ["n"],
          recovered: ["r"],
          stillFailing: ["s"],
        },
        fates: new Map(),
        nowIso: PASS,
        rows: [
          row({ recipeId: "n" }),
          row({ recipeId: "s" }),
          row({ recipeId: "r", state: "recovered" }),
          row({ recipeId: "p", state: "recovered" }),
        ],
      }),
    ).toEqual([
      "STILL the bot off Slack — the listener has been off the air for 3h",
      "NEW   n — 3h ago, 2× in 24h: exit 1",
      "STILL s — 3h ago, 2× in 24h: exit 1",
      "FIXED r — last failed 3h ago, its newest run succeeded",
      "PAST  p — 3h ago, 2× in 24h: exit 1; ran clean since",
    ]);
  });

  it("leads each group with its newest failure, timed in minutes under an hour", () => {
    expect(
      fleetHealthLines({
        botLine: undefined,
        delta: { ...QUIET, newlyFailing: ["a-old", "b-new"], stillFailing: [] },
        fates: new Map(),
        nowIso: PASS,
        rows: [row({ lastFailedIso: "2026-09-29T15:00:00.000Z", recipeId: "b-new" }), row({ recipeId: "a-old" })],
      }),
    ).toEqual(["NEW   b-new — 37m ago, 2× in 24h: exit 1", "NEW   a-old — 3h ago, 2× in 24h: exit 1"]);
  });

  it("says the bot came back, and names a row whose failure left the window", () => {
    expect(
      fleetHealthLines({
        botLine: undefined,
        delta: { ...QUIET, bot: "back", recovered: ["gone"], stillFailing: [] },
        fates: new Map(),
        nowIso: PASS,
        rows: [],
      }),
    ).toEqual(["BACK  the bot is on Slack again", "FIXED gone — no failure left in the last 24h"]);
  });

  it("keeps every line uncut, however many rows fail", () => {
    const ids = Array.from({ length: 15 }, (_, n) => `row-${String(n).padStart(2, "0")}-${"x".repeat(200)}`);
    const lines = fleetHealthLines({
      botLine: undefined,
      delta: { ...QUIET, newlyFailing: ids, stillFailing: [] },
      fates: new Map(),
      nowIso: PASS,
      rows: ids.map((recipeId) => row({ recipeId })),
    });
    expect(lines.length).toBe(15);
    expect(lines[0]).toBe(`NEW   row-00-${"x".repeat(200)} — 3h ago, 2× in 24h: exit 1`);
  });

  it("says per row whether it needs the owner — their card, where, and its marker — or what the fleet is doing instead", () => {
    const fates = rowFatesOf({
      failing: ["trelica", "gcloud", "xero-done", "hex-held", "vanta", "clerk", "jam"],
      fleetPresses: new Map(),
      held: new Set(["hex-held", "vanta", "clerk"]),
      repairing: new Map([["clerk", "recipe-repair-clerk-294-1"]]),
      signedIn: new Map([
        ["xero-done", "go.xero.com"],
        ["hex-held", "app.hex.tech"],
      ]),
      yours: new Map([
        [
          "trelica",
          {
            act: "sign in to acme.trelica.app",
            card: "mon-signin-acme-trelica-app.2",
            more: 0,
            place: { kind: "work-chrome" as const },
          },
        ],
        [
          "gcloud",
          {
            act: "Sign in to Google Cloud from a plain terminal of yours",
            card: "adc-signin-gcloud-row",
            more: 1,
            place: { kind: "terminal" as const },
          },
        ],
      ]),
    });
    const ids = ["trelica", "gcloud", "xero-done", "hex-held", "vanta", "clerk", "jam"];
    expect(
      fleetHealthLines({
        botLine: undefined,
        delta: { ...QUIET, newlyFailing: [], stillFailing: ids.toSorted() },
        fates,
        nowIso: PASS,
        rows: ids.map((recipeId) => row({ recipeId })),
      }),
    ).toEqual([
      "STILL trelica — 3h ago, 2× in 24h: Needs you — sign in to acme.trelica.app, in your work Chrome [hand:mon-signin-acme-trelica-app.2]",
      "STILL gcloud — 3h ago, 2× in 24h: Needs you — Sign in to Google Cloud from a plain terminal of yours, in a terminal on this Mac, outside Chrome (+1 more open) [hand:adc-signin-gcloud-row]",
      "STILL xero-done — 3h ago, 2× in 24h: Nothing for you — you pressed Done on its go.xero.com sign-in, so its next attempt says whether it got past",
      "STILL hex-held — 3h ago, 2× in 24h: Nothing for you — you pressed Done on its app.hex.tech sign-in; it stays paused on its failure finding until that is settled, then its next attempt says whether it got past",
      "STILL vanta — 3h ago, 2× in 24h: Nothing for you — paused on its failure finding until a fix lands; exit 1",
      "STILL clerk — 3h ago, 2× in 24h: Nothing for you — seat recipe-repair-clerk-294-1 is repairing it; exit 1",
      "STILL jam — 3h ago, 2× in 24h: Nothing for you — its next slot runs it again; exit 1",
    ]);
  });
});

describe("detailsOnTheNote", () => {
  it("fits every line inside the register's caps, pointing at the verb that prints every one", () => {
    const lines = Array.from({ length: 15 }, (_, n) => `NEW   row-${String(n).padStart(2, "0")}-${"x".repeat(200)}`);
    const onTheNote = detailsOnTheNote({ lines });
    expect(onTheNote.length).toBe(DETAILS_MAX);
    expect(onTheNote.filter((line) => line.length > DETAIL_LINE_CAP)).toEqual([]);
    expect(onTheNote.at(-1)).toBe("+4 more — slopweaver monitor check --only fleet-unhealthy prints every one");
  });

  it("marks a cut line with an ellipsis at a word boundary, so a reason cut short never reads whole", () => {
    const why = Array.from({ length: 80 }, (_, n) => `word${String(n)},`).join(" ");
    const [cut] = detailsOnTheNote({ lines: [`STILL resync — 3h ago, once: ${why}`] });
    expect(cut!.length).toBeLessThanOrEqual(DETAIL_LINE_CAP);
    // 29 characters of head, then ten 7-character words and twenty-seven 8-character ones fill the 319 before the
    // mark; the trailing comma goes too, since `word36,…` reads as a list still running.
    expect(cut!.endsWith(" word36…")).toBe(true);
    expect(cut!.startsWith("STILL resync — 3h ago, once: word0, word1,")).toBe(true);
  });

  it("cuts a long needs-you line before its marker, so the card it names survives the cap whole", () => {
    const marker = detailActMarker({ id: "adc-signin-a-board-row" });
    const [cut] = detailsOnTheNote({
      lines: [`NEW   gcloud — 3h ago, once: Needs you — ${"long words ".repeat(40)}${marker}`],
    });
    expect(cut!.length).toBeLessThanOrEqual(DETAIL_LINE_CAP);
    expect(cut!.endsWith(`…${marker}`)).toBe(true);
    expect(detailEntry({ line: cut! }).act).toBe("adc-signin-a-board-row");
  });

  it("keeps a trailing line past the cut, after the `+N more` line, so a long fleet never hides it", () => {
    const lines = Array.from(
      { length: 15 },
      (_, n) => `NEW   row-${String(n).padStart(2, "0")} — 3h ago, once: exit 1`,
    );
    const onTheNote = detailsOnTheNote({ lines, trailing: ["INFO  a footnote"] });
    expect(onTheNote).toEqual([
      ...lines.slice(0, 10),
      "+5 more — slopweaver monitor check --only fleet-unhealthy prints every one",
      "INFO  a footnote",
    ]);
  });

  it("appends a trailing line uncut when everything fits", () => {
    expect(detailsOnTheNote({ lines: ["NEW   a — 3h ago, once: exit 1"], trailing: ["INFO  a footnote"] })).toEqual([
      "NEW   a — 3h ago, once: exit 1",
      "INFO  a footnote",
    ]);
  });

  it("carries a list that fits unchanged", () => {
    expect(detailsOnTheNote({ lines: ["NEW   a — 3h ago, once: exit 1"] })).toEqual(["NEW   a — 3h ago, once: exit 1"]);
  });
});
