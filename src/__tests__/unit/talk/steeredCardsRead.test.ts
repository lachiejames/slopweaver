/*
 * `talk steers` over a real home: receipts, landings, marks and ticks written to a temp dir and read back. Pins the
 * exact joins — the relay's own landing on the card it named, never another card's — and that a source which does
 * not read is never reported as nothing done.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { IntakeMark } from "../../../supervisor/intake.js";
import { buildIntakeMark } from "../../../supervisor/intakeMarkLine.js";
import { appendIntakeMark } from "../../../supervisor/intakeStore.js";
import { supervisorTickLedgerPath } from "../../../supervisor/tickStore.js";
import type { CardLandingRow } from "../../../talk/cardLanding.js";
import type { TurnRecord } from "../../../talk/relayStore.js";
import { checkInRuling, relayLanding } from "../../../talk/steeredCardsEvidence.js";
import { readSteeredCards, steerReceipts } from "../../../talk/steeredCardsRead.js";
import { readTickTail } from "../../../talk/steeredCardsTicks.js";
import {
  AUTONOMY_FIXTURE_OUTAGE,
  memoryAutonomyLedgerPort,
  seedAutonomyRecords,
  unavailableAutonomyLedgerPort,
} from "../../autonomyLedgerFixture.js";

const TURN = "ed674c0e-d0f9-49da-8764-42c1b8fce1e6";
const ANCHOR = `talk:${TURN}`;
const SLUG = "talk-ed674c0ed0f9";
const CARD = "pr:acme.widgets.1779";
const REGISTERED = "2026-10-04T00:36:59.000Z";
const NOW = "2026-10-04T00:40:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "steers-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One relay receipt, overridable field by field. */
const receipt = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  about: CARD,
  anchor: ANCHOR,
  delivery: null,
  digest: "d",
  heard: "collapse the card once I've steered it",
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: REGISTERED,
  slug: SLUG,
  stagedAtIso: REGISTERED,
  state: "registered",
  turnId: TURN,
  typed: false,
  words: "collapse the card once I've steered it",
  wordsAlone: false,
  ...over,
});

