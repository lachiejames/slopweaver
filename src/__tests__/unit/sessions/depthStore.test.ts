/**
 * {@link readContextDepth} against a real temp transcript — a genuine round-trip, which `testing.md` allows
 * and which is the only way to prove the tail boundary this module owns.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readContextDepth, readContextDepthAt } from "../../../sessions/depthStore.js";
import { DEPTH_TAIL_BYTES } from "../../../sessions/tokenDepth.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One transcript line carrying a turn's usage. */
function usageLine({ id, cacheRead }: { id: string; cacheRead: number }): string {
  return JSON.stringify({
    message: { id, model: "claude-opus-5", usage: { cache_read_input_tokens: cacheRead, output_tokens: 7 } },
    type: "assistant",
  });
}

/** A `projects/<dir>/<sessionId>.jsonl` tree holding one transcript. */
function projectsWith({ sessionId, text }: { sessionId: string; text: string }): string {
  const projectsDir = mkdtempSync(join(tmpdir(), "slopweaver-depth-"));
  fixtureDirs.push(projectsDir);
  const projectDir = join(projectsDir, "-a-repo");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), text, "utf8");
  return projectsDir;
}

describe("readContextDepth", () => {
  it("reads the newest turn's depth out of a transcript", () => {
    const text = `${usageLine({ cacheRead: 11, id: "msg_old" })}\n${usageLine({ cacheRead: 4_242, id: "msg_new" })}\n`;

    const read = readContextDepth({ projectsDir: projectsWith({ sessionId: "s1", text }), sessionId: "s1" });

    expect(read).toEqual({
      known: true,
      value: { depthTokens: 4_242, messageId: "msg_new", model: "claude-opus-5" },
    });
  });

  it("finds the newest turn past a bound's worth of earlier bytes, dropping the fragment the tail starts on", () => {
    const filler = `${JSON.stringify({ pad: "x".repeat(4_000), type: "mode" })}\n`;
    const text = `${filler.repeat(Math.ceil(DEPTH_TAIL_BYTES / filler.length) + 1)}${usageLine({ cacheRead: 88, id: "msg_new" })}\n`;

    const read = readContextDepth({ projectsDir: projectsWith({ sessionId: "s2", text }), sessionId: "s2" });

    expect(read).toEqual({ known: true, value: { depthTokens: 88, messageId: "msg_new", model: "claude-opus-5" } });
  });

  it("says why rather than reporting a zero when the session has no transcript yet", () => {
    const projectsDir = projectsWith({ sessionId: "s3", text: "" });

    expect(readContextDepth({ projectsDir, sessionId: "absent" })).toEqual({
      known: false,
      why: "no transcript file exists for this session id yet",
    });
  });

  it("says why when the registry recorded no session id at all", () => {
    const projectsDir = projectsWith({ sessionId: "s4", text: "" });

    expect(readContextDepth({ projectsDir, sessionId: "" })).toEqual({
      known: false,
      why: "the registry recorded no session id, so no transcript can be located",
    });
  });

  it("says why when the transcript exists but holds no turn", () => {
    const projectsDir = projectsWith({ sessionId: "s5", text: `${JSON.stringify({ type: "mode" })}\n` });

    expect(readContextDepth({ projectsDir, sessionId: "s5" })).toEqual({
      known: false,
      why: `no complete assistant turn was found in the last ${String(DEPTH_TAIL_BYTES)} bytes of the transcript`,
    });
  });

  it("never reads a transcript path that is not a regular file — a FIFO there would block the reader", () => {
    // A directory takes the same not-a-regular-file branch a FIFO does, with no process spawned to make one.
    const path = mkdtempSync(join(tmpdir(), "slopweaver-depth-dir-"));
    fixtureDirs.push(path);

    expect(readContextDepthAt({ path })).toEqual({
      known: false,
      why: `the transcript could not be read: Error: ${path} is not a regular file, so it is not read`,
    });
  });
});
