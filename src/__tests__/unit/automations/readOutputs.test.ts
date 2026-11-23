import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { definitionFileDates, notesByActor } from "../../../automations/readOutputs.js";
import { steersByRecipe } from "../../../automations/readSteers.js";
import { handRegisterPath } from "../../../hand/store.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { formRelayDraft } from "../../../talk/relayDraft.js";
import { claimTurn, markRegistered } from "../../../talk/relayStore.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home this test owns. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "automations-read-outputs-"));
  homes.push(home);
  return home;
}

describe("definitionFileDates", () => {
  it("knows neither instant for a row file that is not there", () => {
    expect(definitionFileDates({ file: "gone.json", home: freshHome() })).toEqual({ bornIso: null, editedIso: null });
  });

  it("reads when the row file was last written off the file itself", () => {
    const home = freshHome();
    const directory = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "row.json");
    writeFileSync(path, "{}");
    const edited = new Date("2026-10-02T09:00:00.000Z");
    utimesSync(path, edited, edited);

    expect(definitionFileDates({ file: "row.json", home }).editedIso).toBe("2026-10-02T09:00:00.000Z");
  });
});

describe("steersByRecipe", () => {
  it("reads and draws a turn receipted twice as one steer", () => {
    const home = freshHome();
    const draft = unwrap(
      formRelayDraft({
        about: "recipe:daily",
        heard: "",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "post the top three only",
        turnId: "a0000017-0000-4000-8000-000000000019",
        typed: false,
        wordsAlone: false,
      }),
    );
    const claimed = unwrap(claimTurn({ draft, home, nowIso: "2026-10-03T05:00:00.000Z" }));
    unwrap(markRegistered({ home, nowIso: "2026-10-03T05:00:01.000Z", record: claimed.record }));
    unwrap(markRegistered({ home, nowIso: "2026-10-03T05:00:02.000Z", record: claimed.record }));
    const issues: string[] = [];

    const { rows } = steersByRecipe({ home, issues });

    expect(rows.get("daily")!.map((steer) => steer.turnId)).toEqual(["a0000017-0000-4000-8000-000000000019"]);
  });

  it("keeps a board row that is not there apart from one that would not read", () => {
    const home = freshHome();
    const draft = unwrap(
      formRelayDraft({
        about: "recipe:daily",
        heard: "",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "post the top three only",
        turnId: "a0000017-0000-4000-8000-000000000019",
        typed: false,
        wordsAlone: false,
      }),
    );
    const claimed = unwrap(claimTurn({ draft, home, nowIso: "2026-10-03T05:00:00.000Z" }));
    unwrap(markRegistered({ home, nowIso: "2026-10-03T05:00:01.000Z", record: claimed.record }));

    const steer = steersByRecipe({ home, issues: [] }).rows.get("daily")![0]!;

    expect([steer.answer, steer.answerUnreadable, steer.boardRowMissing]).toEqual([null, null, true]);
  });

  it("says a relay line that would not read, rather than drawing the steers as complete", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).talkRelaysJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    appendFileSync(path, "{}\n");
    const issues: string[] = [];

    const { gap } = steersByRecipe({ home, issues });

    expect(gap).toBe("1 relay receipt line(s) would not read — a card may be missing what they held");
    expect(issues).toEqual([gap]);
  });

  it("names no gap when every relay line read", () => {
    const issues: string[] = [];

    expect(steersByRecipe({ home: freshHome(), issues }).gap).toBe(null);
    expect(issues).toEqual([]);
  });
});

describe("notesByActor", () => {
  it("says a register line that would not read, rather than drawing the notes as complete", () => {
    const home = freshHome();
    const path = handRegisterPath({ home });
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "not a row\n");
    const issues: string[] = [];

    const { gap } = notesByActor({ home, issues });

    expect(gap).toBe("1 floating-note line(s) would not read — a card may be missing what they held");
    expect(issues).toEqual([gap]);
  });
});
