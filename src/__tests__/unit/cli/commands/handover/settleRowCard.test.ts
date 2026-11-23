/**
 * `handover settle` on a relay row no turn names a card for — its turn file never written, or its `about` empty —
 * run for real against a temp home this file mints: a real hand register and a real board row, and a real relay
 * turn where the case has one. The board sits OUTSIDE `home/handovers` (`testing.md`).
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HandDeps } from "../../../../../cli/commands/hand/deps.js";
import { runHandDone } from "../../../../../cli/commands/hand/done.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { planSettleCard } from "../../../../../cli/commands/handover/settleCardRun.js";
import { noTurnCardReceipt, openCardsNamingRow } from "../../../../../cli/commands/handover/settleRowCard.js";
import { settleAskRow } from "../../../../../cli/commands/handover/settleRowRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { HandRow } from "../../../../../hand/row.js";
import { buildHandStep, type HandStep } from "../../../../../hand/step.js";
import { appendHandRow, handRegisterPath, underLock } from "../../../../../hand/store.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { SettleCardErrors } from "../../../../../handover/settleCardErrors.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { shellCommandLine } from "../../../../../lib/shellCommandLine.js";
import { callIndexPath } from "../../../../../talk/callStore.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn, markRegistered } from "../../../../../talk/relayStore.js";

const TURN = "a0000017-0000-4000-8000-000000000019";
const SLUG = "talk-a00000170000";
const ANCHOR = `talk:${TURN}`;
const WITNESS = "https://example.invalid/archives/C1/p1788220579306599";
const NOW = "2026-09-27T05:01:07.803Z";

let home = "";
let dir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "settle-row-card-"));
  dir = join(home, "board");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function step({ id, row }: { id: string; row: string | undefined }): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "workspace:129",
        postedIso: "2026-09-27T04:35:44.113Z",
        unblocks: `handover row ${SLUG}`,
        url: "https://example.invalid/controls",
        what: "Send the ISO reply so the controls can close",
        witness: `slopweaver hand done ${id}`,
        ...(row === undefined ? {} : { row }),
      },
    }),
  );
}

/** Post one open hand card, naming `row` as the row it unblocks. */
async function postCard({ id, row }: { id: string; row: string | undefined }): Promise<void> {
  unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id, row }) } }));
}

