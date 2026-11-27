/**
 * The done proof for the control plane's chair hand-off: a chair near its bar is replaced WITHOUT THE MODEL DOING
 * IT. The real `runChairHandOff` runs over a real home (pin, ledger row, run journal, hand-off journal, successor
 * doc) with plain fake seams for the watch, the hold, the app's harness and the spawn.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LAUNCH_SETTLED_AFTER_MS } from "../../../../../sessionHarness/appLaunch.js";
import { foldSessions, parseSessionLog } from "../../../../../sessions/session.js";
import { readSessionLogText } from "../../../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import type { ChairHandOffEvent, ChairHandOffStarted } from "../../../../../supervisor/chairHandOff.js";
import { episodeJournalPath } from "../../../../../supervisor/chairHandOffStore.js";
import {
  EPISODE,
  episode,
  HAND_OFF,
  type HandOffWorld,
  handOff,
  handOffDeps,
  handOffWorld,
  NEXT_SLUG,
  predecessorPhase,
  removeWorlds,
  type WatchScript,
} from "./chairHandOffFixtures.js";

afterEach(() => {
  removeWorlds();
});

/** The episode's `started` event. */
function startedOf({ world }: { world: HandOffWorld }): ChairHandOffStarted {
  return episode({ world }).find((event): event is ChairHandOffStarted => event.kind === "started")!;
}

/** The successor docs the home holds, by file name. */
function successorDocs({ world }: { world: HandOffWorld }): readonly string[] {
  return readdirSync(stateHomePaths({ home: world.home }).handovers).filter((name) =>
    name.startsWith("fresh-supervisor-handoff-"),
  );
}

/** Open app rows recorded from a successor slug. */
function seatedFrom({ world, slug }: { world: HandOffWorld; slug: string }): readonly string[] {
  return foldSessions(parseSessionLog({ text: readSessionLogText({ home: world.home }) }))
    .filter((row) => row.slug === slug && row.harness === "app" && row.status === "open")
    .map((row) => row.sessionId!);
}

