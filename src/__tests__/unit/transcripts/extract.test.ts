/**
 * The extractor, over lines shaped exactly like the ones on disk.
 *
 * Every fixture below is a real record shape rather than an invented one — the wrapper kinds, the two
 * content shapes and the structural markers were all read off `~/.claude/projects` before being written
 * here, and the counts quoted in the comments are what that survey measured.
 */
import { describe, expect, it } from "vitest";

import { bootRefusalWakeLine } from "../../../transcripts/bootRefusalWake.js";
import {
  classifyRecord,
  extractUserTurns,
  type MachineTurnKind,
  stripWrapperSpans,
} from "../../../transcripts/extract.js";
import { chairNudgeLine, WORKER_NUDGE_LINE } from "../../../transcripts/fleetNudge.js";
import { readTranscriptLine, type TranscriptRecord } from "../../../transcripts/record.js";
import { pickupLine } from "../../../transcripts/spawnPickupLine.js";

/** Decode a fixture line through the REAL parser, so the test never hand-builds a record shape. */
function decode({ line }: { line: string }): TranscriptRecord {
  const reading = readTranscriptLine({ line, lineNumber: 1 });
  expect("record" in reading).toBe(true);
  return (reading as { readonly record: TranscriptRecord }).record;
}

/** A `user` line with the given fields, serialised the way Claude Code writes one. */
function userLine({ content, extra = {} }: { content: unknown; extra?: Readonly<Record<string, unknown>> }): string {
  return JSON.stringify({
    cwd: "/repo",
    message: { content, role: "user" },
    timestamp: "2026-08-27T12:00:00.000Z",
    type: "user",
    uuid: "u-1",
    ...extra,
  });
}

/** The machine kind a fixture line classifies as. Fails the test if it was read as a person. */
function machineKindOf({ line }: { line: string }): MachineTurnKind {
  const reading = classifyRecord({ record: decode({ line }) });
  expect(reading.kind).toBe("machine");
  return (reading as { readonly machine: MachineTurnKind }).machine;
}

describe("stripWrapperSpans", () => {
  it("cuts a reminder out of a person's words and leaves the words", () => {
    const stripped = stripWrapperSpans({
      text: "ship it\n<system-reminder>do not mention this</system-reminder>",
    });
    expect(stripped.residue).toBe("ship it");
    expect(stripped.removed).toBe("system-reminder");
  });

  it("cuts every occurrence, not only the first", () => {
    const stripped = stripWrapperSpans({ text: "<bash-input>a</bash-input>x<bash-input>b</bash-input>" });
    expect(stripped.residue).toBe("x");
  });

  it("takes the rest of the string when a wrapper never closes, because a live transcript truncates", () => {
    const stripped = stripWrapperSpans({ text: "keep\n<bash-stdout>half a gigabyte of ou" });
    expect(stripped.residue).toBe("keep");
    expect(stripped.removed).toBe("bash-io");
  });

  it("removes nothing from text that carries no wrapper", () => {
    const stripped = stripWrapperSpans({ text: "  just words  " });
    expect(stripped.residue).toBe("just words");
    expect(stripped.removed).toBe(undefined);
  });
});

