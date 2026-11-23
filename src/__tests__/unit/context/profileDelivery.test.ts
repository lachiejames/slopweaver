/**
 * `src/context/profileDelivery.ts` — the marker is tied to the transcript it was written against, so a compaction
 * whose `SessionStart` never began cannot leave the old context's marker vouching for the new one. The judge is pure; the marker cases read and write real files in a temp directory.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type DeliveryContext,
  judgeTranscriptDelta,
  markProfileDelivered,
  parseMarker,
  profileWasDelivered,
} from "../../../context/profileDelivery.js";
import { ProfileDeliveryErrors } from "../../../context/profileDeliveryErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const USER = `${JSON.stringify({ message: { content: "go", role: "user" }, type: "user" })}\n`;
const TURN = `${JSON.stringify({ message: { content: [], role: "assistant" }, type: "assistant" })}\n`;
const BOUNDARY = `${JSON.stringify({ content: "Conversation compacted", subtype: "compact_boundary", type: "system" })}\n`;
const CODEX_BOUNDARY = `${JSON.stringify({ payload: { message: "" }, type: "compacted" })}\n`;
/** A message that QUOTES a boundary record: escaped inside a string, so it is no boundary. */
const QUOTED = `${JSON.stringify({ message: { content: '{"subtype":"compact_boundary"}', role: "user" }, type: "user" })}\n`;

/** Judge a run of transcript lines. */
function judge({ text, awaitsBoundary = false }: { text: string; awaitsBoundary?: boolean }) {
  return judgeTranscriptDelta({ awaitsBoundary, bytes: Buffer.from(text, "utf8") });
}

describe("judgeTranscriptDelta", () => {
  it("finds no compaction in ordinary turns, and judges every whole line", () => {
    expect(judge({ text: USER + TURN + QUOTED })).toEqual({
      awaitsBoundary: false,
      compacted: false,
      judged: Buffer.byteLength(USER + TURN + QUOTED),
    });
  });

  it("calls either host's boundary a compaction when none is expected", () => {
    expect([judge({ text: TURN + BOUNDARY }).compacted, judge({ text: TURN + CODEX_BOUNDARY }).compacted]).toEqual([
      true,
      true,
    ]);
  });

  it("takes the first boundary before the next turn as the expected one, and only one", () => {
    expect([
      judge({ awaitsBoundary: true, text: BOUNDARY + USER + TURN }),
      judge({ awaitsBoundary: true, text: BOUNDARY + BOUNDARY + TURN }).compacted,
      judge({ awaitsBoundary: true, text: USER }).awaitsBoundary,
    ]).toEqual([
      { awaitsBoundary: false, compacted: false, judged: Buffer.byteLength(BOUNDARY + USER + TURN) },
      true,
      true,
    ]);
  });

  it("lets the expectation lapse at a turn, so a later boundary is a compaction", () => {
    expect([
      judge({ awaitsBoundary: true, text: TURN }).awaitsBoundary,
      judge({ awaitsBoundary: true, text: TURN + BOUNDARY }).compacted,
    ]).toEqual([false, true]);
  });

  it("leaves a line still being written for the next check", () => {
    const partial = BOUNDARY.slice(0, -1);
    expect(judge({ text: USER + partial })).toEqual({
      awaitsBoundary: false,
      compacted: false,
      judged: Buffer.byteLength(USER),
    });
  });
});

describe("parseMarker", () => {
  it("reads back only what this module writes", () => {
    expect(
      [
        "profile-delivered v1\n12\nsettled\n/t.jsonl\n",
        "profile-delivered v1\n0\nawaits-boundary\n\n",
        "",
        "profile-delivered v1\n-1\nsettled\n\n",
        "profile-delivered v1\n0\nmaybe\n\n",
        "profile-delivered v1\nunread\nsettled\n/t.jsonl\n",
        "profile-delivered v1\nunread\nsettled\n\n",
      ].map((text) => parseMarker({ text })),
    ).toEqual([
      { awaitsBoundary: false, offset: 12, transcript: "/t.jsonl" },
      { awaitsBoundary: true, offset: 0, transcript: undefined },
      undefined,
      undefined,
      undefined,
      { awaitsBoundary: false, offset: "unread", transcript: "/t.jsonl" },
      undefined,
    ]);
  });
});

