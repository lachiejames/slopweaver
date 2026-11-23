/**
 * `prSubjectOn` — whether a `pr:` card is the owner's to land words on, judged by the landing reading in force when they spoke
 * and kept as a verdict once refused. Fixtures round-trip into a `mkdtempSync` home removed after each test.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LANDING_PRODUCER } from "../../../cli/commands/reading/core.js";
import { prSubjectOn } from "../../../cli/commands/talk/cardSubjectGate.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readReadingIndex, recordReading } from "../../../readings/store.js";
import { stateHomePaths } from "../../../stateHome.js";
import { readCardsNotOwners } from "../../../talk/cardNotOwnerStore.js";

let home = "";

/**
 * Record a landing reading whose census lists each pull request under its author, read as `octocat`.
 *
 * @param prs each listed pull request and who opened it
 */
function recordLanding({ prs }: { prs: readonly { number: number; author: string }[] }): void {
  const census = [{ kind: "read", pullRequests: prs, repo: "acme/widgets", viewer: "octocat" }];
  unwrap(
    recordReading({
      by: "tick-1",
      document: JSON.stringify({ census, rows: [], selection: { author: "@me", repos: ["acme/widgets"] } }),
      home,
      nowIso: "2026-10-02T03:00:00.000Z",
      observedAtIso: "2026-10-02T03:00:00.000Z",
      producer: LANDING_PRODUCER,
    }),
  );
}

const judge = ({ number }: { number: string }): ReturnType<typeof prSubjectOn> =>
  prSubjectOn({
    cardKey: `pr:acme.widgets.${number}`,
    decidedIso: "2026-10-02T04:20:00.000Z",
    home,
    nowIso: "2026-10-02T04:21:00.000Z",
  });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "card-subject-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("prSubjectOn", () => {
  it("passes a card when no landing reading is recorded, and keeps no verdict", () => {
    expect(judge({ number: "18277" }).isOk()).toBe(true);
    expect(unwrap(readCardsNotOwners({ home })).byCard.size).toBe(0);
  });

  it("refuses CARD_KEY_INVALID on a bare pr:<n>, even when no landing reading is recorded", () => {
    const refused = ["pr:18277", "pr:acme.widgets.018277"].map(
      (cardKey) =>
        unwrapErr(
          prSubjectOn({ cardKey, decidedIso: "2026-10-02T04:20:00.000Z", home, nowIso: "2026-10-02T04:21:00.000Z" }),
        ).code,
    );
    expect(refused).toEqual(["CARD_KEY_INVALID", "CARD_KEY_INVALID"]);
    expect(unwrap(readCardsNotOwners({ home })).byCard.size).toBe(0);
  });

  it("passes the owner's own pull request and keeps no verdict", () => {
    recordLanding({ prs: [{ author: "octocat", number: 16406 }] });
    expect(judge({ number: "16406" }).isOk()).toBe(true);
    expect(unwrap(readCardsNotOwners({ home })).byCard.size).toBe(0);
  });

  it("refuses a colleague's pull request and keeps the verdict under the whole key", () => {
    recordLanding({ prs: [{ author: "user1-acme", number: 18277 }] });
    expect(unwrapErr(judge({ number: "18277" })).code).toBe("CARD_NOT_HIS");
    expect([...unwrap(readCardsNotOwners({ home })).byCard.keys()]).toEqual(["pr:acme.widgets.18277"]);
  });

  it("refuses SUBJECT_UNREADABLE when the only reading will not read, and keeps no verdict", () => {
    recordLanding({ prs: [{ author: "octocat", number: 16406 }] });
    const index = unwrap(readReadingIndex({ home }));
    writeFileSync(join(stateHomePaths({ home }).readings, index.at(-1)!.file), "{torn");
    expect(unwrapErr(judge({ number: "16406" })).code).toBe("SUBJECT_UNREADABLE");
    expect(unwrap(readCardsNotOwners({ home })).byCard.size).toBe(0);
  });
});
