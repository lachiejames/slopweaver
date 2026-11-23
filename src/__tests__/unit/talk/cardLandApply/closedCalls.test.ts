/**
 * A closed call's words, held while its relay is still sending and landed by `talk transcript` when the owner's next call
 * opens; a batch of reconnect steps alone lands nothing, and a failed landing is swept until it lands — over a
 * throwaway home and board.
 */
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { runTalkTranscript } from "../../../../cli/commands/talk/transcriptRun.js";
import { EXIT_OK } from "../../../../cli/exitCodes.js";
import { resolveRawWords } from "../../../../handover/hisWordsResolve.js";
import { OWNER_SPEAKER } from "../../../../talk/callRecord.js";
import { appendCallEntries } from "../../../../talk/callStore.js";
import { cardDispatchSlug } from "../../../../talk/cardLanding.js";
import { readCardLandings } from "../../../../talk/cardLandingStore.js";
import { sweepOwedDir } from "../../../../talk/sweepOwed.js";
import { ANCHOR, active, argvFor, board, CALL, CARD, home, judged, useCardLandHome } from "./harness.js";

useCardLandHome();

describe("talk transcript, talk cards, talk land and talk restore", () => {
  it("holds a closed call's words while its relay is still sending, and lands them when the owner's next call opens", async () => {
    const lines = ({ rows }: { rows: readonly object[] }): string =>
      rows.map((line) => `${JSON.stringify(line)}\n`).join("");
    const closing = join(home, "closing.jsonl");
    writeFileSync(
      closing,
      lines({
        rows: [
          { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
          {
            atIso: "2026-09-25T15:40:00.000Z",
            final: true,
            id: "s-1",
            kind: "segment",
            open: CARD,
            text: "what is a voice mark",
            who: OWNER_SPEAKER,
          },
          {
            about: CARD,
            answersCard: true,
            atIso: "2026-09-25T15:40:01.000Z",
            detail: "",
            heard: "what is a voice mark",
            kind: "relay",
            outcome: "sending",
            say: "",
            turnId: "a0000071-0000-4000-8000-000000000077",
          },
          {
            atIso: "2026-09-25T15:40:02.000Z",
            final: true,
            id: "v-1",
            kind: "segment",
            open: CARD,
            text: "On it.",
            who: "voice",
          },
          { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: null },
        ],
      }),
    );
    const next = join(home, "next.jsonl");
    writeFileSync(
      next,
      lines({
        rows: [{ atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" }],
      }),
    );
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    expect(await post({ call: CALL, path: closing })).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(await post({ call: "a0000076-0000-4000-8000-000000000083", path: next })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });

  // A batch of steps alone re-ran the call's landing, so a step landed words its own lines had not.
  it("lands nothing for a batch of reconnect steps alone, even words of that call still unlanded", async () => {
    unwrap(
      appendCallEntries({
        callId: CALL,
        entries: [
          { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
          {
            atIso: "2026-09-25T15:40:00.000Z",
            final: true,
            id: "s-1",
            kind: "segment",
            open: CARD,
            text: "what is a voice mark",
            who: OWNER_SPEAKER,
          },
          judged({ atIso: "2026-09-25T15:40:01.000Z" }),
          { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: "dropped" },
        ],
        home,
      }),
    );
    const steps = join(home, "steps.jsonl");
    writeFileSync(
      steps,
      `${JSON.stringify({ atIso: "2026-09-25T15:41:01.000Z", event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 }, kind: "reconnect" })}\n`,
    );

    expect(
      await runTalkTranscript(
        argvFor({ rest: ["--call", CALL, "--entries-file", steps, "--home", home], verb: "transcript" }),
      ),
    ).toBe(EXIT_OK);
    expect(active()).toEqual([]);
  });

  // A reconnect step stamped after the next call's file was written moved the overtaken check's
  // floor past that call, so a closed call whose relay was still sending was held instead of landed.
  it("lands a closed call arriving after the owner's next call, however late a reconnect step on it is stamped", async () => {
    const lines = ({ rows }: { rows: readonly object[] }): string =>
      rows.map((line) => `${JSON.stringify(line)}\n`).join("");
    const next = join(home, "next.jsonl");
    writeFileSync(
      next,
      lines({
        rows: [{ atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" }],
      }),
    );
    const closing = join(home, "closing.jsonl");
    writeFileSync(
      closing,
      lines({
        rows: [
          { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
          {
            atIso: "2026-09-25T15:40:00.000Z",
            final: true,
            id: "s-1",
            kind: "segment",
            open: CARD,
            text: "what is a voice mark",
            who: OWNER_SPEAKER,
          },
          {
            about: CARD,
            answersCard: true,
            atIso: "2026-09-25T15:40:01.000Z",
            detail: "",
            heard: "what is a voice mark",
            kind: "relay",
            outcome: "sending",
            say: "",
            turnId: "a0000071-0000-4000-8000-000000000077",
          },
          { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: "dropped" },
          {
            atIso: "2026-09-25T17:00:00.000Z",
            event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
            kind: "reconnect",
          },
        ],
      }),
    );
    const nextCall = "a0000076-0000-4000-8000-000000000083";
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    expect(await post({ call: nextCall, path: next })).toBe(EXIT_OK);
    const opened = new Date("2026-09-25T16:10:00.000Z");
    utimesSync(join(home, "talk", "calls", `${nextCall}.jsonl`), opened, opened);

    expect(await post({ call: CALL, path: closing })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });

  // A closed call has no next batch, so a landing that failed on its last one is finished by the next open.
  it("lands a closed call whose last batch failed to land when the owner's next call opens", async () => {
    const closing = join(home, "closing.jsonl");
    const rows = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      {
        atIso: "2026-09-25T15:40:00.000Z",
        final: true,
        id: "s-1",
        kind: "segment",
        open: CARD,
        text: "what is a voice mark",
        who: OWNER_SPEAKER,
      },
      judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: null },
    ];
    writeFileSync(closing, rows.map((line) => `${JSON.stringify(line)}\n`).join(""));
    const next = join(home, "next.jsonl");
    const open = { atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" };
    writeFileSync(next, `${JSON.stringify(open)}\n`);
    const notABoard = join(home, "not-a-board");
    writeFileSync(notABoard, "");
    expect(
      await runTalkTranscript(
        argvFor({
          rest: ["--call", CALL, "--entries-file", closing, "--home", home, "--dir", notABoard],
          verb: "transcript",
        }),
      ),
    ).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(
      await runTalkTranscript(
        argvFor({
          rest: ["--call", "a0000076-0000-4000-8000-000000000083", "--entries-file", next, "--home", home],
          verb: "transcript",
        }),
      ),
    ).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });

  // A closed call lands a stretch the owner never finished, and before the landing said so a yes read off it was
  // whole — through the real `talk transcript`, the row it writes and the reader `slack draft approve` binds.
  it("lands an unfinished stretch of a closed call as cut, and the reader binding a yes sees the cut", async () => {
    const closing = join(home, "closing.jsonl");
    const rows = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      {
        atIso: "2026-09-25T15:40:00.000Z",
        final: false,
        id: "s-1",
        kind: "segment",
        open: CARD,
        text: "what is a voice mark",
        who: OWNER_SPEAKER,
      },
      judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: null },
    ];
    writeFileSync(closing, rows.map((line) => `${JSON.stringify(line)}\n`).join(""));
    expect(
      await runTalkTranscript(
        argvFor({ rest: ["--call", CALL, "--entries-file", closing, "--home", home], verb: "transcript" }),
      ),
    ).toBe(EXIT_OK);
    const ledger = unwrap(readCardLandings({ home })).rows;
    const read = unwrap(resolveRawWords({ anchor: ANCHOR, home, projectsDir: join(home, "projects") }));
    expect([
      ledger.map((row) => (row.kind === "landed" ? row.wordsCut : "restored")),
      read.tailKnown,
      read.tailLost,
    ]).toEqual([[true], true, true]);
  });

  // A line of the call that does not parse might be the unfinished end of any utterance, and the reader binding a
  // yes refuses on it, so landing records even a finished stretch's words as cut rather than the two disagreeing.
  it("lands a finished stretch as cut while a line of its call does not parse", async () => {
    const closing = join(home, "closing.jsonl");
    const rows = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      {
        atIso: "2026-09-25T15:40:00.000Z",
        final: true,
        id: "s-1",
        kind: "segment",
        open: CARD,
        text: "what is a voice mark",
        who: OWNER_SPEAKER,
      },
      judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: null },
    ];
    writeFileSync(closing, rows.map((line) => `${JSON.stringify(line)}\n`).join(""));
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), "{torn\n");
    expect(
      await runTalkTranscript(
        argvFor({ rest: ["--call", CALL, "--entries-file", closing, "--home", home], verb: "transcript" }),
      ),
    ).toBe(EXIT_OK);
    const ledger = unwrap(readCardLandings({ home })).rows;
    expect(ledger.map((row) => (row.kind === "landed" ? row.wordsCut : "restored"))).toEqual([true]);
  });

  // The board refused both the closing batch and the next call's open batch, so the open sweep failed too.
  it("keeps sweeping on the next call's later batches until a failed landing lands", async () => {
    const said = { atIso: "2026-09-25T15:40:00.000Z", final: true, id: "s-1", kind: "segment", open: CARD };
    const closing = [
      { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
      { ...said, text: "what is a voice mark", who: OWNER_SPEAKER },
      judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      { atIso: "2026-09-25T15:41:00.000Z", kind: "closed", why: null },
    ];
    const open = { atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" };
    const later = { ...said, atIso: "2026-09-25T16:11:00.000Z", id: "s-9", open: null, text: "hello", who: "voice" };
    const files = {
      closing: join(home, "closing.jsonl"),
      later: join(home, "later.jsonl"),
      open: join(home, "open.jsonl"),
    };
    writeFileSync(files.closing, closing.map((line) => `${JSON.stringify(line)}\n`).join(""));
    writeFileSync(files.open, `${JSON.stringify(open)}\n`);
    writeFileSync(files.later, `${JSON.stringify(later)}\n`);
    const notABoard = join(home, "not-a-board");
    writeFileSync(notABoard, "");
    const post = ({ call, path, dir }: { call: string; path: string; dir: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home, "--dir", dir], verb: "transcript" }),
      );
    const next = "a0000076-0000-4000-8000-000000000083";
    expect(await post({ call: CALL, dir: notABoard, path: files.closing })).toBe(EXIT_OK);
    expect(await post({ call: next, dir: notABoard, path: files.open })).toBe(EXIT_OK);
    expect([active(), readdirSync(sweepOwedDir({ home })).length]).toEqual([[], 2]);
    expect(await post({ call: next, dir: board, path: files.later })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
    expect(readdirSync(sweepOwedDir({ home }))).toEqual([]);
  });
});