/** Append one JSON line to a ledger under the home. */
const appendLine = ({ path, value }: { path: string; value: unknown }): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`);
};

const landingsPath = (): string => join(dirname(stateHomePaths({ home }).talkTurns), "card-landings.jsonl");

/** The relay's own landing on a card. */
const landed = ({ cardKey = CARD }: { cardKey?: string } = {}): CardLandingRow => ({
  anchor: ANCHOR,
  atIso: REGISTERED,
  cardKey,
  decidedIso: REGISTERED,
  kind: "landed",
  source: "relay",
  words: "collapse the card once I've steered it",
  workSlug: SLUG,
});

/** One board row, settled when `settled` is set. */
const writeDoc = ({
  slug,
  anchor,
  askedIso,
  settled = false,
}: {
  slug: string;
  anchor: string;
  askedIso: string;
  settled?: boolean;
}): void => {
  const { handovers } = stateHomePaths({ home });
  mkdirSync(handovers, { recursive: true });
  const settlement = settled ? ["settlement: answered", "settlementWitness: answered in the thread"] : [];
  writeFileSync(
    join(handovers, `${slug}.md`),
    [
      "---",
      `slug: ${slug}`,
      "kind: ask",
      'summary: "Collapse a steered card"',
      "status: ready",
      `askedIso: ${askedIso}`,
      `anchor: ${anchor}`,
      "priority: p1",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      ...settlement,
      "---",
      "",
      "# Collapse a steered card",
      "",
    ].join("\n"),
  );
};

/** Read at an instant, over an autonomy ledger (a fresh in-memory one unless a test hands its own). */
const read = async ({
  nowIso = NOW,
  ledger = memoryAutonomyLedgerPort(),
}: { nowIso?: string; ledger?: AutonomyLedgerPort } = {}) =>
  readSteeredCards({ handoverDir: stateHomePaths({ home }).handovers, home, ledger, nowIso });

describe("readSteeredCards", () => {
  it("reads an empty home as no steers", async () => {
    expect(unwrap(await read()).steers).toEqual([]);
  });

  it("counts the relay lines that did not decode, so a missing steer is never read as unrecorded", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: { turnId: TURN } });
    expect(unwrap(await read())).toEqual({
      observedAtIso: NOW,
      sinceIso: "2026-09-27T00:40:00.000Z",
      steers: [],
      undecodedRelays: 1,
    });
  });

  it("counts a receipt anchored on another turn as undecoded, never joining that turn's evidence", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt({ anchor: "talk:another-turn" }) });
    expect(unwrap(await read())).toEqual({
      observedAtIso: NOW,
      sinceIso: "2026-09-27T00:40:00.000Z",
      steers: [],
      undecodedRelays: 1,
    });
  });

  it("awaits a landed relay nothing has acted on", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    const [steer] = unwrap(await read()).steers;
    expect(steer).toEqual({
      cardKey: CARD,
      heard: "collapse the card once I've steered it",
      registeredAtIso: REGISTERED,
      relaySlug: SLUG,
      turnId: TURN,
      verdict: { kind: "awaiting" },
    });
  });

  it("settles on an intake mark on the relay's pointer", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    const built = buildIntakeMark({
      bySession: { host: "claude-code", id: "s" },
      kind: "card",
      markedAtIso: "2026-10-04T00:38:00.000Z",
      pointer: ANCHOR,
      witness: "ask:a-queue-card-just-steered-on",
    });
    expect("mark" in built).toBe(true);
    appendIntakeMark({ home, mark: (built as { readonly mark: IntakeMark }).mark });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      action: {
        atIso: "2026-10-04T00:38:00.000Z",
        kind: "intake-mark",
        markKind: "card",
        witness: "ask:a-queue-card-just-steered-on",
      },
      kind: "settled",
    });
  });

  it("brings it back after the first pass that started after it", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    const ticks = supervisorTickLedgerPath({ home });
    appendLine({
      path: ticks,
      value: { finalisedIso: "2026-10-04T00:37:30.000Z", startedIso: "2026-10-04T00:30:00.000Z" },
    });
    appendLine({
      path: ticks,
      value: { finalisedIso: "2026-10-04T00:39:00.000Z", startedIso: "2026-10-04T00:38:00.000Z" },
    });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      kind: "reverted",
      passFinalisedIso: "2026-10-04T00:39:00.000Z",
      reason: "missed-pass",
    });
  });

  it("does not take a landing on another card as this relay's", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed({ cardKey: "pr:acme.widgets.1780" }) });
    expect(unwrap(await read({ nowIso: "2026-10-04T00:45:00.000Z" })).steers[0]!.verdict).toEqual({
      kind: "reverted",
      reason: "landing-missing",
    });
  });

  it("reads no landing in a ledger with an unreadable line as unread, never as a landing that is missing", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    mkdirSync(dirname(landingsPath()), { recursive: true });
    appendFileSync(landingsPath(), '{"kind":"landed","cardKey":"pr:17\n');
    expect(unwrap(await read({ nowIso: "2026-10-04T00:45:00.000Z" })).steers[0]!.verdict).toEqual({
      kind: "unread",
      why: "1 line(s) of the card-landings ledger did not read",
    });
  });

  // A refused line about another card, or recording a key that is no card key, cannot hide this steer's landing.
  it("judges a steer as if a refused line about another card, or recording no real card key, were not there", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: { cardKey: "pr:acme.widgets.1780", kind: "landed" } });
    appendLine({ path: landingsPath(), value: { cardKey: "pr:acme.Fixture 1.1779", kind: "landed" } });
    expect(unwrap(await read({ nowIso: "2026-10-04T00:45:00.000Z" })).steers[0]!.verdict).toEqual({
      kind: "reverted",
      reason: "landing-missing",
    });
    appendLine({ path: landingsPath(), value: { cardKey: CARD, kind: "landed" } });
    expect(unwrap(await read({ nowIso: "2026-10-04T00:45:00.000Z" })).steers[0]!.verdict).toEqual({
      kind: "unread",
      why: "1 line(s) of the card-landings ledger did not read",
    });
  });

  it("reads a landed, unacted steer as unread when a ledger line did not read, since it may be the restore", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    appendFileSync(landingsPath(), '{"kind":"restored","cardKey":"pr:17\n');
    appendLine({
      path: supervisorTickLedgerPath({ home }),
      value: { finalisedIso: "2026-10-04T00:39:00.000Z", startedIso: "2026-10-04T00:38:00.000Z" },
    });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      kind: "unread",
      why: "1 line(s) of the card-landings ledger did not read",
    });
  });

  it("reports a kept restore with its reason", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    appendLine({
      path: landingsPath(),
      value: {
        anchor: ANCHOR,
        atIso: "2026-10-04T00:38:00.000Z",
        cardKey: CARD,
        disposition: "kept",
        kind: "restored",
        why: "answered, the PR still needs the owner's review",
        workSlug: SLUG,
      },
    });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      kind: "reverted",
      reason: "kept",
      why: "answered, the PR still needs the owner's review",
    });
  });

  it("refuses rather than reports nothing when a tick row in the tail is not one", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    appendLine({ path: supervisorTickLedgerPath({ home }), value: { tickId: "t" } });
    expect(unwrap(await read()).steers[0]!.verdict.kind).toBe("unread");
  });

  it("never takes a settlement on a landed row asked before the relay as action on it", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt({ about: "ask:old-ask" }) });
    appendLine({ path: landingsPath(), value: { ...landed({ cardKey: "ask:old-ask" }), workSlug: "old-ask" } });
    writeDoc({ anchor: "transcript:older", askedIso: "2026-10-03T00:00:00.000Z", settled: true, slug: "old-ask" });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({ kind: "awaiting" });
  });

  it("takes a settlement on a landed row asked after the relay registered as action on it", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt({ about: "ask:new-ask" }) });
    appendLine({ path: landingsPath(), value: { ...landed({ cardKey: "ask:new-ask" }), workSlug: "new-ask" } });
    writeDoc({ anchor: "transcript:newer", askedIso: "2026-10-04T00:38:00.000Z", settled: true, slug: "new-ask" });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({ action: { kind: "settlement" }, kind: "settled" });
  });

  it("reads a run journal with an unreadable line and no action as unread, never as nothing done", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    writeDoc({ anchor: ANCHOR, askedIso: REGISTERED, slug: SLUG });
    const { runs } = stateHomePaths({ home });
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, `${SLUG}.jsonl`), '{"kind":"ruling","atIso":"2026-10-04T00:38\n');
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      kind: "unread",
      why: `1 line(s) of the run journal of ${SLUG} did not read`,
    });
  });

  it("reads a run event whose instant does not parse as unread, never as no action", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    writeDoc({ anchor: ANCHOR, askedIso: REGISTERED, slug: SLUG });
    const { runs } = stateHomePaths({ home });
    appendLine({
      path: join(runs, `${SLUG}.jsonl`),
      value: { atIso: "not-a-date", by: "supervisor", kind: "dispatched" },
    });
    appendLine({
      path: supervisorTickLedgerPath({ home }),
      value: { finalisedIso: "2026-10-04T00:39:00.000Z", startedIso: "2026-10-04T00:38:00.000Z" },
    });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      kind: "unread",
      why: `1 line(s) of the run journal of ${SLUG} did not read`,
    });
  });

  it("settles on readable action on the landing's row beside an unreadable journal on the relay's own", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt({ about: "ask:new-ask" }) });
    appendLine({ path: landingsPath(), value: { ...landed({ cardKey: "ask:new-ask" }), workSlug: "new-ask" } });
    writeDoc({ anchor: ANCHOR, askedIso: REGISTERED, slug: SLUG });
    writeDoc({ anchor: "transcript:newer", askedIso: "2026-10-04T00:38:00.000Z", settled: true, slug: "new-ask" });
    const { runs } = stateHomePaths({ home });
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, `${SLUG}.jsonl`), '{"kind":"ruling","atIso":"2026-10-04T00:38\n');
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({ action: { kind: "settlement" }, kind: "settled" });
  });

  it("refuses a tick row whose instant does not parse, rather than reading it as no pass", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt() });
    appendLine({ path: landingsPath(), value: landed() });
    appendLine({
      path: supervisorTickLedgerPath({ home }),
      value: { finalisedIso: "2026-10-04T00:30:00.000Z", startedIso: "not-an-iso" },
    });
    expect(unwrap(await read()).steers[0]!.verdict).toEqual({
      kind: "unread",
      why: "the chair's tick ledger did not read, so whether a pass has run is unknown",
    });
  });

  it("settles a check-in steer on the owner's word the autonomy ledger holds", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt({ about: "act:ev-b" }) });
    appendLine({ path: landingsPath(), value: landed({ cardKey: "act:ev-b" }) });
    const ledger = memoryAutonomyLedgerPort();
    await seedAutonomyRecords({
      port: ledger,
      records: [
        {
          actionId: "ev-b",
          bySession: "workspace:1",
          doneIso: "2026-10-04T00:00:00.000Z",
          kind: "push-back-on-coderabbit",
          subject: "https://github.com/acme/acme-admin/pull/1",
          why: "the comment asked for a guard the caller already holds",
          witness: "slopweaver github comment reply -> posted",
        },
        { actionId: "ev-b", bySession: `talk:${TURN}`, steer: "leave it", steeredIso: "2026-10-04T00:40:00.000Z" },
      ],
    });
    expect(unwrap(await read({ ledger })).steers[0]!.verdict).toEqual({
      action: { atIso: "2026-10-04T00:40:00.000Z", kind: "check-in-ruling" },
      kind: "settled",
    });
  });

  it("refuses the whole reading when the autonomy ledger's store is down, never reads it as no ruling", async () => {
    appendLine({ path: stateHomePaths({ home }).talkRelaysJsonl, value: receipt({ about: "act:b" }) });
    appendLine({ path: landingsPath(), value: landed({ cardKey: "act:b" }) });
    const refused = unwrapErr(await read({ ledger: unavailableAutonomyLedgerPort() }));
    expect(refused).toEqual({
      code: "STEER_SOURCE_UNREADABLE",
      message: `the autonomy ledger did not read: ${AUTONOMY_FIXTURE_OUTAGE.message}`,
      source: "the autonomy ledger",
    });
  });
});

describe("steerReceipts", () => {
  it("keeps a relay naming a card inside the window, once per turn", () => {
    const rows = [
      receipt(),
      receipt({ about: "", turnId: "none" }),
      receipt({ about: "recipe:nightly", turnId: "automation" }),
      receipt({ registeredAtIso: "2026-09-01T00:00:00.000Z", turnId: "old" }),
    ];
    expect(steerReceipts({ rows, sinceMs: Date.parse("2026-09-27T00:00:00.000Z") }).map((one) => one.turnId)).toEqual([
      TURN,
    ]);
  });

  it("keeps one receipt per turn AND card, so a turn receipted on two cards hides neither", () => {
    const rows = [receipt(), receipt(), receipt({ about: "pr:acme.widgets.1780" })];
    expect(
      steerReceipts({ rows, sinceMs: Date.parse("2026-09-27T00:00:00.000Z") }).map((one) => [one.turnId, one.about]),
    ).toEqual([
      [TURN, CARD],
      [TURN, "pr:acme.widgets.1780"],
    ]);
  });
});

describe("checkInRuling", () => {
  const ruled = { actionId: "b", bySession: `talk:${TURN}`, steer: "leave it", steeredIso: "2026-10-04T00:40:00.000Z" };

  it("settles the act card the steer row names, and never another the same turn named", () => {
    expect(checkInRuling({ checkIns: [ruled], receipt: receipt({ about: "act:b" }) })).toEqual({
      atIso: "2026-10-04T00:40:00.000Z",
      kind: "check-in-ruling",
    });
    expect(checkInRuling({ checkIns: [ruled], receipt: receipt({ about: "act:a" }) })).toBe(undefined);
  });
});

describe("relayLanding", () => {
  const restore = ({ why }: { why: string }): CardLandingRow => ({
    anchor: "transcript:restore",
    atIso: REGISTERED,
    cardKey: CARD,
    kind: "restored",
    why,
  });
  const other: CardLandingRow = { ...landed(), anchor: "talk:other", workSlug: "talk-other" };

  it("names the restore that lifted THIS relay's landing, never a later one that lifted another's", () => {
    const rows = [landed(), restore({ why: "first reason" }), other, restore({ why: "second reason" })];
    expect(relayLanding({ active: [], anchor: ANCHOR, cardKey: CARD, rows })).toEqual({
      kept: false,
      kind: "lifted",
      why: "first reason",
    });
  });

  it("names the restore after THIS relay's first landing, so a late duplicate landing cannot hide it", () => {
    const rows = [landed(), restore({ why: "the lift" }), landed()];
    expect(relayLanding({ active: [], anchor: ANCHOR, cardKey: CARD, rows })).toEqual({
      kept: false,
      kind: "lifted",
      why: "the lift",
    });
  });
});

describe("readTickTail", () => {
  it("reads a ledger never written as no passes, and each whole row as one", () => {
    const path = supervisorTickLedgerPath({ home });
    expect(unwrap(readTickTail({ path }))).toEqual([]);
    appendLine({ path, value: { finalisedIso: "2026-10-04T00:39:00.000Z", startedIso: "2026-10-04T00:38:00.000Z" } });
    expect(unwrap(readTickTail({ path }))).toEqual([
      { finalisedIso: "2026-10-04T00:39:00.000Z", startedIso: "2026-10-04T00:38:00.000Z" },
    ]);
  });

  it("refuses a row whose instant does not parse, naming it malformed", () => {
    const path = supervisorTickLedgerPath({ home });
    appendLine({ path, value: { finalisedIso: "later", startedIso: "2026-10-04T00:38:00.000Z" } });
    expect(unwrapErr(readTickTail({ path }))).toEqual({
      code: "TICK_ROW_MALFORMED",
      message: "a tick ledger row in the tail carries an instant that does not parse",
    });
  });
});
