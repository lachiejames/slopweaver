/*
 * The session view's pure halves: the id gate before a verb runs, the reader over the verb's JSON, the
 * layout as `ai` UIMessages.
 */
import { describe, expect, it } from "vitest";

import { carryTurnId, MAX_SESSION_PARTS, partOffsetOf, readSessionTurn, turnMessages } from "../../lib/sessionTurn";
import { sessionTurnArgv } from "../../lib/sessionTurnVerb";

const SESSION = "a0000018-0000-4000-8000-000000000021";

/** A payload as `transcripts last-turn --json` prints one. */
const PAYLOAD = {
  cwd: "/repo",
  lastTimestamp: "2026-09-24T01:00:09.000Z",
  model: "claude-opus-5-5",
  parts: [
    { text: "check the pool", truncated: false, type: "reasoning" },
    {
      input: '{\n  "command": "rg pool"\n}',
      output: "max: 5",
      state: "done",
      toolCallId: "t-1",
      toolName: "Bash",
      truncated: false,
      type: "tool",
    },
    {
      input: "{}",
      output: "ENOENT",
      state: "error",
      toolCallId: "t-2",
      toolName: "Read",
      truncated: true,
      type: "tool",
    },
    { input: "{}", output: "", state: "running", toolCallId: "t-3", toolName: "Bash", truncated: false, type: "tool" },
    { text: "The pool caps at 5.", truncated: false, type: "text" },
  ],
  partsDropped: 0,
  earlier: [],
  earlierTurnsInTail: 0,
  prompt: { text: "why is the pool exhausted", timestamp: "2026-09-24T01:00:00.000Z", truncated: false },
  sessionId: SESSION,
  turnId: "u-2",
  turnStartSeen: true,
};

/** A turn before the latest, as the verb prints one. */
const EARLIER = {
  parts: [{ text: "one", truncated: false, type: "text" }],
  partsDropped: 3,
  prompt: { text: "first", timestamp: "2026-09-24T00:50:00.000Z", truncated: false },
  turnId: "u-1",
};

describe("sessionTurnArgv", () => {
  it("builds the literal argv for a session id, one turn when no count is asked for", () => {
    expect(sessionTurnArgv({ id: SESSION, turns: null })).toEqual({
      argv: ["transcripts", "last-turn", "--session", SESSION, "--turns", "1", "--json"],
      kind: "argv",
      title: `slopweaver transcripts last-turn --session ${SESSION} --turns 1 --json`,
    });
  });

  it("carries a count from 1 to 40 as its own digits", () => {
    expect(sessionTurnArgv({ id: SESSION, turns: "40" })).toEqual({
      argv: ["transcripts", "last-turn", "--session", SESSION, "--turns", "40", "--json"],
      kind: "argv",
      title: `slopweaver transcripts last-turn --session ${SESSION} --turns 40 --json`,
    });
  });

  it("refuses anything that is not a UUID, a flag or a path included", () => {
    expect(sessionTurnArgv({ id: "--projects", turns: null }).kind).toBe("refused");
    expect(sessionTurnArgv({ id: "../../etc/passwd", turns: null }).kind).toBe("refused");
    expect(sessionTurnArgv({ id: `${SESSION} --help`, turns: null }).kind).toBe("refused");
  });

  it.each(["0", "41", "1.5", "--json", "", "100"])("refuses turns=%s before any verb runs", (turns) => {
    expect(sessionTurnArgv({ id: SESSION, turns })).toEqual({
      kind: "refused",
      why: "turns must be a whole number from 1 to 40",
    });
  });
});

