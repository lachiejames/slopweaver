/*
 * The Fleet page's session cards: only `working` seats, the supervisor first, each with one short plain title, the
 * chips a Queue card carries, the phase always `phase not read`, and the panel's properties exactly the ones the
 * owner's ruling kept.
 */
import { describe, expect, it } from "vitest";

import type { Reading } from "../../components/live/reading";
import type { Seat, Seats } from "../../components/live/readNow";
import type { Placed } from "../../components/live/readWorkstreams";
import type { ReconcilePlacements } from "../../lib/nowSeats";
import {
  firstClause,
  goalWords,
  livenessOf,
  phaseWords,
  plainTitle,
  sessionPropertiesOf,
  transcriptIdOf,
  type WorkingSessionCard,
  workingSessionsOf,
} from "../../lib/workingSessions";

/** A seat as `session watch` prints one. */
const seat = ({ ref, signal, ...over }: { ref: string; signal: string } & Partial<Seat>): Seat => ({
  attentionKind: undefined,
  cwd: `/w/${ref}`,
  host: "claude",
  lastActivityAtIso: undefined,
  lastEventName: "agent.hook.PostToolUse",
  manager: false,
  mapped: true,
  openedAtIso: undefined,
  quietMinutes: 2,
  sessionId: undefined,
  sessionTitle: undefined,
  signal,
  title: `cmux ${ref}`,
  toolCalls: 41,
  workspaceId: `id-${ref}`,
  workspaceRef: ref,
  ...over,
});

/** One placement of a session on a row standing where the test says, its label the doc's whole summary. */
const placed = ({
  session,
  standing,
  label = `outcome for ${session}`,
}: {
  session: string;
  standing: string;
  label?: string;
}): Placed => ({
  rank: 1,
  row: {
    groomed: true,
    id: `row-${session}`,
    kind: "doc",
    label,
    openedIso: undefined,
    priority: "p1",
    ready: false,
    standing,
    waitingHours: 0,
  },
  session,
});

/** A seats reading holding these rows. */
const seats = ({ rows }: { rows: readonly Seat[] }): Reading<Seats> => ({
  by: "tick-1",
  observedAtIso: "2026-10-09T16:00:00.000Z",
  readingId: "r-seats",
  recordedAtIso: "2026-10-09T16:00:00.000Z",
  value: {
    diagnostics: [],
    observedAtIso: "2026-10-09T16:00:00.000Z",
    rows,
    suppressed: 0,
    suppressedOldestQuietMinutes: undefined,
  },
});

/** The same tick's reconcile reading, placing these sessions; `by` other than `tick-1` makes it another tick's. */
const reconcile = ({
  aligned,
  by = "tick-1",
}: {
  aligned: readonly Placed[];
  by?: string;
}): Reading<ReconcilePlacements> => ({
  by,
  observedAtIso: "2026-10-09T16:00:55.000Z",
  readingId: "r-reconcile",
  recordedAtIso: "2026-10-09T16:00:55.000Z",
  value: { aligned, fleet: "observed", misaligned: [], unprioritised: [] },
});

const TITLED = seat({
  ref: "workspace:1",
  sessionId: "claude-07f92f28-f7e7-4bbc-9845-c9b4ef51d520",
  sessionTitle: "Board ready set read failure",
  signal: "working",
  title: "✳ Board ready set read failure",
});
const ASKING = seat({ ref: "workspace:2", signal: "needs-input" });
const IDLE = seat({ ref: "workspace:3", signal: "idle" });
const CMUX = seat({ ref: "workspace:4", signal: "working", title: "⠂ Orb palettes from colour theory" });
const SUPERVISOR = seat({ manager: true, ref: "workspace:5", signal: "working", title: "/slopweaver:supervisor" });
const SLUGGED = seat({ ref: "workspace:6", signal: "working", title: "ruling-on-call-handover-slug" });
const UNTITLED = seat({ ref: "workspace:7", signal: "working", title: undefined });

/** The view over every seat above, the board joined with three of them placed. */
const view = workingSessionsOf({
  boardRows: undefined,
  reconcileReading: reconcile({
    aligned: [
      placed({ session: "workspace:1", standing: "in-flight" }),
      placed({ session: "workspace:4", standing: "waiting-on-owner" }),
      placed({ session: "workspace:5", standing: "in-flight" }),
      placed({
        label: "The fleet page's cards read badly: one short title. Then the rest",
        session: "workspace:6",
        standing: "in-flight",
      }),
    ],
  }),
  seatReading: seats({ rows: [TITLED, ASKING, IDLE, CMUX, SUPERVISOR, SLUGGED, UNTITLED] }),
});

