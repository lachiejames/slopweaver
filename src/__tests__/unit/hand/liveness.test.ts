import { describe, expect, it } from "vitest";

import {
  BEAT_WINDOW_MS,
  CLOSED_BEAT,
  decideNoteRaise,
  noteShowing,
  RAISE_TOKEN_SOURCE,
  raiseToken,
  STARTUP_WINDOW_MS,
} from "../../../hand/note/liveness.js";

const NOW = Date.parse("2026-09-22T12:29:54.000Z");
const BUILD = "6a7370b949f103d8";

describe("raiseToken — a raise's token sorts by when it was minted", () => {
  it("sorts a later raise after an earlier one, across a change in digit count", () => {
    const tokens = [999, 1_000, 1_761_534_000_000].map((atMs) => raiseToken({ atMs, unique: "6f1c2b9e" }));
    expect(tokens.toSorted()).toEqual(tokens);
    expect(tokens[0]).toBe("000000000000999-6f1c2b9e");
  });

  it("matches the shape the panel program accepts, and a dotted step-id remainder does not", () => {
    const shape = new RegExp(RAISE_TOKEN_SOURCE, "u");
    expect(shape.test(raiseToken({ atMs: 5, unique: "0b7d6a1e-34c2-4f0e-9a51-2c8f0d3e7b11" }))).toBe(true);
    expect(shape.test(`b.${raiseToken({ atMs: 5, unique: "0b7d6a1e" })}`)).toBe(false);
  });
});

describe("decideNoteRaise", () => {
  it("draws when nothing is wanted for the step", () => {
    expect(
      decideNoteRaise({ currentBuild: BUILD, nowMs: NOW, observation: { kind: "absent" }, whenLive: "keep" }),
    ).toBe("launch");
  });

  it("keeps a note still starting — the post-then-push case, twelve seconds apart", () => {
    const observation = { kind: "wanted", wantedAtMs: NOW - 12_000 } as const;
    expect(decideNoteRaise({ currentBuild: BUILD, nowMs: NOW, observation, whenLive: "keep" })).toBe("keep");
  });

  it("draws over a note that closed inside the startup window — closed is not starting", () => {
    const observation = {
      beat: { atMs: NOW - 1_000, build: CLOSED_BEAT },
      kind: "wanted",
      wantedAtMs: NOW - 5_000,
    } as const;
    expect(decideNoteRaise({ currentBuild: BUILD, nowMs: NOW, observation, whenLive: "keep" })).toBe("launch");
  });

  it("draws once a wanted note never beat within the startup window — the launch never drew", () => {
    const at = { edge: NOW - STARTUP_WINDOW_MS, past: NOW - STARTUP_WINDOW_MS - 1 };
    expect(
      decideNoteRaise({
        currentBuild: BUILD,
        nowMs: NOW,
        observation: { kind: "wanted", wantedAtMs: at.edge },
        whenLive: "keep",
      }),
    ).toBe("keep");
    expect(
      decideNoteRaise({
        currentBuild: BUILD,
        nowMs: NOW,
        observation: { kind: "wanted", wantedAtMs: at.past },
        whenLive: "keep",
      }),
    ).toBe("launch");
  });

  it("keeps a note beating on this build, and draws once its beat is older than the window", () => {
    const beating = { atMs: NOW - BEAT_WINDOW_MS, build: BUILD };
    const quiet = { atMs: NOW - BEAT_WINDOW_MS - 1, build: BUILD };
    const wantedAtMs = NOW - 3_600_000;
    expect(
      decideNoteRaise({
        currentBuild: BUILD,
        nowMs: NOW,
        observation: { beat: beating, kind: "wanted", wantedAtMs },
        whenLive: "keep",
      }),
    ).toBe("keep");
    expect(
      decideNoteRaise({
        currentBuild: BUILD,
        nowMs: NOW,
        observation: { beat: quiet, kind: "wanted", wantedAtMs },
        whenLive: "keep",
      }),
    ).toBe("launch");
  });

  it("draws over a healthy note running an OLDER program, so keep never pins a stale build", () => {
    const observation = {
      beat: { atMs: NOW - 1_000, build: "0000000000000000" },
      kind: "wanted",
      wantedAtMs: NOW,
    } as const;
    expect(decideNoteRaise({ currentBuild: BUILD, nowMs: NOW, observation, whenLive: "keep" })).toBe("launch");
  });

  it("never reads a file stamped in the FUTURE as healthy", () => {
    const observation = { beat: { atMs: NOW + 5_000, build: BUILD }, kind: "wanted", wantedAtMs: NOW + 5_000 } as const;
    expect(decideNoteRaise({ currentBuild: BUILD, nowMs: NOW, observation, whenLive: "keep" })).toBe("launch");
  });

  it("always draws under replace — hand show, asked for by name", () => {
    const observation = { beat: { atMs: NOW - 1_000, build: BUILD }, kind: "wanted", wantedAtMs: NOW } as const;
    expect(decideNoteRaise({ currentBuild: BUILD, nowMs: NOW, observation, whenLive: "replace" })).toBe("launch");
  });
});

describe("noteShowing — whether one step's note is up, on whatever build drew it", () => {
  it("is false when nothing is wanted for the step", () => {
    expect(noteShowing({ nowMs: NOW, observation: { kind: "absent" } })).toBe(false);
  });

  it("reads a note still starting as up", () => {
    expect(noteShowing({ nowMs: NOW, observation: { kind: "wanted", wantedAtMs: NOW - 1_000 } })).toBe(true);
  });

  it("reads a note beating on an OLDER build as up — it stays until its own step is raised again", () => {
    const observation = {
      beat: { atMs: NOW - 1_000, build: "older-build-0000" },
      kind: "wanted",
      wantedAtMs: NOW - 90_000,
    } as const;
    expect(noteShowing({ nowMs: NOW, observation })).toBe(true);
  });

  it("reads a closed tombstone as down — a Later or Done leaves it", () => {
    const observation = { beat: { atMs: NOW - 1_000, build: CLOSED_BEAT }, kind: "wanted", wantedAtMs: NOW } as const;
    expect(noteShowing({ nowMs: NOW, observation })).toBe(false);
  });

  it("reads a beat gone quiet past its window as down — a logout killed it", () => {
    const observation = {
      beat: { atMs: NOW - BEAT_WINDOW_MS - 1, build: BUILD },
      kind: "wanted",
      wantedAtMs: NOW - 60_000,
    } as const;
    expect(noteShowing({ nowMs: NOW, observation })).toBe(false);
  });
});