describe("readSessionTurn", () => {
  it("reads every field the verb prints", () => {
    const turn = readSessionTurn({ payload: PAYLOAD })!;
    expect(turn.prompt).toEqual({
      text: "why is the pool exhausted",
      timestamp: "2026-09-24T01:00:00.000Z",
      truncated: false,
    });
    expect(turn.parts.map((part) => part.type)).toEqual(["reasoning", "tool", "tool", "tool", "text"]);
    expect(turn.model).toBe("claude-opus-5-5");
  });

  it("reads an answer holding exactly the verb's MAX_SESSION_PARTS parts, and refuses one past it", () => {
    const earlierOf = ({ length }: { length: number }) => ({
      ...PAYLOAD,
      earlier: [{ ...EARLIER, parts: Array.from({ length }, () => EARLIER.parts[0]) }],
      earlierTurnsInTail: 1,
    });
    // The latest turn carries five parts, so the earlier one fills the rest of the cap.
    expect(MAX_SESSION_PARTS).toBe(400);
    const fill = MAX_SESSION_PARTS - 5;
    expect(readSessionTurn({ payload: earlierOf({ length: fill }) })!.earlier[0].parts.length).toBe(fill);
    expect(readSessionTurn({ payload: earlierOf({ length: fill + 1 }) })).toBe(undefined);
  });

  it("reads the turns before the latest, and how many the tail holds", () => {
    const turn = readSessionTurn({ payload: { ...PAYLOAD, earlier: [EARLIER], earlierTurnsInTail: 4 } })!;
    expect(turn.earlier).toEqual([
      {
        parts: [{ text: "one", truncated: false, type: "text" }],
        partsDropped: 3,
        prompt: { text: "first", timestamp: "2026-09-24T00:50:00.000Z", truncated: false },
        turnId: "u-1",
      },
    ]);
    expect([turn.turnId, turn.earlierTurnsInTail]).toEqual(["u-2", 4]);
  });

  it("refuses the whole answer when an earlier turn will not read, or the new fields are missing", () => {
    expect(
      readSessionTurn({ payload: { ...PAYLOAD, earlier: [{ ...EARLIER, prompt: undefined }], earlierTurnsInTail: 1 } }),
    ).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, earlier: undefined } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, turnId: undefined } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, earlier: [EARLIER, EARLIER], earlierTurnsInTail: 2 } })).toBe(
      undefined,
    );
    expect(
      readSessionTurn({ payload: { ...PAYLOAD, earlier: [{ ...EARLIER, turnId: "u-2" }], earlierTurnsInTail: 1 } }),
    ).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, earlier: [EARLIER, EARLIER], earlierTurnsInTail: 1 } })).toBe(
      undefined,
    );
    expect(readSessionTurn({ payload: { ...PAYLOAD, earlierTurnsInTail: -1 } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, earlierTurnsInTail: 0.5 } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, partsDropped: -2 } })).toBe(undefined);
    expect(
      readSessionTurn({ payload: { ...PAYLOAD, earlier: [{ ...EARLIER, partsDropped: 1.5 }], earlierTurnsInTail: 1 } }),
    ).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, prompt: { text: 5 } } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, prompt: { ...PAYLOAD.prompt, truncated: null } } })).toBe(
      undefined,
    );
    expect(readSessionTurn({ payload: { ...PAYLOAD, prompt: null } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, prompt: "why" } })).toBe(undefined);
  });

  it("refuses an answer in which two calls share an id, since every fold is held by call id", () => {
    const twins = [
      { ...PAYLOAD.parts[1], toolCallId: "toolu_twin" },
      { text: "then", truncated: false, type: "text" },
      { ...PAYLOAD.parts[2], toolCallId: "toolu_twin" },
    ];
    expect(readSessionTurn({ payload: { ...PAYLOAD, parts: twins } })).toBe(undefined);
    expect(
      readSessionTurn({
        payload: { ...PAYLOAD, earlier: [{ ...EARLIER, parts: [PAYLOAD.parts[1]] }], earlierTurnsInTail: 1 },
      }),
    ).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, parts: [twins[0], twins[1]] } })!.parts.length).toBe(2);
  });

  it("refuses an answer holding a cut or redacted call id, which a different call could share in a later read", () => {
    const withId = ({ toolCallId }: { toolCallId: string }) => ({
      ...PAYLOAD,
      parts: [{ ...PAYLOAD.parts[1], toolCallId }],
    });
    expect(readSessionTurn({ payload: withId({ toolCallId: "x".repeat(1000) + "…" }) })).toBe(undefined);
    expect(readSessionTurn({ payload: withId({ toolCallId: "[REDACTED]" }) })).toBe(undefined);
    expect(readSessionTurn({ payload: withId({ toolCallId: "toolu_01AbC-9_z" }) })!.parts.length).toBe(1);
  });

  it("reads a turn whose opening the tail did not hold", () => {
    const turn = readSessionTurn({ payload: { ...PAYLOAD, prompt: undefined, turnStartSeen: false } })!;
    expect(turn.prompt).toBe(undefined);
    expect(turn.turnStartSeen).toBe(false);
  });

  it("refuses the whole turn when one part is a shape it does not know", () => {
    const parts = [...PAYLOAD.parts, { text: "x", truncated: false, type: "image" }];
    expect(readSessionTurn({ payload: { ...PAYLOAD, parts } })).toBe(undefined);
    expect(readSessionTurn({ payload: { ...PAYLOAD, model: 5 } })).toBe(undefined);
  });
});

