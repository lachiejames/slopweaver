/**
 * A relay whose words landed on an `ask:` card is filed into that ask once the ask's row shows action since the relay
 * registered — run for real against a temp home: a real relay turn and row, a real card-landing ledger, a real ask row
 * and journal, and the shipped `handover settle` behind it. The board sits OUTSIDE `home/handovers` (`testing.md`).
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askRowText } from "../../../../../cli/commands/handover/askRowText.js";
import {
  answerRelayAnchorsForWork,
  settleRelaysForWork,
} from "../../../../../cli/commands/handover/relaySettleForWork.js";
import { runHandoverSettleVerb } from "../../../../../cli/commands/handover/settleVerbRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { readRelayLandingEvidence, readRelayLandingLedger } from "../../../../../handover/relayLandingRead.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { appendCardLanding } from "../../../../../talk/cardLandingStore.js";
import { formRelayDraft } from "../../../../../talk/relayDraft.js";
import { claimTurn, markRegistered } from "../../../../../talk/relayStore.js";

const TURN = "7025a6cb-0000-4c1d-9e2f-0a1b2c3d4e5f";
const SLUG = "talk-7025a6cb0000";
const ANCHOR = `talk:${TURN}`;
const ASK = "acme-home-storage-ask";
const REGISTERED = "2026-11-01T10:00:00.000Z";
const BEFORE = "2026-11-01T09:00:00.000Z";
const AFTER = "2026-11-01T11:00:00.000Z";

const LANDED: CardLandedRow = {
  anchor: ANCHOR,
  atIso: REGISTERED,
  cardKey: `ask:${ASK}`,
  decidedIso: REGISTERED,
  kind: "landed",
  source: "relay",
  words: "put the codex sign-ins in the vault too",
  workSlug: ASK,
};

/** A receipt channel that keeps nothing, for a case asserting only what was written to disk. */
const NO_LINES = (): void => undefined;

let home = "";
let dir = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "relay-work-"));
  dir = join(home, "board");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One board row's text; `settled` adds the fields `handover settle` writes. */
function rowText({
  anchor,
  settledIso,
  slug,
}: {
  anchor: string | undefined;
  settledIso?: string | undefined;
  slug: string;
}) {
  const text = askRowText({
    anchor,
    ask: "keep the home's state under one storage key",
    askedIso: "2026-10-30T04:59:00Z",
    branch: undefined,
    checkedIso: "2026-10-30T04:59:01Z",
    dispatch: true,
    finding: undefined,
    priority: undefined,
    repo: undefined,
    shape: undefined,
    slug,
  });
  if (settledIso === undefined) {
    return text;
  }
  return text.replace("---\n", `---\nsettlement: answered\nsettlementWitness: page:x\nsettledIso: ${settledIso}\n`);
}