describe("workingSessionsOf", () => {
  it("keeps only working seats — one whose row waits on the owner included — with the supervisor first, else in reading order", () => {
    expect(view.cards.map((card) => card.key)).toEqual([
      "id-workspace:5",
      "id-workspace:1",
      "id-workspace:4",
      "id-workspace:6",
      "id-workspace:7",
    ]);
  });

  it("titles the supervisor `Supervisor`, then a session by its own title, its plain cmux title, its row's first clause, else outcome not read", () => {
    expect(view.cards.map((card) => [card.title, card.titleSource])).toEqual([
      ["Supervisor", "supervisor"],
      ["Board ready set read failure", "session-title"],
      ["Orb palettes from colour theory", "cmux-title"],
      ["The fleet page's cards read badly", "board-summary"],
      ["outcome not read", "not-read"],
    ]);
  });

  it("never takes a title from a board reading it could not join, and names why", () => {
    const untrusted = workingSessionsOf({
      boardRows: undefined,
      reconcileReading: reconcile({
        aligned: [placed({ session: "workspace:6", standing: "in-flight" })],
        by: "tick-0",
      }),
      seatReading: seats({ rows: [SLUGGED] }),
    });
    expect([untrusted.cards.map((card) => [card.title, card.titleSource]), untrusted.joinGap]).toEqual([
      [["outcome not read", "not-read"]],
      "different-tick",
    ]);
  });

  it("takes a placed card's row off its placement, else the one board row its spawned worktree is named for, else none", () => {
    const READY = { kind: "ask", priority: "p2", slug: "the-board-s-ready-set-does-not-read" };
    const working = ({ ref, cwd }: { ref: string; cwd: string }): Seat => seat({ cwd, ref, signal: "working" });
    const joined = workingSessionsOf({
      boardRows: [
        READY,
        { kind: "doc", priority: "p0", slug: "twice" },
        { kind: "ask", priority: "p1", slug: "twice" },
      ],
      reconcileReading: reconcile({ aligned: [placed({ session: "workspace:1", standing: "in-flight" })] }),
      seatReading: seats({
        rows: [
          TITLED,
          working({ cwd: "/r/.claude/worktrees/the-board-s-ready-set-does-not-read", ref: "workspace:8" }),
          working({ cwd: "/r/.claude/worktrees.noindex/the-board-s-ready-set-does-not-read/site", ref: "workspace:9" }),
          working({ cwd: "/r/elsewhere/the-board-s-ready-set-does-not-read", ref: "workspace:10" }),
          working({ cwd: "/r/.claude/worktrees/twice", ref: "workspace:11" }),
        ],
      }),
    });
    expect(joined.cards.map((card) => card.row)).toEqual([
      { kind: "doc", priority: "p1", slug: "row-workspace:1" },
      READY,
      READY,
      undefined,
      undefined,
    ]);
  });

  it("opens a transcript by the bare uuid under cmux's `claude-` prefix, and by none for another host's id", () => {
    expect([view.cards[1].transcriptId, view.cards[0].transcriptId]).toEqual([
      "07f92f28-f7e7-4bbc-9845-c9b4ef51d520",
      undefined,
    ]);
  });

  it("projects every card's phase as not read, and reads a manager flag only when the verb said true", () => {
    expect([view.cards.map((card) => card.phase.kind), view.cards.map((card) => card.manager), view.joinGap]).toEqual([
      ["not-read", "not-read", "not-read", "not-read", "not-read"],
      [true, false, false, false, false],
      undefined,
    ]);
  });

  it("pins no supervisor off a reading that predates the manager flag, and never titles one by its slash command", () => {
    const older = workingSessionsOf({
      boardRows: undefined,
      reconcileReading: undefined,
      seatReading: seats({ rows: [CMUX, { ...SUPERVISOR, manager: undefined }] }),
    });
    expect(older.cards.map((card) => [card.key, card.manager, card.title])).toEqual([
      ["id-workspace:4", false, "Orb palettes from colour theory"],
      ["id-workspace:5", false, "outcome not read"],
    ]);
  });

  it("draws no card when no seat is working", () => {
    expect(
      workingSessionsOf({
        boardRows: undefined,
        reconcileReading: undefined,
        seatReading: seats({ rows: [ASKING, IDLE] }),
      }),
    ).toEqual({
      cards: [],
      joinGap: "no-reconcile",
    });
  });
});

/** Two words, ninety characters: the longest title a card prints whole. */
const NINETY = `${"a".repeat(45)} ${"b".repeat(44)}`;