/** The board row alone, anchored `talk:<TURN>` — whether a turn file stands behind it is the case's to decide. */
function boardRow(): string {
  const path = join(dir, `${SLUG}.md`);
  writeFileSync(
    path,
    askRowText({
      anchor: ANCHOR,
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

/** A relay turn behind the row whose `about` is empty, so it names no card; registered unless told otherwise. */
function emptyAboutTurn({ register = true }: { register?: boolean } = {}): void {
  aboutTurn({ about: "", register });
}

/** A registered-or-not relay turn behind the row, said over the card `about` names. */
function aboutTurn({ about, register = true }: { about: string; register?: boolean }): void {
  const draft = unwrap(
    formRelayDraft({
      about,
      heard: "",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "explain this card to me",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  const claimed = unwrap(claimTurn({ draft, home, nowIso: NOW })).record;
  if (register) {
    unwrap(markRegistered({ home, nowIso: NOW, record: claimed }));
  }
}

/** The argv after `hand done` that the refusal prints for the card `iso-drafts`, in this case's home. */
const recovery = (): readonly string[] => ["iso-drafts", "--did", "<what was done>", `--home=${home}`];

/** The `hand` verbs' seams, with every macOS and network call a plain no-op, and diagnostics collected. */
function handDeps({ diagnostics }: { diagnostics: string[] }): HandDeps {
  return {
    branchesDeclaring: () => [],
    consoleBase: () => "http://localhost:3000",
    lookAt: () => ({ kind: "seen", picture: undefined }),
    now: () => NOW,
    platform: "linux",
    rowPullRequests: () => ({ kind: "not-asked" }),
    run: () => undefined,
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: () => undefined,
  };
}

const plan = ({ card = false }: { card?: boolean } = {}) =>
  planSettleCard({
    anchor: ANCHOR,
    bySession: "s",
    disposition: card ? { kind: "done" } : undefined,
    filedFrom: [],
    home,
    nowIso: NOW,
    settlement: "answered",
    slug: SLUG,
    witness: WITNESS,
  });

/** Run the settle end to end, collecting what it prints. */
async function settle(): Promise<{ code: number; lines: readonly string[] }> {
  const lines: string[] = [];
  const code = await settleAskRow({
    argv: [
      "node",
      "slopweaver",
      "handover",
      "settle",
      SLUG,
      "--as",
      "answered",
      "--witness",
      WITNESS,
      "--lessons",
      "none",
      "--home",
      home,
      "--dir",
      dir,
    ],
    out: ({ line }) => {
      lines.push(line);
    },
  });
  return { code, lines };
}

const settlement = ({ path }: { path: string }) =>
  parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).settlement;

describe("a talk: anchor whose turn file was never written", () => {
  it("settles with nothing to answer for, and the receipt says the register was read by the row", async () => {
    const path = boardRow();
    const settled = await settle();
    expect(settled.code).toBe(EXIT_OK);
    expect(settled.lines).toContain(noTurnCardReceipt({ anchor: ANCHOR, reason: "turn-absent", slug: SLUG }));
    expect(settlement({ path })).toBe("answered");
  });

  it("refuses while an open hand card names the row, naming the card, and writes nothing", async () => {
    const path = boardRow();
    await postCard({ id: "iso-drafts", row: SLUG });
    const before = readFileSync(path, "utf8");
    expect((await settle()).code).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    const refused = unwrapErr(plan());
    expect(refused.code).toBe("ROW_CARD_OPEN");
    expect(refused.message).toBe(
      `no relay turn names a hand card for this row, and an open hand card names row ${SLUG} (hand:iso-drafts) — once each ` +
        `step is done, close it first (\`${shellCommandLine({ command: ["slopweaver", "hand", "done", ...recovery()] })}\`), ` +
        "then settle again",
    );
  });

  it("prints a recovery that closes the card in the home the settle read, never the default one", async () => {
    boardRow();
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).message).toContain(`--home=${home}`);
    // The ambient home is this file's sandbox, which fails the test on any write, so a recovery missing
    // `--home` would not close the card below — it would write the default register and redden this case.
    const diagnostics: string[] = [];
    expect(await runHandDone({ deps: handDeps({ diagnostics }), rest: recovery() })).toBe(EXIT_OK);
    expect(diagnostics).toEqual([]);
    expect(unwrap(plan()).card.kind).toBe("none");
  });

  it("settles over an open card that names another row, or none", async () => {
    boardRow();
    await postCard({ id: "elsewhere", row: "some-other-row" });
    await postCard({ id: "standalone", row: undefined });
    expect(unwrap(plan()).card.kind).toBe("none");
  });

  it("settles once the card naming the row is closed", async () => {
    boardRow();
    await postCard({ id: "iso-drafts", row: SLUG });
    appendFileSync(
      handRegisterPath({ home }),
      `${JSON.stringify({ bySession: "s", did: "sent", id: "iso-drafts", kind: "settled", settledIso: NOW })}\n`,
    );
    expect(unwrap(plan()).card.kind).toBe("none");
  });

  it("refuses --card here, since no turn names a card for it to answer for", () => {
    boardRow();
    expect(unwrapErr(plan({ card: true })).code).toBe("CARD_DISPOSITION_INAPPLICABLE");
  });

  it("reads the register only under its lock, so an append cannot land between the row read and the torn-tail read", () => {
    boardRow();
    // Same-process contention refuses, so a plan run inside the lock proves the read asks for it rather than reading
    // the file in two unguarded opens.
    const inside = unwrap(underLock({ home, nowIso: NOW, section: () => ok(plan()) }));
    const refused = unwrapErr(inside);
    expect(refused.code).toBe("CARD_REGISTER_FAILED");
    expect(refused.message).toContain("another session is writing the hand-step register right now");
  });

  it("refuses a register with a skipped line, since that line may be the card naming the row", async () => {
    boardRow();
    await postCard({ id: "elsewhere", row: "some-other-row" });
    appendFileSync(handRegisterPath({ home }), "{not json\n");
    appendFileSync(
      handRegisterPath({ home }),
      `${JSON.stringify({ bySession: "s", did: "x", id: "never-there", kind: "settled", settledIso: NOW })}\n`,
    );
    expect(unwrapErr(plan()).code).toBe("HAND_REGISTER_INCOMPLETE");
  });

  it("refuses a skipped line sitting before a blank unterminated tail, which is no torn row to forgive", () => {
    boardRow();
    mkdirSync(dirname(handRegisterPath({ home })), { recursive: true });
    writeFileSync(handRegisterPath({ home }), "not-json\n   ");
    expect(unwrapErr(plan()).code).toBe("HAND_REGISTER_INCOMPLETE");
  });
});

describe("a talk: anchor whose turn names no card", () => {
  it("settles with the receipt when no open card names the row", async () => {
    const path = boardRow();
    emptyAboutTurn();
    const settled = await settle();
    expect(settled.code).toBe(EXIT_OK);
    expect(settled.lines).toContain(noTurnCardReceipt({ anchor: ANCHOR, reason: "about-empty", slug: SLUG }));
    expect(settlement({ path })).toBe("answered");
  });

  it("refuses while an open hand card names the row", async () => {
    boardRow();
    emptyAboutTurn();
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).code).toBe("ROW_CARD_OPEN");
  });

  it("decides by the row alone whatever the turn's state, since a turn's about is fixed when it is claimed", async () => {
    boardRow();
    emptyAboutTurn({ register: false });
    expect(unwrap(plan()).card.kind).toBe("none");
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).code).toBe("ROW_CARD_OPEN");
  });
});

