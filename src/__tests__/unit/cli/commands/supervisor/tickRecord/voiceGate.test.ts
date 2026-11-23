/** The unread-voice gate through the recorder: a word the owner spoke that the chair never read refuses the tick. */
import { describe, expect, it } from "vitest";

import {
  runSupervisorTickRecord,
  type SupervisorTickRecordDeps,
} from "../../../../../../cli/commands/supervisor/tickRecordRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { VoiceUnreadRead } from "../../../../../../supervisor/voiceUnreadGate.js";
import { type Capture, capture, DRAFT, NOT_READ, RECONCILE } from "./harness.js";

describe("the unread-voice gate, as the recorder renders it", () => {
  /**
   * One word of the owner's, taken at `atIso`, that the supervisor cursor has not read — finished unless `final` says not, and
   * grown past a read of its start only when `growingSinceRead` says so.
   */
  const wordAt = ({
    atIso,
    final = true,
    growingSinceRead = false,
  }: {
    atIso: string;
    final?: boolean;
    growingSinceRead?: boolean;
  }): VoiceUnreadRead => ({
    kind: "read",
    neverMarked: false,
    unparseable: [],
    words: [
      {
        atIso,
        callId: "a0000035-0000-4000-8000-000000000038",
        cut: false,
        final,
        growingSinceRead,
        latestAtIso: atIso,
        nextRelay: undefined,
        pointer: "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163",
        revisions: [],
        segmentId: "segment_0_163",
        text: "and redact the Pino logs",
      },
    ],
  });

  /** The recorder at a fixed `--now` with the voice hatch shut and `read` as the call files' answer. */
  async function gated({
    read,
    open = {},
  }: {
    read: VoiceUnreadRead;
    open?: Partial<SupervisorTickRecordDeps>;
  }): Promise<
    Capture & {
      code: number;
      asked: string[];
    }
  > {
    const run = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    const asked: string[] = [];
    const deps: SupervisorTickRecordDeps = {
      ...run.deps,
      readVoiceUnread: ({ nowIso }) => {
        asked.push(nowIso);
        return read;
      },
      voiceHatchOpen: () => false,
      ...open,
    };
    const code = await runSupervisorTickRecord({
      deps,
      evidence: NOT_READ,
      rest: ["--draft", "d.json", "--reconcile", "r.json", "--now", "2026-09-10T12:30:00.000Z"],
    });
    return { ...run, asked, code };
  }

  it("refuses an unread word, appending nothing, naming it, the way through and its hatch", async () => {
    const run = await gated({ read: wordAt({ atIso: "2026-09-10T12:24:59.000Z" }) });
    const printed = run.diagnostics.join("\n");

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(printed).toContain("talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163");
    expect(printed).toContain("slopweaver talk unread --mark");
    expect(printed).toContain("SLOPWEAVER_ALLOW_UNREAD_VOICE_WORDS=1");
  });

  it("reads the call files once, at the row's own --now", async () => {
    const run = await gated({ read: wordAt({ atIso: "2026-09-10T12:24:59.000Z" }) });

    expect(run.asked).toStrictEqual(["2026-09-10T12:30:00.000Z"]);
  });

  it("refuses a tick over an unfinished stretch nobody has read the start of, once the owner's two-minute floor has passed", async () => {
    const run = await gated({ read: wordAt({ atIso: "2026-09-10T12:28:00.000Z", final: false }) });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
  });

  it("records a tick over a stretch still growing past a read of it, naming it as still being spoken", async () => {
    const run = await gated({
      read: wordAt({ atIso: "2026-09-10T12:29:56.000Z", final: false, growingSinceRead: true }),
    });

    expect(run.code).toBe(EXIT_OK);
    expect(run.appended.length).toBe(1);
    expect(run.diagnostics.slice(1)).toStrictEqual([
      "supervisor tick-record: 1 stretch(es) of the owner's speech are still being spoken, or inside the two-minute quiet " +
        "floor, and do not refuse this tick — each stays unread, and refuses a later tick once the floor has passed " +
        "and it is final, its call ends, or it stops growing:",
      'supervisor tick-record:   2026-09-10T12:29:56.000Z talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163 "and redact the Pino logs"',
    ]);
  });

  it("names a stretch still being spoken in the --json record by its pointer", async () => {
    const json = capture({ files: { "d.json": DRAFT, "r.json": RECONCILE } });
    const code = await runSupervisorTickRecord({
      deps: {
        ...json.deps,
        readVoiceUnread: () => wordAt({ atIso: "2026-09-10T12:29:56.000Z", final: false, growingSinceRead: true }),
        voiceHatchOpen: () => false,
      },
      evidence: NOT_READ,
      rest: ["--draft", "d.json", "--reconcile", "r.json", "--now", "2026-09-10T12:30:00.000Z", "--json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(json.out[0]!).stillSpoken).toStrictEqual([
      "talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163",
    ]);
  });

  it("refuses a stretch that grew past a read of it but stopped growing two minutes before the tick", async () => {
    const run = await gated({
      read: wordAt({ atIso: "2026-09-10T12:28:00.000Z", final: false, growingSinceRead: true }),
    });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
  });

  it("records a tick over a finished word inside the owner's two-minute floor, naming it, and refuses it at the floor", async () => {
    const young = await gated({ read: wordAt({ atIso: "2026-09-10T12:28:00.001Z" }) });
    const due = await gated({ read: wordAt({ atIso: "2026-09-10T12:28:00.000Z" }) });

    expect(young.code).toBe(EXIT_OK);
    expect(young.appended.length).toBe(1);
    expect(young.diagnostics.slice(-1)).toStrictEqual([
      'supervisor tick-record:   2026-09-10T12:28:00.001Z talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163 "and redact the Pino logs"',
    ]);
    expect(due.code).toBe(EXIT_ERROR);
    expect(due.appended.length).toBe(0);
  });

  it("refuses a read that failed rather than recording a tick that saw nothing", async () => {
    const run = await gated({
      read: { kind: "unreadable", why: "call x's file no longer holds what the cursor read" },
    });

    expect(run.code).toBe(EXIT_ERROR);
    expect(run.appended.length).toBe(0);
    expect(run.diagnostics.join("\n")).toContain("call x's file no longer holds what the cursor read");
  });

  it("is released by its own hatch and by no other", async () => {
    const stale = wordAt({ atIso: "2026-09-10T12:00:00.000Z" });
    const others = await gated({
      read: stale,
      open: {
        hatchOpen: () => true,
        idleHatchOpen: () => true,
        loadHatchOpen: () => true,
        recipeFailureHatchOpen: () => true,
      },
    });
    const own = await gated({ read: stale, open: { voiceHatchOpen: () => true } });

    expect(others.code).toBe(EXIT_ERROR);
    expect(own.code).toBe(EXIT_OK);
  });
});