describe("a marker against its transcript", () => {
  let dir = "";
  let transcript = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "profile-delivery-"));
    transcript = join(dir, "session.jsonl");
    writeFileSync(transcript, USER);
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** The context a main thread's payload names, against this test's transcript. */
  function context({ awaitsBoundary = false }: { awaitsBoundary?: boolean } = {}): DeliveryContext {
    return { awaitsBoundary, id: "s-1", transcriptPath: transcript };
  }

  /** Whether the marker vouches for the context now. */
  function delivered(): boolean {
    return unwrap(profileWasDelivered({ context: context(), home: dir }));
  }

  it("vouches through ordinary turns and stops at a compaction no SessionStart answered", () => {
    unwrap(markProfileDelivered({ context: context(), home: dir }));
    appendFileSync(transcript, TURN);
    const beforeCompaction = delivered();
    appendFileSync(transcript, BOUNDARY);
    expect([beforeCompaction, delivered(), delivered()]).toEqual([true, false, false]);
  });

  it("advances its offset past what each check read", () => {
    const path = unwrap(markProfileDelivered({ context: context(), home: dir }));
    appendFileSync(transcript, TURN);
    delivered();
    expect(parseMarker({ text: readFileSync(path, "utf8") })).toEqual({
      awaitsBoundary: false,
      offset: Buffer.byteLength(USER + TURN),
      transcript,
    });
  });

  it("answers its own compaction's boundary, landing after the SessionStart that wrote it", () => {
    unwrap(markProfileDelivered({ context: context({ awaitsBoundary: true }), home: dir }));
    appendFileSync(transcript, BOUNDARY + USER + TURN);
    const afterOwn = delivered();
    appendFileSync(transcript, BOUNDARY);
    expect([afterOwn, delivered()]).toEqual([true, false]);
  });

  it("lets a compaction's expectation lapse when its boundary was already written", () => {
    appendFileSync(transcript, BOUNDARY);
    unwrap(markProfileDelivered({ context: context({ awaitsBoundary: true }), home: dir }));
    appendFileSync(transcript, TURN);
    const afterTurn = delivered();
    appendFileSync(transcript, BOUNDARY);
    expect([afterTurn, delivered()]).toEqual([true, false]);
  });

  it("starts a new marker before a line the host is still writing, so a boundary finished after it counts", () => {
    appendFileSync(transcript, BOUNDARY.slice(0, 10));
    unwrap(markProfileDelivered({ context: context(), home: dir }));
    appendFileSync(transcript, BOUNDARY.slice(10));
    expect(delivered()).toBe(false);
  });

  it("vouches for nothing against another transcript, a shorter one, or none", () => {
    unwrap(markProfileDelivered({ context: context(), home: dir }));
    const other = unwrap(
      profileWasDelivered({ context: { ...context(), transcriptPath: join(dir, "other.jsonl") }, home: dir }),
    );
    const none = unwrap(profileWasDelivered({ context: { ...context(), transcriptPath: undefined }, home: dir }));
    writeFileSync(transcript, "");
    expect([other, none, delivered()]).toEqual([false, false, false]);
  });

  it("vouches on the marker alone for a host that names no transcript, and refuses an id with a separator", () => {
    const bare: DeliveryContext = { awaitsBoundary: false, id: "s-2", transcriptPath: undefined };
    unwrap(markProfileDelivered({ context: bare, home: dir }));
    const traversal = markProfileDelivered({ context: { ...bare, id: "../s-2" }, home: dir });
    expect(unwrap(profileWasDelivered({ context: bare, home: dir }))).toBe(true);
    expect(unwrapErr(traversal)).toEqual(ProfileDeliveryErrors.contextIdInvalid({ contextId: "../s-2" }));
  });

  // A directory at the transcript's path fails every read whoever runs the test, where a chmod would not stop root.
  it("vouches for ONE call with a marker whose transcript cannot be read, then holds and redelivers", () => {
    rmSync(transcript);
    mkdirSync(transcript);
    const path = unwrap(markProfileDelivered({ context: context(), home: dir }));
    const marked = parseMarker({ text: readFileSync(path, "utf8") });
    expect([marked, delivered(), delivered()]).toEqual([
      { awaitsBoundary: false, offset: "unread", transcript },
      true,
      false,
    ]);
  });

  it("drops an unread marker once the transcript can be read, so the next reload marks a real offset", () => {
    rmSync(transcript);
    mkdirSync(transcript);
    unwrap(markProfileDelivered({ context: context(), home: dir }));
    rmSync(transcript, { recursive: true });
    writeFileSync(transcript, USER);
    const onceReadable = delivered();
    unwrap(markProfileDelivered({ context: context(), home: dir }));
    expect([onceReadable, delivered()]).toEqual([false, true]);
  });

  it("holds a numbered marker whose transcript can no longer be read, naming the read", () => {
    unwrap(markProfileDelivered({ context: context(), home: dir }));
    rmSync(transcript);
    mkdirSync(transcript);
    const failure = unwrapErr(profileWasDelivered({ context: context(), home: dir }));
    expect(failure).toMatchObject({ code: "TRANSCRIPT_UNREADABLE", path: transcript });
    expect(failure.message).toContain(`the transcript ${transcript} could not be read`);
  });
});