describe("plainTitle", () => {
  it("drops the terminal's leading glyph, and refuses a slug, a slash command or nothing", () => {
    expect([
      plainTitle({ title: "✳ Console voice codex handover" }),
      plainTitle({ title: "⠐ Daylight orb preview" }),
      plainTitle({ title: "ruling-on-call-handover-slug" }),
      plainTitle({ title: "fresh_supervisor_handoff_306" }),
      plainTitle({ title: "Fleet.Cards" }),
      plainTitle({ title: "Investigate" }),
      plainTitle({ title: "/slopweaver:supervisor" }),
      plainTitle({ title: " /slopweaver:supervisor" }),
      plainTitle({ title: "✳ /slopweaver:supervisor" }),
      plainTitle({ title: "✳ " }),
      plainTitle({ title: undefined }),
      plainTitle({ title: "Investigate the card\nthen the rest" }),
      plainTitle({ title: "Fix Fleet cards. This session is changing every card" }),
      plainTitle({ title: "Fix Fleet cards; then the panel" }),
      plainTitle({ title: `Fix Fleet cards${String.fromCharCode(0x3002)} Then open panel` }),
      plainTitle({ title: `Fix Fleet cards${String.fromCharCode(13)}then the panel` }),
      plainTitle({ title: `Fix Fleet cards${String.fromCharCode(0x2028)}then the panel` }),
      plainTitle({ title: `✳ ${NINETY}` }),
      plainTitle({ title: `${NINETY}b` }),
    ]).toEqual([
      "Console voice codex handover",
      "Daylight orb preview",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      NINETY,
      undefined,
    ]);
  });

  it("refuses a title holding any control character, so every line break: vertical tab, form feed, NEXT LINE, a tab", () => {
    const controls = [0x0b, 0x0c, 0x85, 0x09];
    expect(
      controls.map((code) => plainTitle({ title: `Fix cards${String.fromCharCode(code)}then open panel` })),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(
      controls.map((code) => firstClause({ label: `Fix cards${String.fromCharCode(code)}then open panel` })),
    ).toEqual(["Fix cards", "Fix cards", "Fix cards", "Fix cards"]);
  });

  it("cuts a board row's clause at a no-break space exactly as at a space", () => {
    const nbsp = String.fromCharCode(0xa0);
    expect([
      firstClause({ label: `Fix Fleet cards;${nbsp}Then open panel` }),
      firstClause({ label: `Fix Fleet cards:${nbsp}the panel` }),
      firstClause({ label: `Fix Fleet cards${nbsp}—${nbsp}the panel` }),
      plainTitle({ title: `Fix Fleet cards;${nbsp}Then open panel` }),
    ]).toEqual(["Fix Fleet cards", "Fix Fleet cards", "Fix Fleet cards", undefined]);
  });

  it("titles a session by the cmux title when its own is a slug", () => {
    const slugTitled = workingSessionsOf({
      boardRows: undefined,
      reconcileReading: undefined,
      seatReading: seats({ rows: [{ ...CMUX, sessionTitle: "orb-palettes" }] }),
    });
    expect(slugTitled.cards.map((card) => [card.title, card.titleSource])).toEqual([
      ["Orb palettes from colour theory", "cmux-title"],
    ]);
  });
});

describe("firstClause", () => {
  it("is a summary's first clause when it is short, and nothing when even that is a paragraph or a summary-less row's slug", () => {
    expect([
      firstClause({ label: "The board's ready set does not read the trunk: six ready p1 asks" }),
      firstClause({ label: "Become the fresh supervisor (handoff-9318's gauge at 08:1xZ)" }),
      firstClause({ label: "Short and whole." }),
      firstClause({ label: "Orb palettes — from colour theory" }),
      firstClause({ label: "Two  spaced\nthen a second line" }),
      firstClause({ label: `A carriage${String.fromCharCode(13)}return` }),
      firstClause({ label: "Fix Fleet cards? Then open panel" }),
      firstClause({ label: "Fix Fleet cards! Then open panel" }),
      firstClause({ label: `Fix Fleet cards${String.fromCharCode(0x3002)} Then open panel` }),
      firstClause({ label: NINETY }),
      firstClause({ label: `${NINETY}b` }),
      firstClause({ label: "run-now" }),
      firstClause({ label: "fresh_supervisor_handoff_306" }),
      firstClause({ label: "/slopweaver:incident investigate" }),
      firstClause({ label: "✳ /slopweaver:incident investigate" }),
    ]).toEqual([
      "The board's ready set does not read the trunk",
      "Become the fresh supervisor",
      "Short and whole",
      "Orb palettes",
      "Two spaced",
      "A carriage",
      "Fix Fleet cards",
      "Fix Fleet cards",
      "Fix Fleet cards",
      NINETY,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("transcriptIdOf", () => {
  it("strips cmux's claude- prefix, keeps a Claude seat's bare uuid, and refuses another host's id even when it is a uuid", () => {
    const UUID = "07f92f28-f7e7-4bbc-9845-c9b4ef51d520";
    expect([
      transcriptIdOf({ host: undefined, sessionId: `claude-${UUID}` }),
      transcriptIdOf({ host: "claude", sessionId: UUID }),
      transcriptIdOf({ host: undefined, sessionId: UUID }),
      transcriptIdOf({ host: "codex", sessionId: UUID }),
      transcriptIdOf({ host: "codex", sessionId: `claude-${UUID}` }),
      transcriptIdOf({ host: "claude", sessionId: "codex-thread-1" }),
      transcriptIdOf({ host: "claude", sessionId: undefined }),
    ]).toEqual([UUID, UUID, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("livenessOf", () => {
  const NOW_MS = Date.parse("2026-10-09T16:20:00.000Z");

  it("ages the last activity against the page's clock, quiet from ten minutes, else the reading's own quiet minutes", () => {
    expect([
      livenessOf({ nowMs: NOW_MS, seat: { ...TITLED, lastActivityAtIso: "2026-10-09T16:19:40.000Z" } }),
      livenessOf({ nowMs: NOW_MS, seat: { ...TITLED, lastActivityAtIso: "2026-10-09T16:16:00.000Z" } }),
      livenessOf({ nowMs: NOW_MS, seat: { ...TITLED, lastActivityAtIso: "2026-10-09T16:10:00.000Z" } }),
      livenessOf({ nowMs: NOW_MS, seat: { ...TITLED, lastActivityAtIso: undefined, quietMinutes: 150 } }),
    ]).toEqual([
      { kind: "active", words: "active just now" },
      { kind: "active", words: "active 4m ago" },
      { kind: "quiet", words: "quiet 10m" },
      { kind: "quiet", words: "quiet 2.5h" },
    ]);
  });
});

describe("sessionPropertiesOf", () => {
  const NOW_MS = Date.parse("2026-10-09T16:20:00.000Z");
  /** A card over a seat with these activity facts, on this row. */
  const card = ({ over = {}, row }: { over?: Partial<Seat>; row?: WorkingSessionCard["row"] }): WorkingSessionCard => ({
    key: "id-workspace:1",
    manager: false,
    phase: { kind: "not-read" },
    placement: undefined,
    row,
    seat: { ...TITLED, ...over },
    title: "t",
    titleSource: "cmux-title",
    transcriptId: undefined,
  });

  it("lists exactly the kept properties, in order, with the activity aged against the page's clock", () => {
    expect(
      sessionPropertiesOf({
        card: card({
          over: {
            cwd: "/w/wt/the-board-s-ready-set-does-not-read",
            lastActivityAtIso: "2026-10-09T16:17:00.000Z",
            openedAtIso: "2026-10-09T13:50:00.000Z",
          },
          row: { kind: "ask", priority: "p1", slug: "the-board-s-ready-set-does-not-read" },
        }),
        nowMs: NOW_MS,
      }),
    ).toEqual([
      { label: "Status", value: "working" },
      { label: "Priority", value: "p1" },
      { label: "Worktree", value: "the-board-s-ready-set-does-not-read" },
      { label: "Open for", value: "2.5h" },
      { label: "Phase", value: "phase not read" },
      { label: "Review rounds", value: "not read" },
      { label: "Tool calls", value: "41" },
      { label: "Quiet for", value: "3m" },
      { label: "Last activity", value: "16:17Z, 3m ago" },
    ]);
  });

  it("says not read for what the reading did not carry, and which way a priority is missing", () => {
    const values = (one: WorkingSessionCard): readonly string[] =>
      sessionPropertiesOf({ card: one, nowMs: NOW_MS }).map((property) => property.value);
    expect([
      values(card({})).slice(1, 4),
      values(card({ row: { kind: "doc", priority: undefined, slug: "s" } }))[1],
      values(card({})).at(-1),
    ]).toEqual([["no board row", "workspace:1", "not read"], "none declared", "not read"]);
  });
});

describe("phaseWords", () => {
  it("words each phase, the review round as its pass id", () => {
    expect([
      phaseWords({ phase: { kind: "not-read" } }),
      phaseWords({ phase: { kind: "read", phase: "planning" } }),
      phaseWords({ phase: { kind: "read", phase: "review", round: "r2" } }),
    ]).toEqual(["phase not read", "planning", "review r2"]);
  });
});

describe("goalWords", () => {
  it("is the prompt that opened the latest turn, else goal not read", () => {
    expect([
      goalWords({ prompt: { text: "land the stage card" } }),
      goalWords({ prompt: { text: "  " } }),
      goalWords({ prompt: undefined }),
    ]).toEqual(["land the stage card", "goal not read", "goal not read"]);
  });
});