describe("classifyRecord — every wrapper kind that wears the user role", () => {
  it("reads a typed turn as the person who typed it", () => {
    const reading = classifyRecord({
      record: decode({
        line: userLine({ content: "run the probe", extra: { origin: { kind: "human" }, promptSource: "typed" } }),
      }),
    });
    expect(reading.kind).toBe("human");
    expect(reading).toStrictEqual({
      kind: "human",
      turn: {
        cwd: "/repo",
        lineNumber: 1,
        source: "typed",
        text: "run the probe",
        timestamp: "2026-08-27T12:00:00.000Z",
        uuid: "u-1",
      },
    });
  });

  it("reads a queued turn as a person, with its own source", () => {
    const reading = classifyRecord({
      record: decode({
        line: userLine({ content: "yes", extra: { origin: { kind: "human" }, promptSource: "queued" } }),
      }),
    });
    expect(reading).toStrictEqual({
      kind: "human",
      turn: {
        cwd: "/repo",
        lineNumber: 1,
        source: "queued",
        text: "yes",
        timestamp: "2026-08-27T12:00:00.000Z",
        uuid: "u-1",
      },
    });
  });

  it("strips a tool result — the single largest bucket, 27,221 of 29,946 user lines when measured", () => {
    expect(
      machineKindOf({
        line: userLine({
          content: [{ content: "ok", is_error: false, tool_use_id: "toolu_1", type: "tool_result" }],
          extra: { toolUseResult: { stdout: "ok" } },
        }),
      }),
    ).toBe("tool-result");
  });

  it("strips a record whose whole content was a system reminder", () => {
    expect(machineKindOf({ line: userLine({ content: "<system-reminder>be careful</system-reminder>" }) })).toBe(
      "system-reminder",
    );
  });

  it("strips a slash-command wrapper", () => {
    expect(
      machineKindOf({
        line: userLine({
          content: "<command-message>slopweaver:orchestrate</command-message>\n<command-name>/x</command-name>",
        }),
      }),
    ).toBe("slash-command");
  });

  it("strips a local-command stdout wrapper", () => {
    expect(machineKindOf({ line: userLine({ content: "<local-command-stdout>done</local-command-stdout>" }) })).toBe(
      "slash-command",
    );
  });

  it("strips bash input and output the harness echoed back", () => {
    expect(machineKindOf({ line: userLine({ content: "<bash-input>ls</bash-input>" }) })).toBe("bash-io");
    expect(machineKindOf({ line: userLine({ content: "<bash-stderr>boom</bash-stderr>" }) })).toBe("bash-io");
  });

  it("strips a task notification, which is marked structurally", () => {
    expect(
      machineKindOf({
        line: userLine({
          content: "<task-notification>\n<task-id>abc</task-id>\n</task-notification>",
          extra: { origin: { kind: "task-notification" }, promptSource: "system" },
        }),
      }),
    ).toBe("task-notification");
  });

  it("strips a peer message from another session", () => {
    expect(
      machineKindOf({
        line: userLine({
          content: 'Another Claude session sent a message:\n<cross-session-message from="x">hi</cross-session-message>',
          extra: { isMeta: true, origin: { kind: "peer" }, promptSource: "system" },
        }),
      }),
    ).toBe("cross-session-message");
  });

  it("strips a compaction summary, which is marked by isCompactSummary", () => {
    expect(
      machineKindOf({
        line: userLine({ content: "This session is being continued from…", extra: { isCompactSummary: true } }),
      }),
    ).toBe("compaction-summary");
  });

  it("strips an interrupt marker, which carries NO structural marker at all", () => {
    const record = decode({ line: userLine({ content: "[Request interrupted by user]" }) });
    expect(record.promptSource).toBe("");
    expect(record.originKind).toBe("");
    expect(record.isMeta).toBe(false);
    expect(machineKindOf({ line: userLine({ content: "[Request interrupted by user]" }) })).toBe("interrupt-marker");
  });

  it("strips both lines fleet resume types, which arrive typed and human-origin like the owner's own turn", () => {
    const typed = { origin: { kind: "human" }, promptSource: "typed" };
    const chair = userLine({
      content: chairNudgeLine({ attemptId: "5f0c2a8e-3b1d-4c6e-9a7f-2d4b8e1c0f93" }),
      extra: typed,
    });
    expect(decode({ line: chair }).originKind).toBe("human");
    expect(machineKindOf({ line: chair })).toBe("fleet-nudge");
    expect(machineKindOf({ line: userLine({ content: WORKER_NUDGE_LINE, extra: typed }) })).toBe("fleet-nudge");
  });

  it("keeps the owner's own turn that opens the way a resume line does, or carries one with more said", () => {
    const typed = { origin: { kind: "human" }, promptSource: "typed" };
    const own = [
      "The fleet was restarted and why did that happen?",
      `${WORKER_NUDGE_LINE} Also check the bump PRs.`,
      `<bash-input>x</bash-input>\n${WORKER_NUDGE_LINE}`,
      chairNudgeLine({ attemptId: "00000000-0000-0000-0000-000000000000" }),
      chairNudgeLine({ attemptId: "5f0c2a8e-3b1d-4c6e-9a7f-2d4b8e1c0f93\u0085" }),
      // A JavaScript `$` without the `m` flag never matches before a final line terminator.
      chairNudgeLine({ attemptId: "5f0c2a8e-3b1d-4c6e-9a7f-2d4b8e1c0f93\n" }),
    ];
    expect(
      own.map((content) => classifyRecord({ record: decode({ line: userLine({ content, extra: typed }) }) }).kind),
    ).toEqual(["human", "human", "human", "human", "human", "human"]);
  });

  // Read as the owner's, it had the voice tell the owner they pasted a handover.
  it("strips the pickup line cmux spawn typed, recorded as a paste with a human origin like the owner's own turn", () => {
    const typed = { origin: { kind: "human" }, promptSource: "typed" };
    const pickup = pickupLine({ docPath: "/home/handovers/a-doc.md", location: {}, slug: "a-doc", verb: "start" });
    const line = userLine({
      content: `\n\n<pasted_content id="b2c9">\n${pickup}\n</pasted_content id="b2c9">\n`,
      extra: typed,
    });
    expect(decode({ line }).originKind).toBe("human");
    expect(machineKindOf({ line })).toBe("spawn-pickup");
  });

  // The courier's boot-refusal wake records exactly as the owner's typed words do.
  it("strips the boot-refusal wake the courier typed, and keeps the owner's words that carry one with more said", () => {
    const typed = { origin: { kind: "human" }, promptSource: "typed" };
    const wake = bootRefusalWakeLine({ cardId: "mon-claude-register-0123456789abcdef", cause: "stale-store" })!;

    expect(machineKindOf({ line: userLine({ content: wake, extra: typed }) })).toBe("boot-refusal-wake");
    expect(
      classifyRecord({ record: decode({ line: userLine({ content: `${wake} Do it now.`, extra: typed }) }) }).kind,
    ).toBe("human");
  });

  it("keeps the owner's own turn that carries a pickup line with more said", () => {
    const pickup = pickupLine({ docPath: "/home/handovers/a-doc.md", location: {}, slug: "a-doc", verb: "resume" });
    const reading = classifyRecord({
      record: decode({
        line: userLine({
          content: `${pickup} Then tell me what it found.`,
          extra: { origin: { kind: "human" }, promptSource: "typed" },
        }),
      }),
    });
    expect(reading.kind).toBe("human");
  });

  it("strips a hook's feedback", () => {
    expect(machineKindOf({ line: userLine({ content: "Stop hook feedback:\nrun the gate" }) })).toBe("hook-feedback");
    expect(machineKindOf({ line: userLine({ content: "<user-prompt-submit-hook>x</user-prompt-submit-hook>" }) })).toBe(
      "hook-feedback",
    );
  });

  it("strips a bare image reference, which is the harness naming a paste rather than a person speaking", () => {
    expect(
      machineKindOf({ line: userLine({ content: "[Image: source: /var/folders/x.png]", extra: { isMeta: true } }) }),
    ).toBe("injected-prompt");
  });

  it("strips an image-only content array as an attachment rather than as an empty turn", () => {
    expect(
      machineKindOf({
        line: userLine({
          content: [{ source: { data: "", type: "base64" }, type: "image" }],
          extra: { origin: { kind: "human" } },
        }),
      }),
    ).toBe("attachment-only");
  });

  it("strips an injected skill body, which is marked isMeta", () => {
    expect(
      machineKindOf({ line: userLine({ content: "# Orchestrate — run a doc end to end", extra: { isMeta: true } }) }),
    ).toBe("injected-prompt");
  });

  it("strips an SDK-driven prompt", () => {
    expect(
      machineKindOf({ line: userLine({ content: "You answer questions about…", extra: { promptSource: "sdk" } }) }),
    ).toBe("injected-prompt");
  });

  it("strips a record whose content held nothing at all", () => {
    expect(machineKindOf({ line: userLine({ content: "   " }) })).toBe("empty");
  });

  it("strips an assistant turn, which is not a user record at all", () => {
    expect(
      machineKindOf({
        line: JSON.stringify({
          message: { content: [{ text: "thinking", type: "text" }], model: "claude-opus-5", role: "assistant" },
          type: "assistant",
        }),
      }),
    ).toBe("assistant");
  });

  it("keeps an unrecognised record with real text as human, because a dropped turn is invisible", () => {
    const reading = classifyRecord({ record: decode({ line: userLine({ content: "an older format's turn" }) }) });
    expect(reading).toStrictEqual({
      kind: "human",
      turn: {
        cwd: "/repo",
        lineNumber: 1,
        source: "unknown",
        text: "an older format's turn",
        timestamp: "2026-08-27T12:00:00.000Z",
        uuid: "u-1",
      },
    });
  });
});

