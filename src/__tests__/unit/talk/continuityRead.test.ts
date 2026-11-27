/*
 * The mint's fresh read, over a throwaway home laid out the way the real one is: a relay's turn file, the row it
 * created with a settlement, an intake mark, and run journals carrying rulings. It proves the read finds a
 * relay's outcome by the row's exact slug, keeps a ruling only from a journal written inside the window, and
 * names the lessons half unread when the mint skips it — never as "no lessons".
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readContinuity } from "../../../talk/continuityRead.js";
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
      typedCalls: "keep",
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
      typedCalls: "keep",
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
      typedCalls: "keep",
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
      typedCalls: "keep",
    });
    expect(read.calls.map((kept) => [kept.callId, kept.lines.map((line) => line.text)])).toEqual([
      [call, ["and merge the"]],
    ]);
  });

  it("reads a typed conversation for the owner's mint and never for a test call's", async () => {
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
    const readFor = async ({ typedCalls }: { typedCalls: "keep" | "drop" }): Promise<readonly string[]> => {
      const read = await readContinuity({
        handoverDir,
        home,
        knowledge: "skip",
        lookbackMs: WINDOW_MS,
        nowIso: NOW,
        supervisor: NO_CHAT,
        typedCalls,
      });
      return read.calls.map((kept) => kept.callId).toSorted();
    };
    expect(await readFor({ typedCalls: "keep" })).toEqual([spoken, typed]);
    expect(await readFor({ typedCalls: "drop" })).toEqual([spoken]);
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
      typedCalls: "keep",
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
      typedCalls: "keep",
    });
    expect(read.unread.map((entry) => entry.section)).toEqual(["steers", "typed", "calls", "rulings", "knowledge"]);
    expect(read.unread[0]!.why).toContain("the read threw: TypeError");
  });
});
