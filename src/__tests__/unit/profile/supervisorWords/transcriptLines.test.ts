/**
 * How `readSupervisorWords` decodes the lines of a chair's transcript: a line that will not parse, or whose
 * shape or provenance is malformed, is named rather than dropped, a queued turn reads whatever its JSON spelling,
 * a subagent's prompt is never the owner's, and a turn with no anchor of its own is named rather than listed.
 */
import { describe, expect, it } from "vitest";

import { readSupervisorWords } from "../../../../profile/supervisorWords.js";
import { A, A_FIRST, B_AFTER, B_TURN, claudeHomeWith, pin, seat, temp, userLine, useTempDirs } from "./harness.js";

useTempDirs();

describe("readSupervisorWords", () => {
  it("names a chair line that will not parse, since it may be a turn of the owner's", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST }),
          '{"type":"user","message":{"role":"user","content":"torn',
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns.map((turn) => turn.text)).toEqual(["while A held it"]);
    expect(read.problems).toEqual([
      `chair ${A}: 1 line(s) would not parse (first: line 2, not-json), so a turn of the owner's may be among them`,
    ]);
  });

  it("names a line with no string type, or a message whose content is no string or array, since either may be the owner's", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          '{"type":5}',
          JSON.stringify({
            message: { content: 42 },
            timestamp: "2026-09-04T23:00:00.000Z",
            type: "user",
            uuid: A_FIRST,
          }),
          JSON.stringify({ timestamp: "2026-09-04T23:10:00.000Z", type: "user", uuid: B_TURN }),
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns, read.problems]).toEqual([
      [],
      [
        `chair ${A}: 3 line(s) would not parse (first: line 1, malformed-message), so a turn of the owner's may be among them`,
      ],
    ]);
  });

  it("names a typed or queued turn carrying a malformed content block, never listing the fragment left", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const typed = JSON.stringify({
      message: {
        content: [
          { text: "only half", type: "text" },
          { text: 42, type: "text" },
        ],
      },
      timestamp: "2026-09-04T23:00:00.000Z",
      type: "user",
      uuid: A_FIRST,
    });
    const queued = JSON.stringify({
      attachment: {
        commandMode: "prompt",
        origin: { kind: "human" },
        prompt: [{ text: "the other half", type: "text" }, 7],
        type: "queued_command",
      },
      timestamp: "2026-09-04T23:30:00.000Z",
      type: "attachment",
      uuid: B_TURN,
    });
    const claudeHome = claudeHomeWith({ transcripts: { [A]: [typed, queued] } });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns, read.problems]).toEqual([
      [],
      [
        `chair ${A}: 2 line(s) would not parse (first: line 1, malformed-message), so a turn of the owner's may be among them`,
      ],
    ]);
  });

  it("reads a queued turn of the owner's whatever whitespace or escapes its JSON is spelled with", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const spaced = JSON.stringify(
      {
        attachment: { commandMode: "prompt", origin: { kind: "human" }, prompt: "spaced out", type: "queued_command" },
        timestamp: "2026-09-04T23:00:00.000Z",
        type: "attachment",
        uuid: A_FIRST,
      },
      null,
      1,
    ).replaceAll("\n", " ");
    const escaped = JSON.stringify({
      attachment: { commandMode: "prompt", origin: { kind: "human" }, prompt: "escaped", type: "queued_command" },
      timestamp: "2026-09-04T23:10:00.000Z",
      type: "attachment",
      uuid: B_TURN,
    }).replace("queued_command", "queued\\u005fcommand");
    const claudeHome = claudeHomeWith({ transcripts: { [A]: [spaced, escaped] } });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns.map((turn) => turn.text).toSorted(), read.problems]).toEqual([["escaped", "spaced out"], []]);
  });

  // A prompt-mode queued line whose origin is not proven the owner's is named, while a peer's is still traffic.
  it("names a queued prompt with a missing or unknown origin, and still reads a peer's as traffic", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const queued = ({ origin, uuid }: { origin: Record<string, unknown> | undefined; uuid: string }): string =>
      JSON.stringify({
        attachment: { commandMode: "prompt", origin, prompt: "ship it", type: "queued_command" },
        timestamp: "2026-09-04T23:00:00.000Z",
        type: "attachment",
        uuid,
      });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          queued({ origin: { kind: "peer" }, uuid: A_FIRST }),
          queued({ origin: undefined, uuid: B_TURN }),
          queued({ origin: { kind: "someone-new" }, uuid: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f" }),
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns, read.problems]).toEqual([
      [],
      [
        `chair ${A}: 2 line(s) would not parse (first: line 2, unproven-origin), so a turn of the owner's may be among them`,
      ],
    ]);
  });

  // A provenance flag read as `=== true` would let `"true"` pass a subagent's prompt off as the owner's.
  it("names a typed or queued turn whose sidechain or meta flag is no boolean, never listing it", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const typed = JSON.stringify({
      ...JSON.parse(userLine({ text: "a subagent's prompt", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST })),
      isSidechain: "true",
      promptSource: "typed",
    });
    const queued = JSON.stringify({
      attachment: { commandMode: "prompt", origin: { kind: "human" }, prompt: "another", type: "queued_command" },
      isMeta: 1,
      timestamp: "2026-09-04T23:30:00.000Z",
      type: "attachment",
      uuid: B_TURN,
    });
    const claudeHome = claudeHomeWith({ transcripts: { [A]: [typed, queued] } });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns, read.problems]).toEqual([
      [],
      [
        `chair ${A}: 2 line(s) would not parse (first: line 1, malformed-message), so a turn of the owner's may be among them`,
      ],
    ]);
  });

  it("marks an accepted suggestion queued behind a running turn as one, so the list leaves it out", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const accepted = JSON.stringify({
      attachment: { commandMode: "prompt", origin: { kind: "human" }, prompt: "ship it", type: "queued_command" },
      cwd: "/repo",
      promptSource: "suggestion_accepted",
      timestamp: "2026-09-04T23:30:00.000Z",
      type: "attachment",
      uuid: B_TURN,
    });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST }), accepted],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect(read.turns.find((turn) => turn.text === "ship it")!.source).toBe("suggestion-accepted");
  });

  it("never reads a subagent's own prompt in a chair's transcript as the owner's, typed or queued", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const sidechain = JSON.stringify({
      cwd: "/repo",
      isSidechain: true,
      message: { content: [{ text: "a subagent's prompt", type: "text" }], role: "user" },
      timestamp: "2026-09-04T23:30:00.000Z",
      type: "user",
      uuid: B_TURN,
    });
    const queuedSidechain = JSON.stringify({
      attachment: {
        commandMode: "prompt",
        origin: { kind: "human" },
        prompt: "subagent words",
        type: "queued_command",
      },
      cwd: "/repo",
      isSidechain: true,
      timestamp: "2026-09-04T23:40:00.000Z",
      type: "attachment",
      uuid: B_AFTER,
    });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST }),
          sidechain,
          queuedSidechain,
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns.map((turn) => turn.text), read.problems]).toEqual([["while A held it"], []]);
  });

  it("names a turn of the owner's with no uuid, or one an earlier turn already used, rather than leaving it out", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = claudeHomeWith({
      transcripts: {
        [A]: [
          userLine({ text: "while A held it", timestamp: "2026-09-04T23:00:00.000Z", uuid: A_FIRST }),
          userLine({ text: "no uuid on this one", timestamp: "2026-09-04T23:10:00.000Z", uuid: "" }),
          JSON.stringify({
            attachment: {
              commandMode: "prompt",
              origin: { kind: "human" },
              prompt: "said twice",
              type: "queued_command",
            },
            cwd: "/repo",
            timestamp: "2026-09-04T23:20:00.000Z",
            type: "attachment",
            uuid: A_FIRST,
          }),
        ],
      },
    });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns.map((turn) => turn.text), read.problems]).toEqual([
      ["while A held it"],
      [
        `chair ${A}: 2 turn(s) of the owner's have no anchor of their own (first: line 2, no uuid), so they are not listed`,
      ],
    ]);
  });

  it("reads a whitespace-only chair line as no record, not as a gap", () => {
    const home = temp({ prefix: "words-home-" });
    seat({ home, links: [pin({ at: "2026-09-04T22:00:00.000Z", session: A })] });
    const claudeHome = claudeHomeWith({ transcripts: { [A]: ["   "] } });

    const read = readSupervisorWords({
      claudeHome,
      home,
      sinceIso: "2026-09-04T22:00:00.000Z",
      untilIso: "2026-09-06T00:00:00.000Z",
    });

    expect([read.turns, read.problems]).toEqual([[], []]);
  });
});
