/**
 * `standingOf` — the one place a board SECTION becomes the word the top band and the console both judge by.
 *
 * The partition exists because two different readings of "can anybody work this" had already been built from
 * `ready` alone, pointing opposite ways. MEASURED on one tick: the reconciliation
 * reported five top rows with nobody on them while recording every one of the five as `"ready": false` in
 * its own document, so nobody COULD be on any of them (check it stays fixed with
 * `slopweaver handover reconcile --json | jq '[.starving[] | {id, standing}]'`, every entry `ready`, and see
 * `src/handover/reconcile.ts`'s header for the anchor) — while adding `ready` to
 * the band's own filter would have driven `aligned` to zero for ever, because `RUN NOW` and `IN FLIGHT` are
 * mutually exclusive by construction (`src/supervisor/outcomes/coverage.ts`'s `belongs` carries that half).
 *
 * So what is pinned here is the mapping itself. `EXPECTED` is a `Record` over the whole `BoardSection` union
 * rather than a list, which is the point: a section added to the union and forgotten here fails to COMPILE,
 * where a list would simply have stopped covering it and stayed green.
 */
import { describe, expect, it } from "vitest";

import { type BoardSection } from "../../../handover/boardTypes.js";
import { type RowStanding, standingOf } from "../../../handover/rowStanding.js";

/** Every declared section and the standing it must produce, exhaustive by the compiler. */
const EXPECTED: Record<BoardSection, RowStanding> = {
  "AWAITING SHIP": "blocked",
  "CLOSED — NOT SHIPPED": "blocked",
  CONTRADICTION: "blocked",
  DONE: "blocked",
  "IN FLIGHT": "in-flight",
  "LOOKS SHIPPED": "blocked",
  "NOT YET": "blocked",
  PAUSED: "paused",
  "RUN NOW": "ready",
  "WAITING ON OWNER": "waiting-on-owner",
};

/** The sections, as the `Record`'s own keys — so the loop below cannot run over an empty list. */
const SECTIONS = Object.keys(EXPECTED) as readonly BoardSection[];

/** No hold at all — each case below switches on exactly the one it is about. */
const NO_HOLD = { disconnected: false, repoless: false, superseded: false, trunkMoved: false } as const;

describe("standingOf", () => {
  it("gives every declared section exactly the standing the board's own vocabulary implies", () => {
    expect(SECTIONS.length).toBe(10);

    expect(SECTIONS.map((section) => `${section}=${standingOf({ ...NO_HOLD, section })}`)).toEqual(
      SECTIONS.map((section) => `${section}=${EXPECTED[section]}`),
    );
  });

  it("calls only RUN NOW ready, so nothing else can be counted as work somebody may pick up", () => {
    expect(SECTIONS.filter((section) => standingOf({ ...NO_HOLD, section }) === "ready")).toEqual(["RUN NOW"]);
  });

  it("makes a superseded row blocked even when its own section says RUN NOW", () => {
    expect(standingOf({ ...NO_HOLD, section: "RUN NOW", superseded: true })).toBe("blocked");
  });

  it("makes a superseded IN FLIGHT row blocked too, so a retired chair cannot hold a top-band place", () => {
    expect(standingOf({ ...NO_HOLD, section: "IN FLIGHT", superseded: true })).toBe("blocked");
  });
});

describe("standingOf — a row naming no repo", () => {
  it("holds a repoless RUN NOW row as blocked, because cmux spawn refuses to seat it", () => {
    expect(standingOf({ ...NO_HOLD, repoless: true, section: "RUN NOW" })).toBe("blocked");
  });

  it("leaves a repoless IN FLIGHT row in flight, because its run is already open", () => {
    expect(standingOf({ ...NO_HOLD, repoless: true, section: "IN FLIGHT" })).toBe("in-flight");
  });

  it("changes no section but RUN NOW", () => {
    expect(SECTIONS.length).toBe(10);

    expect(
      SECTIONS.filter(
        (section) => standingOf({ ...NO_HOLD, repoless: true, section }) !== standingOf({ ...NO_HOLD, section }),
      ),
    ).toEqual(["RUN NOW"]);
  });
});

describe("standingOf — a ready finding the trunk has moved under", () => {
  it("holds a trunk-moved RUN NOW row as blocked, so no seat is spent finding the trunk already answered it", () => {
    expect(standingOf({ ...NO_HOLD, section: "RUN NOW", trunkMoved: true })).toBe("blocked");
  });

  it("changes no section but RUN NOW", () => {
    expect(SECTIONS.length).toBe(10);

    expect(
      SECTIONS.filter(
        (section) => standingOf({ ...NO_HOLD, section, trunkMoved: true }) !== standingOf({ ...NO_HOLD, section }),
      ),
    ).toEqual(["RUN NOW"]);
  });
});

describe("standingOf — a row needing an integration this install is not connected to", () => {
  it("holds a disconnected RUN NOW row as blocked, so no seat is spent on work whose every read would fail", () => {
    expect(standingOf({ ...NO_HOLD, disconnected: true, section: "RUN NOW" })).toBe("blocked");
  });

  it("changes no section but RUN NOW", () => {
    expect(SECTIONS.length).toBe(10);

    expect(
      SECTIONS.filter(
        (section) => standingOf({ ...NO_HOLD, disconnected: true, section }) !== standingOf({ ...NO_HOLD, section }),
      ),
    ).toEqual(["RUN NOW"]);
  });
});