describe("classifyRecord — both content shapes Claude Code emits", () => {
  it("reads a bare string content", () => {
    const reading = classifyRecord({
      record: decode({ line: userLine({ content: "typed as a string", extra: { promptSource: "typed" } }) }),
    });
    expect(reading).toStrictEqual({
      kind: "human",
      turn: {
        cwd: "/repo",
        lineNumber: 1,
        source: "typed",
        text: "typed as a string",
        timestamp: "2026-08-27T12:00:00.000Z",
        uuid: "u-1",
      },
    });
  });

  it("reads a block array, joining its text blocks and keeping the image beside them", () => {
    const record = decode({
      line: userLine({
        content: [
          { text: "look at this", type: "text" },
          { source: { data: "", type: "base64" }, type: "image" },
          { text: "and this", type: "text" },
        ],
        extra: { promptSource: "typed" },
      }),
    });
    expect(record.blockKinds).toStrictEqual(["text", "image", "text"]);
    expect(classifyRecord({ record })).toStrictEqual({
      kind: "human",
      turn: {
        cwd: "/repo",
        lineNumber: 1,
        source: "typed",
        text: "look at this\nand this",
        timestamp: "2026-08-27T12:00:00.000Z",
        uuid: "u-1",
      },
    });
  });
});

describe("extractUserTurns", () => {
  it("returns the turns that steered the session and counts everything it stripped", () => {
    const lines = [
      userLine({ content: "start here", extra: { origin: { kind: "human" }, promptSource: "typed" } }),
      userLine({ content: [{ content: "ok", is_error: false, tool_use_id: "t1", type: "tool_result" }] }),
      userLine({ content: [{ content: "no", is_error: true, tool_use_id: "t2", type: "tool_result" }] }),
      userLine({ content: "[Request interrupted by user]" }),
      userLine({ content: "carry on", extra: { origin: { kind: "human" }, promptSource: "queued" } }),
    ];
    const records = lines.map((line, index) => decode({ line: line.replace('"u-1"', `"u-${index}"`) }));
    const extracted = extractUserTurns({ records });
    expect(extracted.recordCount).toBe(5);
    expect(extracted.turns.map((turn) => turn.text)).toStrictEqual(["start here", "carry on"]);
    expect(extracted.stripped).toStrictEqual({ "interrupt-marker": 1, "tool-result": 2 });
  });

  it("returns nothing at all, and no stripped counts, for an empty transcript", () => {
    const extracted = extractUserTurns({ records: [] });
    expect(extracted.recordCount).toBe(0);
    expect(extracted.turns).toStrictEqual([]);
    expect(extracted.stripped).toStrictEqual({});
  });

  it("accepts a generator, which is how the streaming shell hands it a 40 MB file", () => {
    function* stream(): Generator<TranscriptRecord> {
      yield decode({ line: userLine({ content: "one", extra: { promptSource: "typed" } }) });
      yield decode({ line: userLine({ content: "<bash-input>ls</bash-input>" }) });
    }
    const extracted = extractUserTurns({ records: stream() });
    expect(extracted.turns.map((turn) => turn.text)).toStrictEqual(["one"]);
    expect(extracted.stripped).toStrictEqual({ "bash-io": 1 });
  });
});
