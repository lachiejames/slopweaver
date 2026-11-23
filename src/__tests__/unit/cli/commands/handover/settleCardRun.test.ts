/**
 * `handover settle` on a row a talk relay registered over a hand card, run for real against a temp home this file
 * mints: a real relay turn, a real hand register and a real board row. The board sits OUTSIDE `home/handovers`,
 * so the store mirror stays out of it (`testing.md`).
 */
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import type { HandDeps } from "../../../../../cli/commands/hand/deps.js";
import { runHandList } from "../../../../../cli/commands/hand/list.js";
import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import { performSettleCard, planSettleCard } from "../../../../../cli/commands/handover/settleCardRun.js";
import { reportRunResidue } from "../../../../../cli/commands/handover/settleResidueRun.js";
import { runHandoverSettle, settleAskRow } from "../../../../../cli/commands/handover/settleRowRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { appendHandPost } from "../../../../../hand/multiAppend.js";
import { buildHandStep, type HandStep } from "../../../../../hand/step.js";
import { appendHandRow, handRegisterPath, readOpenHandSteps } from "../../../../../hand/store.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { runJournalPath } from "../../../../../handover/runStore.js";
import { settleCardDid } from "../../../../../handover/settleCard.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { callIndexPath } from "../../../../../talk/callStore.js";
import { activeCardLandings } from "../../../../../talk/cardLanding.js";
import { readCardLandings } from "../../../../../talk/cardLandingStore.js";
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
  home = mkdtempSync(join(tmpdir(), "settle-card-"));
  dir = join(home, "board");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function step({ id }: { id: string }): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "workspace:129",
        postedIso: "2026-09-27T04:35:44.113Z",
        unblocks: "handover run iso-controls",
        url: "https://example.invalid/controls",
        what: "Send the ISO reply so the controls can close",
        witness: `slopweaver hand done ${id}`,
      },
    }),
  );
}

