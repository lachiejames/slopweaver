/*
 * What a worker reports of a tool call: the digest of its id, its kind and status, and nothing the call was given or
 * produced. The first case is the privacy pin — an ACP tool call whose title IS its command, and whose name holds a
 * command, must cross with neither; the second, one whose id IS a one-word command, must not carry that word.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  claudeToolKindOf,
  codexToolActivityOf,
  knownToolFields,
  toolCallDigest,
} from "../../src/sessionWorker/toolActivity";

const SECRET = "FIXTURE-SECRET-TOKEN";

const digestOf = ({ value }: { value: string }): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("codexToolActivityOf", () => {
  it("carries neither a title that is the command nor a name holding one, nor any input or output", () => {
    const update = {
      _meta: { note: SECRET },
      content: [{ content: { text: SECRET, type: "text" }, type: "content" }],
      kind: "execute",
      locations: [{ path: `/work/acme/${SECRET}` }],
      name: `curl -H "Authorization: ${SECRET}" https://acme.example`,
      rawInput: { command: `export TOKEN=${SECRET}` },
      rawOutput: { stdout: SECRET },
      sessionUpdate: "tool_call",
      status: "in_progress",
      title: `export TOKEN=${SECRET}`,
      toolCallId: "call_1",
    };
    const activity = codexToolActivityOf({ update });
    expect(activity).toEqual({ status: "in_progress", toolCallId: digestOf({ value: "call_1" }), toolKind: "execute" });
    expect(JSON.stringify(update)).toContain(SECRET);
    expect(JSON.stringify(activity)).not.toContain(SECRET);
    expect(JSON.stringify(activity)).not.toContain("export");
  });

  it("crosses an id that is a one-word command as its digest, so the word never crosses and the call still pairs", () => {
    const update = {
      kind: "execute",
      rawInput: { command: "whoami" },
      sessionUpdate: "tool_call",
      toolCallId: "whoami",
    };
    const start = codexToolActivityOf({ update });
    const end = codexToolActivityOf({
      update: { sessionUpdate: "tool_call_update", status: "completed", toolCallId: "whoami" },
    });
    expect([start, end]).toEqual([
      { toolCallId: digestOf({ value: "whoami" }), toolKind: "execute" },
      { status: "completed", toolCallId: digestOf({ value: "whoami" }) },
    ]);
    expect(JSON.stringify([start, end])).not.toContain("whoami");
  });

  it("keeps a name that is a bare identifier", () => {
    const update = { kind: "read", name: "read_file", sessionUpdate: "tool_call", status: "pending", toolCallId: "c2" };
    expect(codexToolActivityOf({ update })).toEqual({
      name: "read_file",
      status: "pending",
      toolCallId: digestOf({ value: "c2" }),
      toolKind: "read",
    });
  });

  it("leaves out a field an update sends as null, or with a value the wire does not know", () => {
    const update = { kind: null, name: null, sessionUpdate: "tool_call_update", status: "finished", toolCallId: "c3" };
    expect(codexToolActivityOf({ update })).toEqual({ toolCallId: digestOf({ value: "c3" }) });
  });

  it("reports nothing for an update that is not about a tool call, or one with no id", () => {
    expect(codexToolActivityOf({ update: { sessionUpdate: "agent_message_chunk" } })).toBeUndefined();
    expect(codexToolActivityOf({ update: { sessionUpdate: "tool_call", toolCallId: 7 } })).toBeUndefined();
  });
});

describe("toolCallDigest", () => {
  it("is SHA-256 itself: the empty id's digest is the published empty-input value", () => {
    expect(toolCallDigest({ value: "" })).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("digests every id alike: a bare identifier, a one-word command, a command line, a non-ASCII one, a digest", () => {
    const ids = ["toolu_01", "pwd", `cat /work/acme/${SECRET}.txt`, "é", digestOf({ value: "pwd" })];
    expect(ids.map((value) => toolCallDigest({ value }))).toEqual(ids.map((value) => digestOf({ value })));
  });
});

describe("knownToolFields", () => {
  it("drops a name with a space or a slash, and digests every parent", () => {
    expect(
      knownToolFields({ name: undefined, parentToolCallId: "ls -la", status: undefined, toolKind: undefined }),
    ).toEqual({ parentToolCallId: digestOf({ value: "ls -la" }) });
    expect(knownToolFields({ name: "ls -la", parentToolCallId: null, status: "completed", toolKind: "read" })).toEqual({
      status: "completed",
      toolKind: "read",
    });
    expect(
      knownToolFields({ name: "/bin/sh", parentToolCallId: "p1", status: undefined, toolKind: undefined }),
    ).toEqual({ parentToolCallId: digestOf({ value: "p1" }) });
  });
});

describe("claudeToolKindOf", () => {
  it("names each Claude Code tool's kind, and any other tool other", () => {
    expect(
      ["Bash", "Read", "Edit", "Write", "Grep", "WebFetch", "Task", "mcp__acme__x"].map((name) =>
        claudeToolKindOf({ name }),
      ),
    ).toEqual(["execute", "read", "edit", "edit", "search", "fetch", "delegate", "other"]);
  });
});
