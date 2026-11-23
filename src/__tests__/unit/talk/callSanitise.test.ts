/*
 * A batch of call lines masked before it is appended to the call file: a credential or a private-denylist word in ANY
 * string of ANY line becomes `[REDACTED:<label>]`, counted by label, identifiers kept; a secret that outlasts every
 * pass replaces its string whole; a tool answer the masks grew past the cap keeps none, counted; and a line masking
 * would break refuses the batch rather than write it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { type CallEntry, callEntryOf } from "../../../talk/callRecord.js";
import { sanitiseCallBatch, secretOnStoredLine } from "../../../talk/callSanitise.js";
import { CallSanitiseErrors } from "../../../talk/callSanitiseErrors.js";
import { CALL_TOOL_ANSWER_MAX_BYTES } from "../../../talk/callToolLine.js";

/** A GitHub token shape, built at run time so this file never carries one. */
const TOKEN = "ghp_" + "Z".repeat(30);

const parsed = (value: Record<string, unknown>): CallEntry => callEntryOf({ value })!;

const tool = ({ answer, detail = "read a thread" }: { answer: string; detail?: string }): CallEntry =>
  parsed({
    answer,
    atIso: "2026-11-03T01:00:01.000Z",
    detail,
    kind: "tool",
    name: "read_slack_thread",
    refused: false,
  });

const SEGMENT = parsed({
  atIso: "2026-11-03T01:00:02.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "merge the pool fix",
  who: "owner",
});

describe("sanitiseCallBatch", () => {
  it("keeps a batch with no secret exactly as read", () => {
    const entries = [tool({ answer: "the pool hit 100 connections" }), SEGMENT];
    const sanitised = unwrap(sanitiseCallBatch({ denylist: [], entries }));
    expect(sanitised).toEqual({ entries, redactions: [], toolAnswersDropped: 0 });
  });

  it("masks a credential in a tool answer and a denylist word in the owner's words, counted by label, an identifier kept", () => {
    const entries = [
      tool({ answer: `token ${TOKEN} again ${TOKEN} in C0SYN000001` }),
      parsed({ ...SEGMENT, text: "the key is AcmeSecretWord" }),
    ];
    const sanitised = unwrap(sanitiseCallBatch({ denylist: ["acmesecretword"], entries }));
    expect(sanitised.entries.map((entry) => (entry.kind === "tool" ? entry.answer : null))).toEqual([
      "token [REDACTED:github-oauth-token] again [REDACTED:github-oauth-token] in C0SYN000001",
      null,
    ]);
    expect(sanitised.entries[1]).toEqual({ ...SEGMENT, text: "the key is [REDACTED:denylist]" });
    expect(sanitised.redactions).toEqual([
      { count: 2, label: "github-oauth-token" },
      { count: 1, label: "denylist" },
    ]);
  });

  it("masks a tool line's detail as well as its answer, since the import refuses the whole file on either", () => {
    const sanitised = unwrap(
      sanitiseCallBatch({ denylist: [], entries: [tool({ answer: "ok", detail: `read with ${TOKEN}` })] }),
    );
    expect(sanitised.entries).toEqual([tool({ answer: "ok", detail: "read with [REDACTED:github-oauth-token]" })]);
  });

  it("masks the same batch the same way twice, so a retried batch writes the same lines", () => {
    const entries = [tool({ answer: `token ${TOKEN}` })];
    const first = unwrap(sanitiseCallBatch({ denylist: [], entries }));
    expect(unwrap(sanitiseCallBatch({ denylist: [], entries })).entries).toEqual(first.entries);
    expect(unwrap(sanitiseCallBatch({ denylist: [], entries: first.entries }))).toEqual({
      entries: first.entries,
      redactions: [],
      toolAnswersDropped: 0,
    });
  });

  it("replaces a string whole when a secret outlasts every masking pass", () => {
    const tokens = Array.from({ length: 9 }, (_, i) => "ghp_" + "Q".repeat(29) + String(i));
    const sanitised = unwrap(sanitiseCallBatch({ denylist: [], entries: [tool({ answer: tokens.join(" ") })] }));
    expect(sanitised.entries).toEqual([tool({ answer: "[REDACTED:github-oauth-token]" })]);
    expect(sanitised.redactions).toEqual([{ count: 9, label: "github-oauth-token" }]);
  });

  it("keeps no answer a short denylist word's markers grew past the cap, and keeps the line", () => {
    const answer = "x ".repeat(CALL_TOOL_ANSWER_MAX_BYTES / 2);
    const sanitised = unwrap(sanitiseCallBatch({ denylist: ["x"], entries: [tool({ answer })] }));
    expect(sanitised.toolAnswersDropped).toBe(1);
    expect(sanitised.entries.map((entry) => [entry.kind, entry.kind === "tool" ? entry.answer : "?"])).toEqual([
      ["tool", undefined],
    ]);
  });

  it("finds a secret on a line as it will be written, a field name included, and none on a clean batch", () => {
    const stamped = { ...SEGMENT, storedIso: "2026-11-03T01:00:03.000Z" } as CallEntry;
    expect(secretOnStoredLine({ denylist: ["storediso"], entries: [tool({ answer: "ok" }), stamped] })).toEqual({
      kind: "segment",
      labels: ["denylist"],
    });
    expect(secretOnStoredLine({ denylist: [], entries: [tool({ answer: "ok" }), stamped] })).toBeUndefined();
  });

  it("refuses the batch when masking breaks a line's shape, rather than write it", () => {
    const refused = unwrapErr(sanitiseCallBatch({ denylist: ["2026"], entries: [SEGMENT] }));
    expect(refused).toEqual(CallSanitiseErrors.shapeBroken({ kind: "segment" }));
    expect(refused.message).toBe(
      "nothing appended: masking a secret out of a segment line left it a line the call file cannot hold",
    );
  });
});
