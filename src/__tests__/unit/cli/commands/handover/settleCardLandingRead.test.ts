/**
 * `hand list` over the card-landing ledger a kept relay card wrote, run for real against a temp home this file
 * mints: a real relay turn, a real hand register and a real board row. A sibling of `./settleCardRun.test.ts`,
 * whose fixtures it builds the same way; the board sits OUTSIDE `home/handovers`, so the store mirror stays out
 * of it (`testing.md`).
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HandDeps } from "../../../../../cli/commands/hand/deps.js";
import { runHandList } from "../../../../../cli/commands/hand/list.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { runHandoverSettle } from "../../../../../cli/commands/handover/settleRowRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { buildHandStep } from "../../../../../hand/step.js";
import { appendHandRow } from "../../../../../hand/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn, markRegistered } from "../../../../../talk/relayStore.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const SLUG = "talk-a00000170000";
const NOW = "2026-09-27T05:01:07.803Z";

let home = "";
let dir = "";

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "settle-card-"));
  dir = join(home, "board");
  mkdirSync(dir, { recursive: true });
  const step = unwrap(
    buildHandStep({
      draft: {
        id: "iso-drafts",
        postedBy: "workspace:129",
        postedIso: "2026-09-27T04:35:44.113Z",
        unblocks: "handover run iso-controls",
        url: "https://example.invalid/controls",
        what: "Send the ISO reply so the controls can close",
        witness: "slopweaver hand done iso-drafts",
      },
    }),
  );
  unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step } }));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Relay the owner's words over the `hand:iso-drafts` card and register the relay's row on the board. */
function relayOver(): string {
  const draft = unwrap(
    formRelayDraft({
      about: "hand:iso-drafts",
      heard: "",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "explain this card to me",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  unwrap(markRegistered({ home, nowIso: NOW, record: unwrap(claimTurn({ draft, home, nowIso: NOW })).record }));
  const path = join(dir, `${SLUG}.md`);
  writeFileSync(
    path,
    askRowText({
      anchor: `talk:${TURN}`,
      ask: "explain this card to me",
      askedIso: "2026-09-27T05:00:00Z",
      branch: undefined,
      checkedIso: "2026-09-27T05:00:01Z",
      dispatch: false,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: SLUG,
    }),
  );
  return path;
}

describe("hand list reading the ledger a kept relay card wrote", () => {
  // A one-off sanitiser left landing lines whose card key has a space in it, and lines about cards long gone: neither
  // can be a listed step's reason, so only a refused line about the step it lists is said.
  it("says a landing line did not read only when it may be about a step hand list prints", async () => {
    const path = relayOver();
    const settled = await runHandoverSettle([
      "node",
      "slopweaver",
      "handover",
      "settle",
      SLUG,
      "--as",
      "answered",
      "--witness",
      "https://example.invalid/archives/C1/p1788220579306599",
      "--lessons",
      "none",
      "--home",
      home,
      "--dir",
      dir,
      "--card",
      "kept",
      "--card-why",
      "the owner asked what it means",
    ]);
    expect(settled).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8")).toContain("cardDisposition: kept");
    const ledger = join(home, "talk", "card-landings.jsonl");
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "hand:acme Fixture 1", kind: "restored" })}\n`);
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "hand:abc-1", kind: "restored" })}\n`);
    const diagnostics: string[] = [];
    const deps: HandDeps = {
      branchesDeclaring: () => [],
      consoleBase: () => "http://localhost:3000",
      lookAt: () => {
        throw new Error("hand list looks at no page");
      },
      now: () => NOW,
      platform: "linux",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: () => undefined,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: () => undefined,
    };
    expect(runHandList({ deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(diagnostics.filter((line) => line.includes("did not read"))).toEqual([]);
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "hand:iso-drafts", kind: "restored" })}\n`);
    expect(runHandList({ deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(diagnostics.filter((line) => line.includes("did not read"))).toEqual([
      "hand list: card-landing line(s) 4 did not read, so a kept card's reason may be missing",
    ]);
  });
});