/** Post a card, relay the owner's words over it, and register the relay's row on the board. */
function relayOver({ about, register = true }: { about: string; register?: boolean }): string {
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

const settle = ({
  extra = [],
  witness = WITNESS,
}: { extra?: readonly string[]; witness?: string } = {}): Promise<number> =>
  runHandoverSettle([
    "node",
    "slopweaver",
    "handover",
    "settle",
    SLUG,
    "--as",
    "answered",
    "--witness",
    witness,
    "--lessons",
    "none",
    "--home",
    home,
    "--dir",
    dir,
    ...extra,
  ]);

const openIds = (): readonly string[] => unwrap(readOpenHandSteps({ home })).steps.map((one) => one.id);
const doc = ({ path }: { path: string }) => parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
const DID = settleCardDid({ settlement: "answered", slug: SLUG, witness: WITNESS });

describe("handover settle over a relay's open hand card", () => {
  beforeEach(async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
  });

  it("refuses a settle that says nothing about the card, and writes nothing", async () => {
    const path = relayOver({ about: "hand:iso-drafts" });
    const before = readFileSync(path, "utf8");
    expect(await settle()).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(openIds()).toEqual(["iso-drafts"]);
  });

  it("settles the card done, then the row, and records the disposition in the row's front matter", async () => {
    const path = relayOver({ about: "hand:iso-drafts" });
    expect(await settle({ extra: ["--card", "done"] })).toBe(EXIT_OK);
    expect(openIds()).toEqual([]);
    const settledLine = readFileSync(handRegisterPath({ home }), "utf8").trimEnd().split("\n").at(-1)!;
    expect(JSON.parse(settledLine).did).toBe(DID);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("\ncardDisposition: done\n");
    expect(text).toContain("\ncardDispositionCard: hand:iso-drafts\n");
    expect(doc({ path }).problems).toEqual([]);
  });

  // A retry that forgot --card still records the done its first attempt wrote, and one whose witness would make a
  // did past the cap owes no new did, so it is never checked against one.
  it.each([
    ["with --card done", ["--card", "done"], WITNESS],
    ["with no --card", [], WITNESS],
    ["with a witness too long for a did", [], "w".repeat(2_000)],
  ])(
    "converges when a crash left the card's done written and the row open, retried %s",
    async (_how, extra, witness) => {
      const path = relayOver({ about: "hand:iso-drafts" });
      unwrap(
        await appendHandRow({
          home,
          nowIso: NOW,
          row: { bySession: "s", did: DID, id: "iso-drafts", kind: "settled", settledIso: NOW },
        }),
      );
      const linesBefore = readFileSync(handRegisterPath({ home }), "utf8");
      expect(await settle({ extra, witness })).toBe(EXIT_OK);
      expect(readFileSync(handRegisterPath({ home }), "utf8")).toBe(linesBefore);
      expect(readFileSync(path, "utf8")).toContain("\ncardDisposition: done\n");
    },
  );

  it("keeps the card up with its reason, which hand list shows in text and json", async () => {
    const path = relayOver({ about: "hand:iso-drafts" });
    expect(await settle({ extra: ["--card", "kept", "--card-why", "the owner asked what it means"] })).toBe(EXIT_OK);
    expect(openIds()).toEqual(["iso-drafts"]);
    const ledger = unwrap(readCardLandings({ home })).rows;
    expect(ledger).toEqual([
      {
        anchor: ANCHOR,
        atIso: ledger[0]!.atIso,
        cardKey: "hand:iso-drafts",
        disposition: "kept",
        kind: "restored",
        why: "the owner asked what it means",
        workSlug: SLUG,
      },
    ]);
    expect(activeCardLandings({ rows: ledger })).toEqual([]);
    expect(readFileSync(path, "utf8")).toContain('\ncardDispositionReason: "the owner asked what it means"\n');
    const out: string[] = [];
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
      writeDiagnostic: () => undefined,
      writeOut: (line) => {
        out.push(line);
      },
    };
    expect(runHandList({ deps, rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).keptReason).toBe("the owner asked what it means");
    out.length = 0;
    expect(runHandList({ deps, rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out).toContain("    kept because the owner asked what it means");
  });

  it("refuses a re-cut nothing posted, and leaves card and row alone", async () => {
    const path = relayOver({ about: "hand:iso-drafts" });
    const before = readFileSync(path, "utf8");
    expect(await settle({ extra: ["--card", "recut", "--card-new", "iso-reply"] })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(openIds()).toEqual(["iso-drafts"]);
  });

  it.each([
    ["done", []],
    ["kept", ["--card-why", "the owner asked what it means"]],
  ] as const)(
    "refuses a witness the row cannot record BEFORE touching the card, so a --card %s writes nothing",
    async (kind, companion) => {
      const path = relayOver({ about: "hand:iso-drafts" });
      const before = readFileSync(path, "utf8");
      const register = readFileSync(handRegisterPath({ home }), "utf8");
      expect(await settle({ extra: ["--card", kind, ...companion], witness: `${WITNESS}\ninjected: yes` })).toBe(
        EXIT_ERROR,
      );
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(readFileSync(handRegisterPath({ home }), "utf8")).toBe(register);
      expect(unwrap(readCardLandings({ home })).rows).toEqual([]);
    },
  );

  it("refuses a companion flag off its disposition as usage", async () => {
    relayOver({ about: "hand:iso-drafts" });
    expect(await settle({ extra: ["--card", "done", "--card-why", "x"] })).toBe(EXIT_USAGE);
  });

  it("refuses a register with a skipped line, since that line may be the card's own fate", async () => {
    const path = relayOver({ about: "hand:iso-drafts" });
    appendFileSync(handRegisterPath({ home }), "{not json\n");
    appendHandRowAfterCorruption();
    const before = readFileSync(path, "utf8");
    expect(await settle({ extra: ["--card", "done"] })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(
      unwrapErr(
        planSettleCard({
          anchor: ANCHOR,
          bySession: "s",
          disposition: { kind: "done" },
          filedFrom: [],
          home,
          nowIso: NOW,
          settlement: "answered",
          slug: SLUG,
          witness: WITNESS,
        }),
      ).code,
    ).toBe("HAND_REGISTER_INCOMPLETE");
  });

  it("refuses the effect when something else closed the card between the plan and the write", async () => {
    relayOver({ about: "hand:iso-drafts" });
    const plan = unwrap(
      planSettleCard({
        anchor: ANCHOR,
        bySession: "s",
        disposition: { kind: "done" },
        filedFrom: [],
        home,
        nowIso: NOW,
        settlement: "answered",
        slug: SLUG,
        witness: WITNESS,
      }),
    ).card;
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "s", did: "the owner pressed Done", id: "iso-drafts", kind: "settled", settledIso: NOW },
      }),
    );
    const before = readFileSync(handRegisterPath({ home }), "utf8");
    expect(unwrapErr(performSettleCard({ bySession: "s", home, nowIso: NOW, plan, slug: SLUG })).code).toBe(
      "CARD_SETTLED_OTHERWISE",
    );
    expect(readFileSync(handRegisterPath({ home }), "utf8")).toBe(before);
  });

  // An hour-old lease held by a LIVE process (this one): past the default 15-minute window, and still not taken over.
  it.each([
    ["just now", 0],
    ["an hour ago", 60 * 60 * 1000],
  ])(
    "refuses while another live settle of the same row holds its lock since %s, and writes nothing",
    async (_when, ageMs) => {
      const path = relayOver({ about: "hand:iso-drafts" });
      const before = readFileSync(path, "utf8");
      const acquiredIso = new Date(Date.now() - ageMs).toISOString();
      const held = unwrap(acquireOperationLock({ home, key: `handover-settle:${SLUG}`, nowIso: acquiredIso }));
      try {
        expect(await settle({ extra: ["--card", "done"] })).toBe(EXIT_ERROR);
      } finally {
        held.release();
      }
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(openIds()).toEqual(["iso-drafts"]);
    },
  );
});