describe("a talk: anchor whose turn names a card that is not a hand card", () => {
  it("settles with the receipt when no open hand card names the row", async () => {
    const path = boardRow();
    aboutTurn({ about: "ask:some-other-card" });
    const settled = await settle();
    expect(settled.code).toBe(EXIT_OK);
    expect(settled.lines).toContain(noTurnCardReceipt({ anchor: ANCHOR, reason: "about-not-hand", slug: SLUG }));
    expect(settlement({ path })).toBe("answered");
  });

  it("refuses while an open hand card names the row, since the turn named no hand card to answer for", async () => {
    boardRow();
    aboutTurn({ about: "ask:some-other-card" });
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).code).toBe("ROW_CARD_OPEN");
  });

  it("decides by the row alone whatever the turn's state, as an empty about does", async () => {
    boardRow();
    aboutTurn({ about: "ask:some-other-card", register: false });
    expect(unwrap(plan()).card.kind).toBe("none");
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).code).toBe("ROW_CARD_OPEN");
  });

  it("still refuses --card, since its card is no hand card", () => {
    boardRow();
    aboutTurn({ about: "ask:some-other-card" });
    expect(unwrapErr(plan({ card: true })).code).toBe("CARD_DISPOSITION_INAPPLICABLE");
  });
});

describe("a talk: anchor that holds a console CALL id", () => {
  it("refuses while an open hand card names the row, since a call names no card either", async () => {
    boardRow();
    mkdirSync(dirname(callIndexPath({ home })), { recursive: true });
    writeFileSync(callIndexPath({ home }), `${TURN}\n`);
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).code).toBe("ROW_CARD_OPEN");
  });
});

