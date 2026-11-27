/*
 * The mint's fresh read, over a throwaway home laid out the way the real one is: a relay's turn file, the row it
 * created with a settlement, an intake mark, and run journals carrying rulings. It proves the read finds a
 * relay's outcome by the row's exact slug, keeps a ruling only from a journal written inside the window, and
 * names the lessons half unread when the mint skips it — never as "no lessons".
 *
 * The read no longer drops typed conversations for a test call's mint: that mint reads nothing of the owner's at all
 * (`src/talk/mintContext.ts`), so the drop case went out with the filter it held down.
 * deleted-with-code: callsForMint
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { readCalls } from "../../../talk/callStore.js";
import { newestSpokenOf } from "../../../talk/continuityCalls.js";
import { readContinuity, readTestCalls } from "../../../talk/continuityRead.js";
import { reopenReminderFrom } from "../../../talk/reopenReminder.js";
import type { SupervisorWindow } from "../../../talk/supervisorWindow.js";

const TURN = "47aaaedf-b2e5-4c11-8a22-9b33c44d55e6";
const SLUG = "talk-47aaaedfb2e5";
const REGISTERED = "2026-09-24T17:02:33.307Z";
const NOW = "2026-09-24T17:30:00.000Z";
const WINDOW_MS = 72 * 60 * 60 * 1000;
const NO_CHAT = "no supervisor pinned";

let home: string;
let handoverDir: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-continuity-"));
  handoverDir = join(home, "handovers");
  for (const dir of [handoverDir, join(home, "talk", "turns"), join(home, "runs"), join(home, "sessions")]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    join(home, "talk", "turns", `${TURN}.json`),
    JSON.stringify({
      about: "",
      anchor: `talk:${TURN}`,
      delivery: { atIso: REGISTERED, detail: "typed into the supervisor's chat (workspace:93)", kind: "typed" },
      digest: "d",
      heard: "it's definitely on you to resolve merge conflicts, especially markdown",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      registeredAtIso: REGISTERED,
      slug: SLUG,
      stagedAtIso: REGISTERED,
      state: "registered",
      turnId: TURN,
      words: "Merge conflicts are the fleet's to resolve; never card a markdown conflict to me.",
    }),
  );
  writeFileSync(
    join(handoverDir, `${SLUG}.md`),
    [
      "---",
      `slug: ${SLUG}`,
      "kind: ask",
      'summary: "Words about merge conflicts"',
      "status: ready",
      `askedIso: ${REGISTERED}`,
      `anchor: talk:${TURN}`,
      "priority: p1",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      "settlement: answered",
      "settlementWitness: ruling recorded as an owner knowledge row; conflicts dispatched to a seat",
      "---",
      "",
      "# Words about merge conflicts",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(home, "runs", "recent-row.jsonl"),
    `${JSON.stringify({ anchor: "talk:x", atIso: "2026-09-24T12:00:00.000Z", kind: "ruling", ruling: "conflicts are yours" })}\n`,
  );
  const stale = join(home, "runs", "stale-row.jsonl");
  writeFileSync(
    stale,
    `${JSON.stringify({ anchor: "talk:y", atIso: "2026-09-24T13:00:00.000Z", kind: "ruling", ruling: "never read" })}\n`,
  );
  // Written before the window opened: a journal is append-only, so the read never decodes it.
  const before = new Date(Date.parse(NOW) - WINDOW_MS - 60_000);
  utimesSync(stale, before, before);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readContinuity", () => {
  it("reads the relay with the outcome its row records", async () => {
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: NO_CHAT,
    });
    expect(read.steers.map((steer) => [steer.slug, steer.outcome.settlement])).toEqual([
      [
        SLUG,
        { kind: "answered", witness: "ruling recorded as an owner knowledge row; conflicts dispatched to a seat" },
      ],
    ]);
  });

  it("keeps a ruling only from a journal written inside the window", async () => {
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: NO_CHAT,
    });
    expect(read.rulings.map((ruling) => `${ruling.slug}:${ruling.ruling}`)).toEqual(["recent-row:conflicts are yours"]);
  });

  it("names the lessons unread when the mint skips them, and the typed half when no chat was read", async () => {
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: NO_CHAT,
    });
    expect(read.unread).toEqual([
      { section: "typed", why: NO_CHAT },
      { section: "knowledge", why: "not read at mint — call knowledge or recent_steers for the lessons" },
    ]);
  });

  it("reads a call written after the relay, with the owner's words the relay never carried", async () => {
    const call = "a0000041-0000-4000-8000-000000000044";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      [
        { atIso: "2026-09-24T17:10:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "marin" },
        {
          atIso: "2026-09-24T17:11:00.000Z",
          final: false,
          id: "s-1",
          kind: "segment",
          text: "and merge the",
          who: "owner",
        },
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: NO_CHAT,
    });
    expect(read.calls.map((kept) => [kept.callId, kept.lines.map((line) => line.text)])).toEqual([
      [call, ["and merge the"]],
    ]);
  });

  it("reads the owner's typed conversations beside their spoken calls", async () => {
    const spoken = "a0000041-0000-4000-8000-000000000051";
    const typed = "a0000041-0000-4000-8000-000000000052";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    const callFile = ({ surface, words }: { surface: "voice" | "typed"; words: string }): string =>
      [
        { atIso: "2026-09-24T17:10:00.000Z", kind: "open", model: "m", sessionId: "sess", surface, voice: "marin" },
        { atIso: "2026-09-24T17:11:00.000Z", final: true, id: "s-1", kind: "segment", text: words, who: "owner" },
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join("");
    writeFileSync(join(home, "talk", "calls", `${spoken}.jsonl`), callFile({ surface: "voice", words: "spoken line" }));
    writeFileSync(join(home, "talk", "calls", `${typed}.jsonl`), callFile({ surface: "typed", words: "typed line" }));
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: NO_CHAT,
    });
    expect(read.calls.map((kept) => kept.callId).toSorted()).toEqual([spoken, typed]);
  });

  it("reports a relay whose row is gone as present on no row", async () => {
    rmSync(join(handoverDir, `${SLUG}.md`));
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: NO_CHAT,
    });
    expect(read.steers.map((steer) => steer.outcome.rowPresent)).toEqual([false]);
  });

  it("resolves with every half named unread when a half throws, so the mint still connects", async () => {
    // A window whose exchanges are missing makes the typed half throw inside the read.
    const broken = { note: "", omitted: 0, sessionId: "s" } as unknown as SupervisorWindow;
    const read = await readContinuity({
      handoverDir,
      home,
      knowledge: "skip",
      lookbackMs: WINDOW_MS,
      nowIso: NOW,
      supervisor: broken,
    });
    expect(read.unread.map((entry) => entry.section)).toEqual(["steers", "typed", "calls", "rulings", "knowledge"]);
    expect(read.unread[0]!.why).toContain("the read threw: TypeError");
  });
});

/*
 * Review r2 on the test-instance mint change: the armed `call-reopen` arm read every recent call file and counted ANY
 * unreadable one as `unread`, so a damaged call of the owner's switched the test call's reopen reminder off. The fixture
 * holds both: a readable test call that ended forty seconds before the mint, and an owner call file none of whose
 * lines parse. The first assertion is the witness that the owner's file really is unreadable to the read.
 */
