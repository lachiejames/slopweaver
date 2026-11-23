import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  decodeTranscriptLine,
  foldWorkerLog,
  sanitiseLeakClasses,
  shortTarget,
  transcriptPath,
} from "../../../../live/turn/workerLog.js";

const toolUse = ({ input, name, ts }: { input: unknown; name: string; ts: string }) =>
  JSON.stringify({ message: { content: [{ input, name, type: "tool_use" }] }, timestamp: ts, type: "assistant" });

describe("shortTarget", () => {
  it("collapses a multi-line command onto one line", () => {
    expect(shortTarget({ raw: "python3 - <<'PY'\nimport json\nPY" })).toBe("python3 - <<'PY' import json PY");
  });

  it("truncates a long command with an ellipsis", () => {
    const long = "a".repeat(200);
    const short = shortTarget({ raw: long })!;
    expect(short.length).toBe(64);
    expect(short.endsWith("…")).toBe(true);
  });

  it("returns undefined for whitespace only", () => {
    expect(shortTarget({ raw: "   \n  " })).toBe(undefined);
  });

  it("never lets a scratchpad path's slugged home directory reach the card", () => {
    // Reproduces the reported leak exactly: a scratchpad env assignment whose path is minted from the same
    // cwd-slug Claude Code uses for its own project directories (`../../../live/turn/workerLog.ts`'s
    // `transcriptProjectDir`), so the home segment survives with dashes in place of its slashes.
    const slug = homedir().replace(/[^a-zA-Z0-9]/g, "-");
    const raw = `SP=/private/tmp/claude-501/${slug}/scratch`;
    const short = shortTarget({ raw })!;
    expect(short.includes(slug)).toBe(false);
    expect(short).toBe("SP=/private/tmp/claude-501/[path]/scratch");
  });

  it("never lets a raw absolute home path reach the card", () => {
    const raw = `cat ${homedir()}/.ssh/id_rsa`;
    const short = shortTarget({ raw })!;
    expect(short.includes(homedir())).toBe(false);
    expect(short).toBe("cat [path]/.ssh/id_rsa");
  });

  it("never lets a second, independently-reported instance through: a --brief flag naming a live state-home path", () => {
    // A second live card, reported after the first fix landed, rendered a `slopweaver turn status --brief`
    // call whose argument was this machine's own $SLOPWEAVER_HOME path. Pinned here by shape rather than by
    // the literal reported path, which named this session's own home directory.
    const raw = `slopweaver turn status --brief ${homedir()}/.slopweaver/x.json`;
    const short = shortTarget({ raw })!;
    expect(short.includes(homedir())).toBe(false);
    expect(short).toBe("slopweaver turn status --brief [path]/.slopweaver/x.json");
  });

  it("placeholders a leaked token rather than showing it", () => {
    // Assembled from parts so this file carries no literal the hygiene gate would itself flag.
    const key = ["sk", "-"].join("") + "abcdefghijklmnopqrstuvwx";
    expect(shortTarget({ raw: `curl -H 'Authorization: Bearer ${key}' https://x` })).toBe(
      "curl -H 'Authorization: Bearer [token]' https://x",
    );
  });
});

describe("sanitiseLeakClasses", () => {
  it("placeholders an absolute home path on another machine", () => {
    // Assembled from parts so this file carries no literal the hygiene gate would itself flag.
    const path = "/" + "Users/someone-else/dev/slopweaver";
    expect(sanitiseLeakClasses({ text: `rm -rf ${path}` })).toBe("rm -rf [path]/dev/slopweaver");
  });

  it("placeholders a raw Slack-shaped workspace id", () => {
    // Assembled from parts so this file carries no literal the hygiene gate would itself flag.
    const workspaceId = "C" + "0123ABCD";
    expect(sanitiseLeakClasses({ text: `post to ${workspaceId}` })).toBe("post to [id]");
  });

  it("placeholders a DM, group, team and enterprise id, the prefixes the hygiene gate widened to", () => {
    const body = "0123" + "ABCD";
    expect(["D", "G", "T", "E"].map((prefix) => sanitiseLeakClasses({ text: `in ${prefix + body}` }))).toEqual([
      "in [id]",
      "in [id]",
      "in [id]",
      "in [id]",
    ]);
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitiseLeakClasses({ text: "gh pr view 15895" })).toBe("gh pr view 15895");
  });
});