describe("supervisor hand-off — the chair is replaced by the control plane", () => {
  it("(a) with a note: one doc carrying it, one spawn on the watch's plan, the run closed, the journal in order", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: "Landing #12 is mid-queue; leave it.\n", script: HAND_OFF, world });
    expect(await handOff({ args: [], deps, world })).toBe(0);
    expect(episode({ world }).map((event) => event.kind)).toEqual([
      "started",
      "note-asked",
      "note-arrived",
      "row-closed",
      "slug-reserved",
      "doc-written",
      "successor-opening",
      "successor-opened",
    ]);
    expect(successorDocs({ world })).toEqual([`${NEXT_SLUG}.md`]);
    const doc = readFileSync(join(stateHomePaths({ home: world.home }).handovers, `${NEXT_SLUG}.md`), "utf8");
    expect(doc).toContain("## Hand-off note from the outgoing chair\n\nLanding #12 is mid-queue; leave it.\n");
    expect(doc).toContain("role: supervisor");
    expect(world.spawns).toEqual([
      [
        NEXT_SLUG,
        "--harness",
        "app",
        "--driver",
        "claude",
        "--model",
        "fable",
        "--plan",
        "plan-two",
        "--home",
        world.home,
      ],
    ]);
    expect(predecessorPhase({ world })).toBe("closed");
    expect(seatedFrom({ slug: NEXT_SLUG, world })).toEqual(["chair-new-1"]);
    expect(world.messages.map((message) => message.delivery)).toEqual(["later"]);
    expect(world.messages[0]!.text).toContain(
      `slopweaver supervisor hand-off note --episode ${EPISODE} --file ${join(world.home, "supervisor", "hand-offs", "chair-hand-off-chair-old-1.note.md")} --home ${world.home}`,
    );
    expect(world.messages[0]!.text).toContain("Do NOT spawn a successor and do NOT finish or close your run");
  });

  it("(b) without a note: the doc carries the rebuild-from-files paragraph", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "30"], deps, world })).toBe(0);
    expect(episode({ world }).map((event) => event.kind)).toEqual([
      "started",
      "note-asked",
      "note-missing",
      "row-closed",
      "slug-reserved",
      "doc-written",
      "successor-opening",
      "successor-opened",
    ]);
    const doc = readFileSync(join(stateHomePaths({ home: world.home }).handovers, `${NEXT_SLUG}.md`), "utf8");
    expect(doc).toContain(
      "No hand-off note arrived within 30s; rebuild the picture from files as a fresh chair does (skills/pickup).",
    );
    expect(world.clock.ms - Date.parse("2026-11-27T08:00:00.000Z")).toBe(30_000);
  });

  it("(c) stay refuses naming --now, seats nothing and journals nothing", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: { ...HAND_OFF, status: "stay" }, world });
    expect(await handOff({ args: [], deps, world })).toBe(3);
    expect(world.spawns).toEqual([]);
    expect(existsSync(episodeJournalPath({ episodeId: EPISODE, home: world.home }))).toBe(false);
    expect(world.lines.at(-1)).toBe(
      'supervisor hand-off: nothing to do: the watch says the chair stays; override with --now --reason "<why>"',
    );
    expect(predecessorPhase({ world })).toBe("open");
  });

  it("(c) held refuses naming release and --now", async () => {
    const world = handOffWorld({ pin: "app" });
    const script: WatchScript = {
      ...HAND_OFF,
      hold: { reason: "demo at ten", sinceIso: "2026-11-27T07:30:00.000Z" },
      status: "held",
    };
    const deps = handOffDeps({ note: undefined, script, world });
    expect(await handOff({ args: [], deps, world })).toBe(1);
    expect(world.spawns).toEqual([]);
    expect(world.lines.at(-1)).toBe(
      'supervisor hand-off: refused: automatic hand-off is HELD (demo at ten); lift it with `slopweaver supervisor hand-off release --reason "<why>"`, or hand off anyway with --now --reason "<why>"',
    );
  });

  it("(c) a cmux chair is unsupported, even with --now, and names the chair's own hand-off", async () => {
    const world = handOffWorld({ pin: "cmux" });
    const script: WatchScript = {
      chair: { kind: "cmux", sessionIds: ["s-old"], workspaceId: "WS-OLD" },
      reasons: [],
      status: "unsupported",
    };
    const deps = handOffDeps({ note: undefined, script, world });
    expect(await handOff({ args: ["--now", "--reason", "try it"], deps, world })).toBe(1);
    expect(world.spawns).toEqual([]);
    expect(world.lines.at(-1)).toBe(
      "supervisor hand-off: refused: a cmux chair; the control plane hands off only a pinned desktop-app chair, even with --now — hand a cmux chair off from the chair itself",
    );
  });

  it("(c) unmeasured is not yet, naming --now --reason with --plan", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: { ...HAND_OFF, status: "unmeasured" }, world });
    expect(await handOff({ args: [], deps, world })).toBe(4);
    expect(world.spawns).toEqual([]);
    expect(world.lines.at(-1)).toBe(
      'supervisor hand-off: not yet: the watch could not measure the chair, so nothing is handed off on it; re-run once it measures, or hand off anyway with --now --reason "<why>" --plan <alias>',
    );
  });

  it("(c) --now --reason hands off a chair the watch would keep, journalled as the owner's", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: { ...HAND_OFF, status: "stay" }, world });
    expect(
      await handOff({ args: ["--now", "--reason", "switching plans tonight", "--note-wait", "0"], deps, world }),
    ).toBe(0);
    expect(world.spawns.length).toBe(1);
    expect(startedOf({ world }).basis).toEqual({ kind: "now", reason: "switching plans tonight" });
  });

  it("(d) --plan overrides the watch's plan, the vendor read off its reading, journalled as an override", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--plan", "plan-four", "--note-wait", "0"], deps, world })).toBe(0);
    const argv = world.spawns[0]!;
    expect([argv[3], argv[4], argv[7], argv[8]]).toEqual(["--driver", "codex", "--plan", "plan-four"]);
    expect(startedOf({ world }).planOverride).toEqual({
      alias: "plan-four",
      reason: "the owner named --plan plan-four",
      watchAlias: "plan-two",
    });
  });

  it("(e) a second invocation after success seats nothing", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(3);
    expect(world.spawns.length).toBe(1);
    expect(successorDocs({ world })).toEqual([`${NEXT_SLUG}.md`]);
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: nothing to do: ${EPISODE} already seated app:chair-new-1 from ${NEXT_SLUG}`,
    );
  });

  it("(f) two concurrent invocations seat exactly one successor", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    const exits = await Promise.all([
      handOff({ args: ["--note-wait", "0"], deps, world }),
      handOff({ args: ["--note-wait", "0"], deps, world }),
    ]);
    expect(exits.toSorted((a, b) => a - b)).toEqual([0, 4]);
    expect(world.spawns.length).toBe(1);
    expect(successorDocs({ world })).toEqual([`${NEXT_SLUG}.md`]);
    expect(seatedFrom({ slug: NEXT_SLUG, world })).toEqual(["chair-new-1"]);
  });

  it("(g) a spawn that fails after the run closed resumes the SAME episode, slug and doc, and seats once", async () => {
    const world = handOffWorld({ pin: "app" });
    world.failSpawns.push(true);
    const deps = handOffDeps({ note: "carry this\n", script: HAND_OFF, world });
    expect(await handOff({ args: [], deps, world })).toBe(1);
    expect(predecessorPhase({ world })).toBe("closed");
    expect(episode({ world }).at(-1)!.kind).toBe("failed");
    const docBefore = readFileSync(join(stateHomePaths({ home: world.home }).handovers, `${NEXT_SLUG}.md`), "utf8");
    // Inside the app's launch window the earlier request may still register a session: nothing is spawned yet.
    expect(await handOff({ args: [], deps, world })).toBe(4);
    expect(world.spawns.map((argv) => argv[0])).toEqual([NEXT_SLUG]);
    world.clock.ms += LAUNCH_SETTLED_AFTER_MS;
    expect(await handOff({ args: [], deps, world })).toBe(0);
    expect(world.spawns.map((argv) => argv[0])).toEqual([NEXT_SLUG, NEXT_SLUG]);
    expect(successorDocs({ world })).toEqual([`${NEXT_SLUG}.md`]);
    expect(readFileSync(join(stateHomePaths({ home: world.home }).handovers, `${NEXT_SLUG}.md`), "utf8")).toBe(
      docBefore,
    );
    expect(seatedFrom({ slug: NEXT_SLUG, world })).toEqual(["chair-new-2"]);
    expect(episode({ world }).map((event) => event.kind)).toEqual([
      "started",
      "note-asked",
      "note-arrived",
      "row-closed",
      "slug-reserved",
      "doc-written",
      "successor-opening",
      "failed",
      "stopped",
      "successor-opened",
    ]);
    expect(world.messages.length).toBe(1);
    // Never two sessions: the one seat after the window is the only successor the app runs from the slug.
    expect(world.app.sessions.filter((one) => one.slug === NEXT_SLUG).length).toBe(1);
  });

  it("(g) a resume after successor-opening reconciles a spawn that did open, and spawns nothing", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);
    const journal = episodeJournalPath({ episodeId: EPISODE, home: world.home });
    const kept = readFileSync(journal, "utf8").trimEnd().split("\n").slice(0, -1);
    writeFileSync(journal, `${kept.join("\n")}\n`);
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);
    expect(world.spawns.length).toBe(1);
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: reconciled: the successor app:chair-new-1 already opened from ${NEXT_SLUG}; nothing spawned`,
    );
  });

  it("(h) a late note is refused, naming why", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);
    const file = join(world.home, "late.md");
    writeFileSync(file, "late words\n");
    expect(await handOff({ args: ["note", "--episode", EPISODE, "--file", file], deps, world })).toBe(1);
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off note: refused: ${EPISODE} stopped waiting for a note at its deadline and the successor rebuilds from files; this note is too late`,
    );
    expect(episode({ world }).some((event) => event.kind === "note-arrived")).toBe(false);
    expect(await handOff({ args: ["note", "--episode", "chair-hand-off:nobody", "--file", file], deps, world })).toBe(
      1,
    );
    expect(world.lines.at(-1)).toBe(
      "supervisor hand-off note: refused: no chair hand-off chair-hand-off:nobody is journalled, so there is nothing to attach a note to",
    );
  });

  it("(i) an account address in the input reaches neither the journal, the doc nor the note request", async () => {
    const world = handOffWorld({ pin: "app" });
    const script: WatchScript = { ...HAND_OFF, reasons: ["plan-one (seat-1@example.test) Fable week 97%"] };
    const deps = handOffDeps({ note: undefined, script, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);
    const journal = readFileSync(episodeJournalPath({ episodeId: EPISODE, home: world.home }), "utf8");
    const doc = readFileSync(join(stateHomePaths({ home: world.home }).handovers, `${NEXT_SLUG}.md`), "utf8");
    const outward = [journal, doc, world.messages[0]!.text, world.lines.join("\n")];
    expect(outward.map((text) => text.includes("seat-1@example.test"))).toEqual([false, false, false, false]);
    expect(outward.map((text) => text.includes("plan-one (<account>) Fable week 97%"))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("(j) an address the owner typed in --now --reason, or the outgoing chair wrote in its note, is scrubbed too", async () => {
    const world = handOffWorld({ pin: "app" });
    const deps = handOffDeps({ note: "ask seat-1@example.test about #12\n", script: HAND_OFF, world });
    const args = ["--now", "--reason", "pause seat-1@example.test", "--plan", "plan-four"];
    expect(await handOff({ args, deps, world })).toBe(0);
    const journal = readFileSync(episodeJournalPath({ episodeId: EPISODE, home: world.home }), "utf8");
    const doc = readFileSync(join(stateHomePaths({ home: world.home }).handovers, `${NEXT_SLUG}.md`), "utf8");
    const outward = [journal, doc, world.messages[0]!.text, world.lines.join("\n")];
    expect(outward.map((text) => text.includes("seat-1@example.test"))).toEqual([false, false, false, false]);
    expect(startedOf({ world }).basis).toEqual({ kind: "now", reason: "pause <account>" });
    expect(startedOf({ world }).planOverride!.reason).toBe("pause <account>");
    expect(doc).toContain("ask <account> about #12");
  });
});

describe("supervisor hand-off — a successor the ledger never recorded is found in the app, never seated twice", () => {
  /** The episode's `successor-opened` events. */
  function openedEvents({ world }: { world: HandOffWorld }): readonly ChairHandOffEvent[] {
    return episode({ world }).filter((event) => event.kind === "successor-opened");
  }

  it("(k) a resume finding no ledger row records the session the app runs under the slug, and spawns nothing", async () => {
    const world = handOffWorld({ pin: "app" });
    world.failSpawns.push(true);
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(1);
    world.app.sessions.push({ sessionId: "chair-app-1", slug: NEXT_SLUG });

    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);

    expect(world.spawns.length).toBe(1);
    expect(seatedFrom({ slug: NEXT_SLUG, world })).toEqual([]);
    expect(openedEvents({ world })).toEqual([
      {
        atIso: new Date(world.clock.ms).toISOString(),
        kind: "successor-opened",
        sessionId: "chair-app-1",
        slug: NEXT_SLUG,
      },
    ]);
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: reconciled: the ledger names no session from ${NEXT_SLUG}, but the app runs the successor app:chair-app-1 from ${NEXT_SLUG}; nothing more spawned`,
    );
  });

  it("(o) a launch still in flight in the app when its client died is waited out, then found, never seated twice", async () => {
    const world = handOffWorld({ pin: "app" });
    world.failSpawns.push(true);
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(1);
    const openingIso = episode({ world }).find((event) => event.kind === "successor-opening")!.atIso;
    const settlesIso = new Date(Date.parse(openingIso) + LAUNCH_SETTLED_AFTER_MS).toISOString();

    // Inside the window: neither the ledger nor the app names a session yet, and nothing is spawned.
    world.clock.ms = Date.parse(settlesIso) - 1;
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(4);
    expect(world.spawns.length).toBe(1);
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: not yet: the earlier launch from ${NEXT_SLUG} may still be in flight in the app until ${settlesIso}, and the app lists no session from it so far; nothing was spawned — re-run \`slopweaver supervisor hand-off\` after then`,
    );

    // The dead client's request registers its session late; the resume after the window finds it and spawns nothing.
    world.app.sessions.push({ sessionId: "chair-late-1", slug: NEXT_SLUG });
    world.clock.ms = Date.parse(settlesIso);
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);
    expect(world.spawns.length).toBe(1);
    expect(world.app.sessions.filter((one) => one.slug === NEXT_SLUG)).toEqual([
      { sessionId: "chair-late-1", slug: NEXT_SLUG },
    ]);
    expect(openedEvents({ world }).map((event) => (event.kind === "successor-opened" ? event.sessionId : ""))).toEqual([
      "chair-late-1",
    ]);
  });

  it("(k) a resume finding no ledger row and an app that cannot be asked spawns nothing and exits 4", async () => {
    const world = handOffWorld({ pin: "app" });
    world.failSpawns.push(true);
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(1);
    world.app.listFails = true;

    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(4);

    expect(world.spawns.length).toBe(1);
    expect(openedEvents({ world })).toEqual([]);
    expect(episode({ world }).at(-1)!.kind).toBe("stopped");
    expect(world.lines.at(-1)).toBe(
      `supervisor hand-off: not yet: the ledger names no session from ${NEXT_SLUG} and the app could not be asked whether the earlier spawn opened one (the desktop app did not answer (ENOENT)); nothing was spawned — re-run \`slopweaver supervisor hand-off\` once the app answers`,
    );
  });

  it("(l) a spawn that reports a failure while the app runs its session is seated from the app, not journalled failed", async () => {
    const world = handOffWorld({ pin: "app" });
    world.failSpawns.push(true);
    world.app.sessions.push({ sessionId: "chair-app-1", slug: NEXT_SLUG });
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });

    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(0);

    expect(world.spawns.length).toBe(1);
    expect(episode({ world }).some((event) => event.kind === "failed")).toBe(false);
    expect(openedEvents({ world }).length).toBe(1);
    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(3);
    expect(world.spawns.length).toBe(1);
  });

  it("(l) a spawn that reports a failure while the app cannot be asked stops deferred, spawning nothing more", async () => {
    const world = handOffWorld({ pin: "app" });
    world.failSpawns.push(true);
    world.app.listFails = true;
    const deps = handOffDeps({ note: undefined, script: HAND_OFF, world });

    expect(await handOff({ args: ["--note-wait", "0"], deps, world })).toBe(4);

    expect(world.spawns.length).toBe(1);
    expect(episode({ world }).some((event) => event.kind === "failed")).toBe(false);
    expect(world.lines.at(-1)).toContain(
      "and the app could not be asked whether one opened (the desktop app did not answer (ENOENT)); nothing more was spawned",
    );
  });
});