/** A good row after the bad line, so the bad line is not a torn tail the reader may forgive. */
function appendHandRowAfterCorruption(): void {
  appendFileSync(
    handRegisterPath({ home }),
    `${JSON.stringify({ bySession: "s", did: "x", id: "never-there", kind: "settled", settledIso: NOW })}\n`,
  );
}

describe("handover settle over a card a re-cut replaced", () => {
  beforeEach(async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }));
  });

  it("wants the re-cut named, checks the name, and records the successor", async () => {
    const path = relayOver({ about: "hand:iso-drafts" });
    expect(await settle()).toBe(EXIT_ERROR);
    expect(await settle({ extra: ["--card", "recut", "--card-new", "iso-other"] })).toBe(EXIT_ERROR);
    expect(await settle({ extra: ["--card", "done"] })).toBe(EXIT_ERROR);
    expect(await settle({ extra: ["--card", "recut", "--card-new", "iso-reply"] })).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8")).toContain("\ncardDispositionSuccessor: iso-reply\n");
    expect(openIds()).toEqual(["iso-reply"]);
  });
});

describe("handover settle over a row with no card to answer for", () => {
  it("settles as it always did, and refuses a --card there as inapplicable", async () => {
    const path = relayOver({ about: "" });
    expect(await settle({ extra: ["--card", "done"] })).toBe(EXIT_ERROR);
    expect(await settle()).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8")).not.toContain("cardDisposition");
  });

  it("dates the settlement with the settle's own clock, the instant the ask leaves the owner's Queue", async () => {
    const path = relayOver({ about: "" });
    const before = Date.now();
    expect(await settle()).toBe(EXIT_OK);
    const after = Date.now();
    const settled = doc({ path });
    const at = Date.parse(settled.settledIso!);
    expect([settled.settlement, settled.settlementWitness]).toEqual(["answered", WITNESS]);
    expect([at >= before, at <= after]).toEqual([true, true]);
  });

  it("settles a board row that is a symlink through to its target, and leaves the link in place", async () => {
    const link = relayOver({ about: "" });
    const target = join(home, "elsewhere.md");
    renameSync(link, target);
    symlinkSync(target, link);
    expect(await settle()).toBe(EXIT_OK);
    expect([
      lstatSync(link).isSymbolicLink(),
      readFileSync(target, "utf8").includes("\nsettlement: answered\n"),
    ]).toEqual([true, true]);
  });

  it("fails on a relay anchor whose turn never registered, rather than reading it as no card", async () => {
    const path = relayOver({ about: "hand:iso-drafts", register: false });
    const before = readFileSync(path, "utf8");
    expect(await settle()).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(
      unwrapErr(
        planSettleCard({
          anchor: ANCHOR,
          bySession: "s",
          disposition: undefined,
          filedFrom: [],
          home,
          nowIso: NOW,
          settlement: "answered",
          slug: SLUG,
          witness: WITNESS,
        }),
      ).message,
    ).toBe(
      `the turn behind ${ANCHOR} does not match this row: its state disagrees, so its card is not this row's to answer for`,
    );
  });

  it("settles a relay anchor whose turn file is missing with nothing to answer for, once no open card names the row", () => {
    expect(
      unwrap(
        planSettleCard({
          anchor: ANCHOR,
          bySession: "s",
          disposition: undefined,
          filedFrom: [],
          home,
          nowIso: NOW,
          settlement: "answered",
          slug: SLUG,
          witness: WITNESS,
        }),
      ).card.kind,
    ).toBe("none");
  });
});