describe("turnMessages", () => {
  it("lays the prompt out as the user's message and every part as one assistant message", () => {
    const messages = turnMessages({ turn: readSessionTurn({ payload: PAYLOAD })! });
    expect(messages.map((message) => [message.role, message.id])).toEqual([
      ["user", `${SESSION}:u-2:user`],
      ["assistant", `${SESSION}:u-2:assistant`],
    ]);
    expect(messages.at(0)!.parts).toEqual([{ text: "why is the pool exhausted", type: "text" }]);
    expect(messages.at(1)!.parts).toEqual([
      { state: "done", text: "check the pool", type: "reasoning" },
      {
        input: '{\n  "command": "rg pool"\n}',
        output: "max: 5",
        state: "output-available",
        toolCallId: "t-1",
        toolMetadata: { truncated: false },
        toolName: "Bash",
        type: "dynamic-tool",
      },
      {
        errorText: "ENOENT",
        input: "{}",
        state: "output-error",
        toolCallId: "t-2",
        toolMetadata: { truncated: true },
        toolName: "Read",
        type: "dynamic-tool",
      },
      {
        input: "{}",
        state: "input-available",
        toolCallId: "t-3",
        toolMetadata: { truncated: false },
        toolName: "Bash",
        type: "dynamic-tool",
      },
      { state: "done", text: "The pool caps at 5.", type: "text" },
    ]);
  });

  it("lays every earlier turn out above the latest, oldest first, each keyed by its own turn id", () => {
    const second = { ...EARLIER, parts: [], turnId: "u-1b" };
    const turn = readSessionTurn({ payload: { ...PAYLOAD, earlier: [EARLIER, second], earlierTurnsInTail: 2 } })!;
    expect(turnMessages({ turn }).map((message) => message.id)).toEqual([
      `${SESSION}:u-1:user`,
      `${SESSION}:u-1:assistant`,
      `${SESSION}:u-1b:user`,
      `${SESSION}:u-2:user`,
      `${SESSION}:u-2:assistant`,
    ]);
  });

  it("draws no empty assistant message for a turn with nothing after its prompt yet", () => {
    const messages = turnMessages({ turn: readSessionTurn({ payload: { ...PAYLOAD, parts: [] } })! });
    expect(messages.map((message) => message.role)).toEqual(["user"]);
  });
});

describe("carryTurnId", () => {
  const opened = readSessionTurn({ payload: PAYLOAD })!;
  const fragmentPayload = { ...PAYLOAD, prompt: undefined, turnId: "latest-fragment", turnStartSeen: false };
  const fragment = readSessionTurn({ payload: fragmentPayload })!;

  it("keeps the turn's id once a long turn has pushed its own opening out of the tail, still holding its calls", () => {
    const carried = carryTurnId({ next: fragment, previous: opened });
    expect(turnMessages({ turn: carried }).map((message) => message.id)).toEqual([`${SESSION}:u-2:assistant`]);
  });

  it("never carries the id onto a newer turn whose own opening has also left the tail", () => {
    const newer = readSessionTurn({
      payload: {
        ...fragmentPayload,
        parts: [
          { ...PAYLOAD.parts[1], toolCallId: "t-9" },
          { text: "a different turn", truncated: false, type: "text" },
        ],
      },
    })!;
    expect(carryTurnId({ next: newer, previous: opened }).turnId).toBe("latest-fragment");
  });

  it("never carries the id onto a fragment holding no tool call at all, which proves nothing", () => {
    const prose = readSessionTurn({
      payload: { ...fragmentPayload, parts: [{ text: "still going", truncated: false, type: "text" }] },
    })!;
    expect(carryTurnId({ next: prose, previous: opened }).turnId).toBe("latest-fragment");
  });

  it("takes a new opening's id, because a turn opened since the last read is always in the tail", () => {
    const next = readSessionTurn({ payload: { ...PAYLOAD, turnId: "u-3" } })!;
    expect(carryTurnId({ next, previous: opened }).turnId).toBe("u-3");
  });

  it("keeps the fragment id on the first read, when there is nothing to carry", () => {
    expect(carryTurnId({ next: fragment, previous: undefined }).turnId).toBe("latest-fragment");
  });

  it("never carries an id across two sessions", () => {
    const other = readSessionTurn({ payload: { ...PAYLOAD, sessionId: "other" } })!;
    expect(carryTurnId({ next: fragment, previous: other }).turnId).toBe("latest-fragment");
  });
});

describe("partOffsetOf", () => {
  it("places each turn's assistant message after the parts its budget dropped, and a prompt at 0", () => {
    const turn = readSessionTurn({
      payload: { ...PAYLOAD, earlier: [EARLIER], earlierTurnsInTail: 1, partsDropped: 7 },
    })!;
    expect(turnMessages({ turn }).map((message) => partOffsetOf({ message }))).toEqual([0, 3, 0, 7]);
  });
});