describe("a talk: anchor with no turn file whose call store cannot say whether it is a call", () => {
  const damageIndex = (): void => {
    mkdirSync(dirname(callIndexPath({ home })), { recursive: true });
    writeFileSync(callIndexPath({ home }), "not-a-call-id\n");
  };

  it("refuses while an open hand card names the row, since a call and an absent turn are decided alike", async () => {
    boardRow();
    damageIndex();
    await postCard({ id: "iso-drafts", row: SLUG });
    expect(unwrapErr(plan()).code).toBe("ROW_CARD_OPEN");
  });

  it("settles when no open card names the row, the receipt naming the store's failure", async () => {
    const path = boardRow();
    damageIndex();
    const settled = await settle();
    expect(settled.code).toBe(EXIT_OK);
    expect(settled.lines).toContain(noTurnCardReceipt({ anchor: ANCHOR, reason: "call-unproven", slug: SLUG }));
    expect(
      settled.lines.some((line) => line.startsWith("    the call store: ") && line.includes("call-index.txt")),
    ).toBe(true);
    expect(settlement({ path })).toBe("answered");
  });
});

describe("openCardsNamingRow", () => {
  const posted = ({ id, row }: { id: string; row: string | undefined }): HandRow => ({
    kind: "posted",
    step: step({ id, row }),
  });

  it("names every open card naming the row, so a duplicate never falls through to none", () => {
    const rows = [
      posted({ id: "first", row: SLUG }),
      posted({ id: "other", row: "some-other-row" }),
      posted({ id: "second", row: SLUG }),
    ];
    expect(openCardsNamingRow({ rows, slug: SLUG })).toEqual(["first", "second"]);
  });

  it("gives one runnable hand done per card when several name the row, each quoted and naming the home", () => {
    expect(
      SettleCardErrors.rowCardOpen({ home: "/state/it's here", ids: ["first", "second"], slug: SLUG }).message,
    ).toContain(
      "(`slopweaver hand done first --did '<what was done>' '--home=/state/it'\\''s here'`, then " +
        "`slopweaver hand done second --did '<what was done>' '--home=/state/it'\\''s here'`)",
    );
  });

  it("prints a relative home spelled like a flag as the absolute directory it named, so neither cwd nor help can redirect it", () => {
    const printed = shellCommandLine({
      command: [
        "slopweaver",
        "hand",
        "done",
        "first",
        "--did",
        "<what was done>",
        `--home=${join(process.cwd(), "-h")}`,
      ],
    });
    expect(SettleCardErrors.rowCardOpen({ home: "-h", ids: ["first"], slug: SLUG }).message).toContain(
      `(\`${printed}\`)`,
    );
  });

  it("prints an empty home as the directory it resolved to, never an empty flag a later cwd would fill", () => {
    const printed = shellCommandLine({
      command: ["slopweaver", "hand", "done", "first", "--did", "<what was done>", `--home=${process.cwd()}`],
    });
    expect(SettleCardErrors.rowCardOpen({ home: "", ids: ["first"], slug: SLUG }).message).toContain(
      `(\`${printed}\`)`,
    );
  });

  it("names nothing for an empty register", () => {
    expect(openCardsNamingRow({ rows: [], slug: SLUG })).toEqual([]);
  });
});

describe("noTurnCardReceipt", () => {
  it("says which turn was missing its card, and that the register was read by the row", () => {
    expect(noTurnCardReceipt({ anchor: ANCHOR, reason: "turn-absent", slug: SLUG })).toBe(
      `  ${ANCHOR} has no turn file, so the hand register was read by the row: no open card names ${SLUG}, none to answer for`,
    );
    expect(noTurnCardReceipt({ anchor: ANCHOR, reason: "about-empty", slug: SLUG })).toBe(
      `  ${ANCHOR} names a turn that names no card, so the hand register was read by the row: no open card names ${SLUG}, none to answer for`,
    );
  });
});