describe("a talk: anchor that holds a console CALL id", () => {
  /** The row alone, no relay turn behind it, and the call store's index carrying `index` verbatim. */
  function callRow({ index }: { index: string }): string {
    mkdirSync(dirname(callIndexPath({ home })), { recursive: true });
    writeFileSync(callIndexPath({ home }), index);
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

  const plan = () =>
    planSettleCard({
      anchor: ANCHOR,
      bySession: "s",
      disposition: undefined,
      filedFrom: [],
      home,
      nowIso: NOW,
      settlement: "answered",
      slug: SLUG,
      witness: WITNESS,
    });

  it("settles as the call anchor it is: no relay, so no card, and the receipt says how it was read", async () => {
    const path = callRow({ index: `${TURN}\n` });
    expect(unwrap(plan()).card.kind).toBe("none");
    const lines: string[] = [];
    expect(
      await settleAskRow({
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
      }),
    ).toBe(EXIT_OK);
    expect(lines).toContain(
      `  ${ANCHOR} holds call id ${TURN}, not a relay turn's, so it was read as that call: no relay card to answer for`,
    );
    expect([doc({ path }).settlement, doc({ path }).settlementWitness]).toEqual(["answered", WITNESS]);
  });

  it("refuses --card over a call id, exactly as over a correctly spelled call anchor", async () => {
    const path = callRow({ index: `${TURN}\n` });
    const before = readFileSync(path, "utf8");
    expect(await settle({ extra: ["--card", "done"] })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("settles an absent turn whose id no call carries, with nothing to answer for, read by the row", () => {
    callRow({ index: "a0000071-0000-4000-8000-000000000077\n" });
    expect(unwrap(plan()).card.kind).toBe("none");
  });

  it("settles by the row when the call index will not read, the receipt naming the index", () => {
    callRow({ index: "not-a-call-id\n" });
    const planned = unwrap(plan());
    expect(planned.card.kind).toBe("none");
    expect(planned.receiptLines.join("\n")).toContain("call-index.txt");
  });
});

describe("a doc filed from a relay, carrying the relay's anchor", () => {
  const DOC_SLUG = "the-card-reads-as-a-question";

  /** The doc the supervisor cut from the relay: its own slug, the relay's anchor. */
  function fileDoc(): string {
    const path = join(dir, `${DOC_SLUG}.md`);
    writeFileSync(
      path,
      askRowText({
        anchor: ANCHOR,
        ask: "explain this card to me",
        askedIso: "2026-09-27T05:00:00Z",
        branch: undefined,
        checkedIso: "2026-09-27T05:00:01Z",
        dispatch: true,
        finding: undefined,
        priority: undefined,
        repo: undefined,
        shape: undefined,
        slug: DOC_SLUG,
      }),
    );
    return path;
  }

  const settleAs = ({
    slug,
    as,
    witness,
    extra = [],
  }: {
    slug: string;
    as: string;
    witness: string;
    extra?: readonly string[];
  }): Promise<number> =>
    runHandoverSettle([
      "node",
      "slopweaver",
      "handover",
      "settle",
      slug,
      "--as",
      as,
      "--witness",
      witness,
      "--lessons",
      "none",
      "--home",
      home,
      "--dir",
      dir,
      ...extra,
    ]);

  it("owes a card the relay kept: refused without --card, closed by --card done", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    relayOver({ about: "hand:iso-drafts" });
    fileDoc();
    const kept = ["--card", "kept", "--card-why", "the work continues in the doc"];
    expect(await settleAs({ as: "filed", extra: kept, slug: SLUG, witness: DOC_SLUG })).toBe(EXIT_OK);
    expect(await settleAs({ as: "answered", slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_ERROR);
    expect(openIds()).toEqual(["iso-drafts"]);
    const done = ["--card", "done"];
    expect(await settleAs({ as: "answered", extra: done, slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_OK);
    expect(openIds()).toEqual([]);
  });

  it("owes nothing for a card the relay already settled done", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    relayOver({ about: "hand:iso-drafts" });
    const path = fileDoc();
    const done = ["--card", "done"];
    expect(await settleAs({ as: "filed", extra: done, slug: SLUG, witness: DOC_SLUG })).toBe(EXIT_OK);
    expect(await settleAs({ as: "answered", slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8").includes("\nsettlement: answered\n")).toBe(true);
  });

  it("settles once the relay row is settled filed into it, and answers for no card", async () => {
    relayOver({ about: "" });
    const path = fileDoc();
    expect(await settleAs({ as: "filed", slug: SLUG, witness: DOC_SLUG })).toBe(EXIT_OK);
    expect(await settleAs({ as: "answered", slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_OK);
    const settled = readFileSync(path, "utf8");
    expect([settled.includes("\nsettlement: answered\n"), settled.includes("cardDisposition")]).toEqual([true, false]);
  });

  it("settles a row cut from a relay owing no card though the relay row was never filed into it", async () => {
    relayOver({ about: "" });
    const path = fileDoc();
    expect(await settleAs({ as: "answered", slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8").includes("\nsettlement: answered\n")).toBe(true);
  });

  it("still refuses on the slug while the relay's card is open and its row is not settled filed into it", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    relayOver({ about: "hand:iso-drafts" });
    const path = fileDoc();
    const before = readFileSync(path, "utf8");
    expect(await settleAs({ as: "answered", slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_ERROR);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(
      unwrapErr(
        planSettleCard({
          anchor: ANCHOR,
          bySession: "s",
          disposition: undefined,
          filedFrom: [],
          home,
          nowIso: NOW,
          settlement: "answered",
          slug: DOC_SLUG,
          witness: WITNESS,
        }),
      ).message,
    ).toBe(
      `the turn behind ${ANCHOR} does not match this row: its slug disagrees, so its card is not this row's to answer for`,
    );
  });

  it("refuses a lineage vouched for by a row that only shares the relay's slug, not its anchor", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    relayOver({ about: "hand:iso-drafts" });
    const path = fileDoc();
    // Sorts before the relay's own file, so a settle of that slug finds this one first.
    writeFileSync(
      join(dir, "a-dup.md"),
      askRowText({
        anchor: WITNESS,
        ask: "explain this card to me",
        askedIso: "2026-08-31T23:56:19.000Z",
        branch: undefined,
        checkedIso: "2026-09-27T05:00:01Z",
        dispatch: true,
        finding: undefined,
        priority: undefined,
        repo: undefined,
        shape: undefined,
        slug: SLUG,
      }),
    );
    expect(await settleAs({ as: "filed", slug: SLUG, witness: DOC_SLUG })).toBe(EXIT_OK);
    const before = readFileSync(path, "utf8");
    expect(await settleAs({ as: "answered", slug: DOC_SLUG, witness: WITNESS })).toBe(EXIT_ERROR);
    expect([readFileSync(path, "utf8") === before, openIds()]).toEqual([true, ["iso-drafts"]]);
  });

  it("settles a lineage turn that never registered when it names no card, since no card is at stake", () => {
    relayOver({ about: "", register: false });
    expect(
      unwrap(
        planSettleCard({
          anchor: ANCHOR,
          bySession: "s",
          disposition: undefined,
          filedFrom: [{ anchor: ANCHOR, slug: SLUG }],
          home,
          nowIso: NOW,
          settlement: "answered",
          slug: DOC_SLUG,
          witness: WITNESS,
        }),
      ).card.kind,
    ).toBe("none");
  });
});

describe("what the settle says after the row is written", () => {
  const SETTLED = { reason: undefined, settlement: "answered", witness: WITNESS } as const;

  it("has nothing to say about a row that never had a run", async () => {
    const lines: string[] = [];
    expect(await reportRunResidue({ home, out: ({ line }) => lines.push(line), settled: SETTLED, slug: SLUG })).toBe(
      EXIT_OK,
    );
    expect(lines).toEqual([]);
  });

  it("fails on a run journal with an undecodable line rather than judging the run from the rest", async () => {
    const journal = runJournalPath({ runsDir: stateHomePaths({ home }).runs, slug: SLUG });
    mkdirSync(stateHomePaths({ home }).runs, { recursive: true });
    writeFileSync(journal, "{not json\n");
    expect(await reportRunResidue({ home, out: () => undefined, settled: SETTLED, slug: SLUG })).toBe(EXIT_ERROR);
  });
});
