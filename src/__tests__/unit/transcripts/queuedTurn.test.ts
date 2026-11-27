/**
 * The mid-turn owner-message reader: the one attachment shape it admits, and every neighbour it refuses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { chairNudgeLine, WORKER_NUDGE_LINE } from "../../../transcripts/fleetNudge.js";
import { readQueuedHumanTurn } from "../../../transcripts/queuedTurn.js";
import { pickupLine } from "../../../transcripts/spawnPickupLine.js";

/** Two real supervisor-transcript records, image bytes replaced by a stub. */
const FIXTURE_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "transcripts",
  "queued-image-prompt",
  "projects",
  "-repo",
);
const FIXTURE_RECORDS = [
  {
    file: "a0000023-0000-4000-8000-000000000026.jsonl",
    sessionId: "a0000023-0000-4000-8000-000000000026",
    uuid: "113799d8-0cd5-4036-ac7f-94354617a4fa",
  },
  {
    file: "a0000078-0000-4000-8000-000000000085.jsonl",
    sessionId: "a0000078-0000-4000-8000-000000000085",
    uuid: "a0000084-0000-4000-8000-000000000091",
  },
] as const;

const UUID = "a0000005-0000-4000-8000-000000000005";
const TIMESTAMP = "2026-09-13T12:28:22.131Z";

/** The real shape, copied from a supervisor transcript, with the fields under test overridable. */
function line({
  attachment = {},
  top = {},
}: {
  attachment?: Readonly<Record<string, unknown>>;
  top?: Readonly<Record<string, unknown>>;
} = {}): string {
  return JSON.stringify({
    attachment: {
      commandMode: "prompt",
      origin: { kind: "human" },
      prompt: "  remember i want you to keep capacity maxing  ",
      timestamp: TIMESTAMP,
      type: "queued_command",
      ...attachment,
    },
    cwd: "/repo/fresh-supervisor-handoff-9257",
    timestamp: TIMESTAMP,
    type: "attachment",
    uuid: UUID,
    ...top,
  });
}

describe("readQueuedHumanTurn", () => {
  it("reads the owner's mid-turn message as a queued turn, trimmed, with its line and cwd", () => {
    expect(readQueuedHumanTurn({ line: line(), lineNumber: 384 })).toEqual({
      cwd: "/repo/fresh-supervisor-handoff-9257",
      lineNumber: 384,
      source: "queued",
      text: "remember i want you to keep capacity maxing",
      timestamp: TIMESTAMP,
      uuid: UUID,
    });
  });

  it("refuses a peer session's message on the same shape — that is the traffic read's business", () => {
    const peer = line({ attachment: { origin: { kind: "peer", msg_id: "m-1", name: "worker" } } });
    expect(readQueuedHumanTurn({ line: peer, lineNumber: 1 })).toBeUndefined();
  });

  it("refuses a fleet resume line queued mid-turn, though it carries a human origin", () => {
    const nudge = line({
      attachment: { prompt: chairNudgeLine({ attemptId: "5f0c2a8e-3b1d-4c6e-9a7f-2d4b8e1c0f93" }) },
    });
    expect(readQueuedHumanTurn({ line: nudge, lineNumber: 1 })).toBeUndefined();
    expect(
      readQueuedHumanTurn({ line: line({ attachment: { prompt: WORKER_NUDGE_LINE } }), lineNumber: 1 }),
    ).toBeUndefined();
  });

  it("refuses a spawn pickup line queued mid-turn, and keeps the owner's turn that says more beside one", () => {
    const pickup = pickupLine({ docPath: "/home/handovers/a-doc.md", location: {}, slug: "a-doc", verb: "resume" });
    const wrapped = `<pasted_content id="b2c9">\n${pickup}\n</pasted_content id="b2c9">`;
    expect(readQueuedHumanTurn({ line: line({ attachment: { prompt: wrapped } }), lineNumber: 1 })).toBeUndefined();
    expect(
      readQueuedHumanTurn({ line: line({ attachment: { prompt: `why this one? ${pickup}` } }), lineNumber: 1 })!.text,
    ).toBe(`why this one? ${pickup}`);
  });

  it("refuses a task notification, which rides queued_command with no origin", () => {
    const notification = line({
      attachment: { commandMode: "task-notification", origin: null, prompt: "<task-notification>…" },
    });
    expect(readQueuedHumanTurn({ line: notification, lineNumber: 1 })).toBeUndefined();
  });

  it("refuses every other attachment kind, a user line, and a line that is not JSON", () => {
    expect(
      readQueuedHumanTurn({ line: line({ attachment: { type: "output_style" } }), lineNumber: 1 }),
    ).toBeUndefined();
    expect(readQueuedHumanTurn({ line: line({ top: { type: "user" } }), lineNumber: 1 })).toBeUndefined();
    expect(
      readQueuedHumanTurn({ line: '{"type":"attachment","attachment":{"type":"queued_command"', lineNumber: 1 }),
    ).toBeUndefined();
    expect(readQueuedHumanTurn({ line: '{"type":"user","message":{"content":"hi"}}', lineNumber: 1 })).toBeUndefined();
  });

  it("reads a prompt that carries an image: its text blocks joined, its image bytes dropped", () => {
    const pasted = line({
      attachment: {
        prompt: [
          { text: "[Image #1] look at this", type: "text" },
          { source: { data: "iVBORw0KGgo=", media_type: "image/png", type: "base64" }, type: "image" },
          { text: "and this", type: "text" },
        ],
      },
    });
    expect(readQueuedHumanTurn({ line: pasted, lineNumber: 7 })!.text).toBe("[Image #1] look at this\nand this");
  });

  it("reads both measured image-carrying rulings off their own transcript records", () => {
    const turns = FIXTURE_RECORDS.map((record) =>
      readQueuedHumanTurn({ line: readFileSync(join(FIXTURE_DIR, record.file), "utf8").trim(), lineNumber: 1 }),
    );
    expect(turns.map((turn) => turn!.uuid)).toEqual(FIXTURE_RECORDS.map((record) => record.uuid));
    expect(turns[0]!.text).toContain("[Image #2] So actually, when this is the case");
    expect(turns[1]!.text).toContain("[Image #1] [Image #2] [Image #3] Yo, Supervisor.");
    expect(turns.map((turn) => turn!.text.includes("iVBORw0KGgo"))).toEqual([false, false]);
  });

  it("refuses an empty prompt, an image-only prompt, and a line with no uuid, which nothing could point at", () => {
    expect(readQueuedHumanTurn({ line: line({ attachment: { prompt: "   " } }), lineNumber: 1 })).toBeUndefined();
    const imageOnly = line({
      attachment: { prompt: [{ source: { data: "iVBORw0KGgo=", type: "base64" }, type: "image" }] },
    });
    expect(readQueuedHumanTurn({ line: imageOnly, lineNumber: 1 })).toBeUndefined();
    expect(readQueuedHumanTurn({ line: line({ top: { uuid: "" } }), lineNumber: 1 })).toBeUndefined();
  });
});