describe("decodeTranscriptLine", () => {
  it("reads a Bash call's own command as the target", () => {
    const calls = decodeTranscriptLine({
      line: toolUse({
        input: { command: "slopweaver github read 15895" },
        name: "Bash",
        ts: "2026-08-29T10:35:00.000Z",
      }),
    });
    expect(calls).toEqual([
      { target: "slopweaver github read 15895", tool: "Bash", tsIso: "2026-08-29T10:35:00.000Z" },
    ]);
  });

  it("falls back through the target keys to file_path", () => {
    const calls = decodeTranscriptLine({
      line: toolUse({ input: { file_path: "/tmp/answer.json" }, name: "Read", ts: "2026-08-29T10:35:00.000Z" }),
    });
    expect(calls[0]?.target).toBe("/tmp/answer.json");
  });

  it("reports a tool whose input names no subject with no target rather than a guess", () => {
    const calls = decodeTranscriptLine({
      line: toolUse({ input: { limit: 5 }, name: "ListAgents", ts: "2026-08-29T10:35:00.000Z" }),
    });
    expect(calls).toEqual([{ target: undefined, tool: "ListAgents", tsIso: "2026-08-29T10:35:00.000Z" }]);
  });

  it("returns nothing for a line that is not JSON", () => {
    expect(decodeTranscriptLine({ line: "{broken" })).toEqual([]);
  });

  it("returns nothing for a line carrying no tool call", () => {
    expect(
      decodeTranscriptLine({
        line: JSON.stringify({
          message: { content: [{ text: "hello", type: "text" }] },
          timestamp: "2026-08-29T10:35:00.000Z",
        }),
      }),
    ).toEqual([]);
  });

  it("returns nothing for a line with no timestamp", () => {
    expect(decodeTranscriptLine({ line: JSON.stringify({ message: { content: [] } }) })).toEqual([]);
  });
});

describe("foldWorkerLog", () => {
  const TEXT = [
    toolUse({ input: { command: "before the turn" }, name: "Bash", ts: "2026-08-29T09:00:00.000Z" }),
    toolUse({ input: { command: "read the thread" }, name: "Bash", ts: "2026-08-29T09:56:00.000Z" }),
    toolUse({ input: { command: "gh pr view 15895" }, name: "Bash", ts: "2026-08-29T10:35:00.000Z" }),
  ].join("\n");

  it("takes the most recent call as the latest", () => {
    const folded = foldWorkerLog({ sinceIso: "2026-08-29T09:55:00.000Z", text: TEXT });
    expect(folded.latest?.target).toBe("gh pr view 15895");
  });

  it("counts only calls at or after the turn's own start, never the session's whole life", () => {
    expect(foldWorkerLog({ sinceIso: "2026-08-29T09:55:00.000Z", text: TEXT }).callsSoFar).toBe(2);
  });

  it("folds an empty transcript to nothing", () => {
    expect(foldWorkerLog({ sinceIso: "2026-08-29T09:55:00.000Z", text: "" })).toEqual({
      callsSoFar: 0,
      latest: undefined,
    });
  });
});

describe("transcriptPath", () => {
  it("slugs the cwd the way Claude Code names its project directory", () => {
    const path = transcriptPath({ cwd: "/w/dev/slopweaver", sessionId: "e0084fb3-345f" });
    expect(path.endsWith("/.claude/projects/-w-dev-slopweaver/e0084fb3-345f.jsonl")).toBe(true);
  });
});
