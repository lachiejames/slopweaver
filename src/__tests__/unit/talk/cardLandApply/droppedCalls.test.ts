/**
 * A dropped call's cut-off words, landed by `talk transcript` once the owner's next call opens — whatever order the
 * batches arrive in and however long before it the call dropped — over a throwaway home and board.
 */
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runTalkTranscript } from "../../../../cli/commands/talk/transcriptRun.js";
import { EXIT_OK } from "../../../../cli/exitCodes.js";
import { cardDispatchSlug } from "../../../../talk/cardLanding.js";
import { ANCHOR, active, argvFor, CALL, CARD, home, judged, useCardLandHome } from "./harness.js";

useCardLandHome();

describe("talk transcript, talk cards, talk land and talk restore", () => {
  // A partial snapshot, then the page is gone — no final, no voice, no close line.
  it("lands a dropped call's cut-off words when the owner's next call opens, and not before", async () => {
    const write = ({ name, lines }: { name: string; lines: readonly object[] }): string => {
      const path = join(home, name);
      writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      return path;
    };
    const cut = write({
      lines: [
        { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
        {
          atIso: "2026-09-25T15:40:00.000Z",
          final: false,
          id: "s-1",
          kind: "segment",
          open: CARD,
          text: "what is a voice mark",
          who: "owner",
        },
        judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      ],
      name: "cut.jsonl",
    });
    const next = write({
      lines: [{ atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" }],
      name: "next.jsonl",
    });
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    expect(await post({ call: CALL, path: cut })).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(await post({ call: "a0000076-0000-4000-8000-000000000083", path: next })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });

  // The index is in arrival order, so the dropped call's only batch is indexed after the next call.
  it("lands a dropped call whose only batch arrives after the owner's next call's first", async () => {
    const write = ({ name, lines }: { name: string; lines: readonly object[] }): string => {
      const path = join(home, name);
      writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      return path;
    };
    const cut = write({
      lines: [
        { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
        {
          atIso: "2026-09-25T15:40:00.000Z",
          final: false,
          id: "s-1",
          kind: "segment",
          open: CARD,
          text: "what is a voice mark",
          who: "owner",
        },
        judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      ],
      name: "cut.jsonl",
    });
    const next = write({
      lines: [{ atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" }],
      name: "next.jsonl",
    });
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    expect(await post({ call: "a0000076-0000-4000-8000-000000000083", path: next })).toBe(EXIT_OK);
    expect(await post({ call: CALL, path: cut })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });

  // Two dropped calls' batches arrived after the next call's, in the wrong order, and the second was
  // checked only against the call indexed just before it.
  it("lands two dropped calls whose batches arrive after the owner's next call's, in either order", async () => {
    const write = ({ name, lines }: { name: string; lines: readonly object[] }): string => {
      const path = join(home, name);
      writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      return path;
    };
    const cut = ({ name, openIso, saidIso }: { name: string; openIso: string; saidIso: string }): string =>
      write({
        lines: [
          { atIso: openIso, kind: "open", model: "m", sessionId: name, voice: "cedar" },
          { atIso: saidIso, final: false, id: "s-1", kind: "segment", open: CARD, text: name, who: "owner" },
          judged({ atIso: saidIso, heard: name }),
        ],
        name: `${name}.jsonl`,
      });
    const first = cut({ name: "ship alpha", openIso: "2026-09-25T15:39:00.000Z", saidIso: "2026-09-25T15:40:00.000Z" });
    const second = cut({ name: "ship beta", openIso: "2026-09-25T15:45:00.000Z", saidIso: "2026-09-25T15:46:00.000Z" });
    const next = write({
      lines: [{ atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-3", voice: "cedar" }],
      name: "next.jsonl",
    });
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    const secondCall = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
    expect(await post({ call: "a0000076-0000-4000-8000-000000000083", path: next })).toBe(EXIT_OK);
    expect(await post({ call: CALL, path: first })).toBe(EXIT_OK);
    expect(await post({ call: secondCall, path: second })).toBe(EXIT_OK);
    expect(active().map((row) => row.anchor)).toEqual([ANCHOR, `call:${secondCall}#s-1`]);
  });

  it("lands a dropped call however long before the owner's next call it dropped", async () => {
    const cut = join(home, "cut.jsonl");
    writeFileSync(
      cut,
      [
        { atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
        {
          atIso: "2026-09-25T15:40:00.000Z",
          final: false,
          id: "s-1",
          kind: "segment",
          open: CARD,
          text: "what is a voice mark",
          who: "owner",
        },
        judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      ]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join(""),
    );
    const next = join(home, "next.jsonl");
    writeFileSync(
      next,
      `${JSON.stringify({ atIso: "2026-11-02T09:00:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" })}\n`,
    );
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    expect(await post({ call: CALL, path: cut })).toBe(EXIT_OK);
    const dropped = new Date("2026-09-25T15:40:00.000Z");
    utimesSync(join(home, "talk", "calls", `${CALL}.jsonl`), dropped, dropped);
    expect(await post({ call: "a0000076-0000-4000-8000-000000000083", path: next })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });

  it("lands a dropped call's last batch when it arrives after the owner's next call opened", async () => {
    const write = ({ name, lines }: { name: string; lines: readonly object[] }): string => {
      const path = join(home, name);
      writeFileSync(path, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      return path;
    };
    const opening = write({
      lines: [{ atIso: "2026-09-25T15:39:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" }],
      name: "opening.jsonl",
    });
    const late = write({
      lines: [
        {
          atIso: "2026-09-25T15:40:00.000Z",
          final: false,
          id: "s-1",
          kind: "segment",
          open: CARD,
          text: "what is a voice mark",
          who: "owner",
        },
        judged({ atIso: "2026-09-25T15:40:01.000Z" }),
      ],
      name: "late.jsonl",
    });
    const next = write({
      lines: [{ atIso: "2026-09-25T16:10:00.000Z", kind: "open", model: "m", sessionId: "sess-2", voice: "cedar" }],
      name: "next.jsonl",
    });
    const post = ({ call, path }: { call: string; path: string }): Promise<number> =>
      runTalkTranscript(
        argvFor({ rest: ["--call", call, "--entries-file", path, "--home", home], verb: "transcript" }),
      );
    expect(await post({ call: CALL, path: opening })).toBe(EXIT_OK);
    expect(await post({ call: "a0000076-0000-4000-8000-000000000083", path: next })).toBe(EXIT_OK);
    expect(active()).toEqual([]);
    expect(await post({ call: CALL, path: late })).toBe(EXIT_OK);
    expect(active()).toEqual([{ anchor: ANCHOR, cardKey: CARD, workSlug: cardDispatchSlug({ anchor: ANCHOR }) }]);
  });
});
