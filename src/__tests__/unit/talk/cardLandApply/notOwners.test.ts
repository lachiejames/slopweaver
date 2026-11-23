/**
 * A `pr:` card whose pull request somebody else opened: the owner's words are refused on it, the verdict kept under the
 * card's whole key, while the owner's own pull request's card still lands — the REAL `landCard`, `talk transcript` and
 * `talk land` over a throwaway home and board.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { landCard } from "../../../../cli/commands/talk/cardLandApply.js";
import { runTalkLand } from "../../../../cli/commands/talk/cardsRun.js";
import { runTalkTranscript } from "../../../../cli/commands/talk/transcriptRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../cli/exitCodes.js";
import { readReadingIndex } from "../../../../readings/store.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { readCardLandings } from "../../../../talk/cardLandingStore.js";
import { readCardsNotOwners } from "../../../../talk/cardNotOwnerStore.js";
import { ANCHOR, active, argvFor, board, CALL, home, input, MINE, recordLanding, useCardLandHome } from "./harness.js";

useCardLandHome();

describe("a pr: card whose pull request is not the owner's", () => {
  const THEIRS = "pr:acme.widgets.18277";

  beforeEach(() => {
    recordLanding({ prs: [{ author: "user1-acme", number: 18277 }] });
  });

  it("refuses CARD_NOT_HIS, naming who opened it, and writes no ledger row and no board row", async () => {
    const error = unwrapErr(await landCard({ input: input({ cardKey: THEIRS }) }));
    expect(error.code).toBe("CARD_NOT_HIS");
    expect(error.message).toBe(
      "the owner's words do not land on pr:acme.widgets.18277: acme/widgets#18277 was opened by user1-acme, not octocat " +
        "(the landing reading of 2026-09-25T15:00:00.000Z)",
    );
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
    expect(readdirSync(board)).toEqual([]);
  });

  it("keeps the verdict when the utterance's instant moves to before any reading said so", async () => {
    const first = unwrapErr(await landCard({ input: input({ cardKey: THEIRS }) }));
    const moved = unwrapErr(
      await landCard({ input: input({ cardKey: THEIRS, decidedIso: "2026-09-25T14:00:00.000Z", words: "grown" }) }),
    );
    expect([first.code, moved.code]).toEqual(["CARD_NOT_HIS", "CARD_NOT_HIS"]);
    expect(moved.message).toBe(first.message);
    expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
    expect([...unwrap(readCardsNotOwners({ home })).byCard.keys()]).toEqual([THEIRS]);
  });

  it("keeps one repository's verdict off another repository's card with the same number", async () => {
    unwrapErr(await landCard({ input: input({ cardKey: THEIRS }) }));
    expect(unwrap(await landCard({ input: input({ cardKey: "pr:acme.gadgets.18277" }) })).outcome).toBe("landed");
    expect([...unwrap(readCardsNotOwners({ home })).byCard.keys()]).toEqual([THEIRS]);
  });

  it("refuses a bare-number key and a leading zero as naming no pull request, so no card has two keys", async () => {
    const bare = unwrapErr(await landCard({ input: input({ cardKey: "pr:18277" }) }));
    const padded = unwrapErr(await landCard({ input: input({ cardKey: "pr:acme.widgets.018277" }) }));
    expect([bare.code, padded.code]).toEqual(["CARD_KEY_INVALID", "CARD_KEY_INVALID"]);
    expect(padded.message).toContain("a pull request's being pr:<owner>.<repo>.<n>");
    expect(readdirSync(board)).toEqual([]);
  });

  it("judges by the newest reading when the one in force will not read, so the owner's own card still lands", async () => {
    const index = unwrap(readReadingIndex({ home }));
    writeFileSync(join(stateHomePaths({ home }).readings, index.at(-1)!.file), "{torn");
    recordLanding({ atIso: "2026-09-25T15:50:00.000Z", prs: [{ author: "octocat", number: 16406 }] });
    expect(unwrap(await landCard({ input: input({ cardKey: MINE }) })).outcome).toBe("landed");
  });

  it("lands on a pr: card when no landing reading is recorded at all — nothing says anybody else opened it", async () => {
    const bare = mkdtempSync(join(tmpdir(), "card-land-bare-"));
    try {
      const landed = unwrap(await landCard({ input: input({ cardKey: MINE, home: bare }) }));
      expect(landed.outcome).toBe("landed");
    } finally {
      rmSync(bare, { force: true, recursive: true });
    }
  });

  it("still lands on the owner's own pull request merged out of the census since they spoke", async () => {
    recordLanding({ atIso: "2026-09-25T15:30:00.000Z", prs: [{ author: "octocat", number: 16406 }] });
    recordLanding({ atIso: "2026-09-25T15:45:00.000Z", prs: [] });
    expect(unwrap(await landCard({ input: input({ cardKey: MINE }) })).outcome).toBe("landed");
  });

  it("still lands on the owner's own pull request after the colleague's is read", async () => {
    recordLanding({
      prs: [
        { author: "octocat", number: 16406 },
        { author: "user1-acme", number: 18277 },
      ],
    });
    expect(unwrap(await landCard({ input: input({ cardKey: MINE }) })).outcome).toBe("landed");
  });

  it("passes the colleague's card over in talk transcript without failing the batch, and refuses talk land on it", async () => {
    const path = join(home, "theirs.jsonl");
    const lines = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      {
        atIso: "2026-09-25T15:40:00.000Z",
        final: true,
        id: "s-1",
        kind: "segment",
        open: THEIRS,
        text: "MDS",
        who: "owner",
      },
      {
        atIso: "2026-09-25T15:40:03.000Z",
        final: true,
        id: "v-1",
        kind: "segment",
        open: THEIRS,
        text: "Ok",
        who: "voice",
      },
    ];
    writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    const rest = ["--call", CALL, "--entries-file", path, "--home", home, "--json"];
    expect(await runTalkTranscript(argvFor({ rest, verb: "transcript" }))).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(readdirSync(board)).toEqual([]);
    // Their pull request merges out of the census; the next batch re-judges the unlanded utterance by the reading
    // in force when the owner spoke, so it is refused again rather than landed late.
    recordLanding({ atIso: "2026-09-25T16:00:00.000Z", prs: [{ author: "octocat", number: 16406 }] });
    expect(await runTalkTranscript(argvFor({ rest, verb: "transcript" }))).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(readdirSync(board)).toEqual([]);
    const land = ["--card", THEIRS, "--words", "MDS", "--anchor", ANCHOR, "--decided", "2026-09-25T15:40:00.000Z"];
    expect(await runTalkLand(argvFor({ rest: [...land, "--dir", board, "--home", home], verb: "land" }))).toBe(
      EXIT_ERROR,
    );
    expect(active()).toEqual([]);
  });
});