/** The owner's words over the ask card, relayed and landed: the relay turn, its row, the ask's row and the landing. */
function answerRelay({ askSettledIso }: { askSettledIso?: string } = {}): string {
  const draft = unwrap(
    formRelayDraft({
      about: `ask:${ASK}`,
      heard: "",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "put the codex sign-ins in the vault too",
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  const claimed = unwrap(claimTurn({ draft, home, nowIso: REGISTERED })).record;
  unwrap(markRegistered({ home, nowIso: REGISTERED, record: claimed }));
  const path = join(dir, `${SLUG}.md`);
  writeFileSync(path, rowText({ anchor: ANCHOR, slug: SLUG }));
  writeFileSync(join(dir, `${ASK}.md`), rowText({ anchor: undefined, settledIso: askSettledIso, slug: ASK }));
  unwrap(appendCardLanding({ home, row: LANDED }));
  return path;
}

function startAsk({ atIso }: { atIso: string }): void {
  const event = { atIso, branch: ASK, docHash: "h", kind: "started" } as const;
  unwrap(appendRunEvent({ event, runsDir: join(home, "runs"), slug: ASK }));
}

describe("answerRelayAnchorsForWork", () => {
  it("names a relay whose landing is on this row's own ask card and names it as the work", () => {
    expect(answerRelayAnchorsForWork({ active: [LANDED, LANDED], workSlug: ASK })).toEqual([ANCHOR]);
  });

  it("names none for a transcript landing, another card, or a landing naming other work", () => {
    const active = [
      { ...LANDED, source: "transcript" as const },
      { ...LANDED, cardKey: "hand:a1b2c3" },
      { ...LANDED, workSlug: SLUG },
    ];
    expect(answerRelayAnchorsForWork({ active, workSlug: ASK })).toEqual([]);
  });
});

describe("settleRelaysForWork", () => {
  it("files the relay into the ask once the ask's run started after the relay registered", async () => {
    const path = answerRelay();
    startAsk({ atIso: AFTER });

    await settleRelaysForWork({ dir, home, out: NO_LINES, verb: "handover start", workSlug: ASK });

    const settled = readFileSync(path, "utf8");
    expect([settled.includes("\nsettlement: filed\n"), settled.includes(`\nsettlementWitness: ${ASK}\n`)]).toEqual([
      true,
      true,
    ]);
  });

  // The verb that fired the hook owns its stdout, so every receipt goes to the channel the caller named.
  it("writes every receipt line to the channel it was handed, its own settled line last", async () => {
    answerRelay();
    startAsk({ atIso: AFTER });
    const lines: string[] = [];

    await settleRelaysForWork({
      dir,
      home,
      out: ({ line }) => {
        lines.push(line);
      },
      verb: "handover start",
      workSlug: ASK,
    });

    expect(lines.at(-1)!.startsWith(`handover start: the relay row ${SLUG} is settled filed — `)).toBe(true);
    expect(lines.some((line) => line.includes(SLUG) && line !== lines.at(-1))).toBe(true);
  });

  it("leaves the relay open when the ask's run started before the owner spoke", async () => {
    const path = answerRelay();
    const before = readFileSync(path, "utf8");
    startAsk({ atIso: BEFORE });

    await settleRelaysForWork({ dir, home, out: NO_LINES, verb: "handover start", workSlug: ASK });

    expect(readFileSync(path, "utf8")).toBe(before);
  });

  // The slug keeps 12 hex digits of the turn, so another turn sharing them owns a row at the same slug.
  it("never files a row at the relay's slug that carries another turn's anchor", async () => {
    const path = answerRelay();
    const other = "7025a6cb-0000-4aaa-8aaa-aaaaaaaaaaaa";
    const colliding = `talk:${other}`;
    const draft = unwrap(
      formRelayDraft({
        about: "ask:another-ask",
        heard: "",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "a different steer over a different card",
        turnId: other,
        typed: false,
        wordsAlone: false,
      }),
    );
    unwrap(
      markRegistered({
        home,
        nowIso: REGISTERED,
        record: unwrap(claimTurn({ draft, home, nowIso: REGISTERED })).record,
      }),
    );
    writeFileSync(path, rowText({ anchor: colliding, slug: SLUG }));
    const before = readFileSync(path, "utf8");
    startAsk({ atIso: AFTER });

    await settleRelaysForWork({ dir, home, out: NO_LINES, verb: "handover start", workSlug: ASK });

    expect(before.includes(`anchor: ${colliding}`)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  // The settle finds its row by slug alone, so a second row at the slug could be the one it writes.
  it("settles neither row when another turn's row shares the relay's slug, even one sorting first", async () => {
    const path = answerRelay();
    const other = "7025a6cb-0000-4aaa-8aaa-aaaaaaaaaaaa";
    // Registered and over no card, so the settle would write its row: only the slug check stops it.
    const draft = unwrap(
      formRelayDraft({
        about: "",
        heard: "",
        picture: { kind: "none", reason: "screen-not-shared" },
        readsAfter: [],
        say: "a different steer over no card",
        turnId: other,
        typed: false,
        wordsAlone: false,
      }),
    );
    const claimed = unwrap(claimTurn({ draft, home, nowIso: REGISTERED })).record;
    unwrap(markRegistered({ home, nowIso: REGISTERED, record: claimed }));
    const wrong = join(dir, "00-wrong.md");
    writeFileSync(wrong, rowText({ anchor: `talk:${other}`, slug: SLUG }));
    const before = [readFileSync(wrong, "utf8"), readFileSync(path, "utf8")];
    startAsk({ atIso: AFTER });

    await settleRelaysForWork({ dir, home, out: NO_LINES, verb: "handover start", workSlug: ASK });

    expect([readFileSync(wrong, "utf8"), readFileSync(path, "utf8")]).toEqual(before);
  });

  it("touches no relay for a row the owner's words never landed on", async () => {
    const path = answerRelay();
    const before = readFileSync(path, "utf8");
    startAsk({ atIso: AFTER });

    await settleRelaysForWork({ dir, home, out: NO_LINES, verb: "handover start", workSlug: "another-ask" });

    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("handover settle on the ask", () => {
  it("files the answer relay into the ask it just settled", async () => {
    const path = answerRelay();
    const argv = ["node", "slopweaver", "handover", "settle", ASK, "--as", "answered", "--witness", "what I found"];

    const code = await runHandoverSettleVerb([...argv, "--dir", dir, "--home", home]);

    expect(code).toBe(EXIT_OK);
    expect(readFileSync(path, "utf8").includes(`\nsettlementWitness: ${ASK}\n`)).toBe(true);
  });
});

describe("readRelayLandingEvidence on a settled ask", () => {
  const read = () =>
    readRelayLandingEvidence({
      anchor: ANCHOR,
      handoverDir: dir,
      home,
      ledger: readRelayLandingLedger({ home }),
      relaySlug: SLUG,
    });

  it("counts a settlement written after the relay registered as action", () => {
    answerRelay({ askSettledIso: AFTER });
    expect(read()).toEqual({ action: { kind: "settlement" }, kind: "active", workSlug: ASK });
  });

  it("never counts a settlement written before the owner spoke", () => {
    answerRelay({ askSettledIso: BEFORE });
    expect(read()).toEqual({ action: undefined, kind: "active", workSlug: ASK });
  });

  // A settlement with no `settledIso` is dated by nothing the relay settle trusts, whenever the row was asked.
  it("never counts a legacy settlement carrying no instant, even on an ask dated after the owner spoke", () => {
    answerRelay();
    const legacy = rowText({ anchor: undefined, slug: ASK })
      .replace("askedIso: 2026-10-30T04:59:00Z", `askedIso: ${AFTER}`)
      .replace("---\n", "---\nsettlement: answered\nsettlementWitness: page:x\n");
    writeFileSync(join(dir, `${ASK}.md`), legacy);
    expect(legacy.includes(`askedIso: ${AFTER}`)).toBe(true);
    expect(read()).toEqual({ action: undefined, kind: "active", workSlug: ASK });
  });

  // A refused line recording another card, or a key that is no card key, cannot be this ask's landing or restore.
  it("reads past a refused line about another card or recording no real card key, and refuses on one about the ask", () => {
    answerRelay();
    startAsk({ atIso: AFTER });
    const ledger = join(home, "talk", "card-landings.jsonl");
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "ask:another-ask", kind: "restored" })}\n`);
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "ask:acme Fixture 1", kind: "restored" })}\n`);
    expect(read()).toEqual({
      action: { atIso: AFTER, eventKind: "started", kind: "run-event" },
      kind: "active",
      workSlug: ASK,
    });
    appendFileSync(ledger, `${JSON.stringify({ cardKey: `ask:${ASK}`, kind: "restored" })}\n`);
    expect(read()).toEqual({ kind: "unreadable", why: "1 line(s) of the card-landing ledger did not read" });
  });

  // A line that did not read could be a torn restore that lifted the landing, so an active one decides nothing.
  it("reads an active landing over a ledger with an unread line as unreadable, and files nothing", async () => {
    const path = answerRelay();
    startAsk({ atIso: AFTER });
    appendFileSync(join(home, "talk", "card-landings.jsonl"), "{\n");
    const before = readFileSync(path, "utf8");

    expect(read()).toEqual({ kind: "unreadable", why: "1 line(s) of the card-landing ledger did not read" });
    await settleRelaysForWork({ dir, home, out: NO_LINES, verb: "handover start", workSlug: ASK });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  // A landing on ask:A naming row B as the work never files the relay into B, however B was acted on.
  it("reads a landing on its ask that names another row as the work as inactive", () => {
    answerRelay();
    writeFileSync(join(dir, "another-ask.md"), rowText({ anchor: undefined, settledIso: AFTER, slug: "another-ask" }));
    writeFileSync(
      join(home, "talk", "card-landings.jsonl"),
      `${JSON.stringify({ ...LANDED, workSlug: "another-ask" })}\n`,
    );
    expect(read()).toEqual({ kind: "inactive" });
  });

  // Only a landing `talk relay` wrote is the relay's own — a transcript one carrying its anchor never files it.
  it("reads a transcript landing carrying the relay's anchor as inactive", () => {
    answerRelay({ askSettledIso: AFTER });
    writeFileSync(
      join(home, "talk", "card-landings.jsonl"),
      `${JSON.stringify({ ...LANDED, source: "transcript" })}\n`,
    );
    expect(read()).toEqual({ kind: "inactive" });
  });

  it("reads a relay whose turn is not on disk as unreadable, never as one over no ask", () => {
    answerRelay();
    const evidence = readRelayLandingEvidence({
      anchor: "talk:00000000-0000-4000-8000-000000000000",
      handoverDir: dir,
      home,
      ledger: readRelayLandingLedger({ home }),
      relaySlug: "talk-000000000000",
    });
    expect(evidence.kind).toBe("unreadable");
  });
});