describe("readTestCalls", () => {
  const TEST_CALL = "a0000041-0000-4000-8000-000000000061";
  const OWNER_CALL = "a0000041-0000-4000-8000-000000000062";
  const ENDED = "2026-09-24T17:29:20.000Z";

  it("keeps an unreadable owner call file from switching the test call's reopen reminder off", () => {
    const calls = join(home, "talk", "calls");
    mkdirSync(calls, { recursive: true });
    const origin = {
      checkoutRoot: "/checkouts/acme",
      defaultPort: 3000,
      instance: "e2e",
      mainWorktree: true,
      port: 3000,
    };
    writeFileSync(
      join(calls, `${TEST_CALL}.jsonl`),
      [
        { atIso: "2026-09-24T17:29:00.000Z", kind: "open", model: "m", origin, sessionId: "s", voice: "marin" },
        {
          atIso: "2026-09-24T17:29:05.000Z",
          final: true,
          id: "s-1",
          kind: "segment",
          text: "the walk's line",
          who: "owner",
        },
        {
          atIso: "2026-09-24T17:29:10.000Z",
          final: true,
          id: "s-2",
          kind: "segment",
          text: "the voice's answer",
          who: "voice",
        },
        { atIso: ENDED, kind: "closed", why: null },
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    writeFileSync(join(calls, `${OWNER_CALL}.jsonl`), "not json\nnor this\n");
    const sinceIso = new Date(Date.parse(NOW) - WINDOW_MS).toISOString();
    expect(unwrap(readCalls({ home, keep: { sinceIso } })).unreadable).toEqual([
      `${OWNER_CALL}: none of its 2 line(s) parsed`,
    ]);
    const test = readTestCalls({ home, sinceIso });
    expect(test.unread).toBe(false);
    expect(test.calls.map((call) => call.callId)).toEqual([TEST_CALL]);
    const reminder = reopenReminderFrom({
      builtIso: NOW,
      callsUnread: test.unread,
      last: newestSpokenOf({ calls: test.calls }),
      mode: "fresh",
    })!;
    expect([reminder.previousCallId, reminder.previousEndedIso]).toEqual([TEST_CALL, ENDED]);
  });

  it("reads the test calls unread when the call directory itself cannot be listed", () => {
    // A file where the directory belongs makes the listing fail, not just one file in it.
    mkdirSync(join(home, "talk"), { recursive: true });
    writeFileSync(join(home, "talk", "calls"), "");
    const test = readTestCalls({ home, sinceIso: new Date(Date.parse(NOW) - WINDOW_MS).toISOString() });
    expect(test).toEqual({ calls: [], unread: true });
  });
});
