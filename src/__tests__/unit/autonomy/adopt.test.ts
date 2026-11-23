import { describe, expect, it } from "vitest";

import {
  ADOPT_CANDIDATE_MAX_BYTES,
  adoptHandRecordedAutonomyObject,
  decodeCandidate,
  recordingProvenanceWitness,
} from "../../../autonomy/adopt.js";
import { duplicateTopLevelKey } from "../../../autonomy/duplicateKey.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BACKUP = "state:ledgers/autonomy.pre-adopt-2026-09-13T05-45-38-326Z.jsonl";
const SHA = "6eea45769df13b332b6a82313b10326e380460f7cbfa33a91e62db19df0e43b8";

/** A hand-written act as one of the real pre-verb sessions wrote it: no witness. */
function witnessless(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    actionId: "h249-t0-rule-secret",
    bySession: "fresh-supervisor-handoff-9249",
    doneIso: "2026-09-12T19:51:24Z",
    kind: "handover.rule.finding",
    subject: "an-unregistered-secret-in-the-ambient-home-refuses-every-push-on-the-machine",
    why: "OWNER RULING 245-2: an unasked finding that is obviously wanted lands autonomously.",
    ...over,
  };
}

describe("decodeCandidate", () => {
  it("decodes one complete object", () => {
    expect(decodeCandidate({ text: '{"a":1}' })!["a"]).toBe(1);
  });

  it("answers undefined for a half-open object, which is a candidate still being accumulated", () => {
    expect(decodeCandidate({ text: '{\n  "a": 1,' })).toBeUndefined();
  });

  it("answers undefined for a JSON array, which is not a ledger row", () => {
    expect(decodeCandidate({ text: "[1,2]" })).toBeUndefined();
  });

  it("answers undefined for a bare scalar", () => {
    expect(decodeCandidate({ text: '"just a string"' })).toBeUndefined();
  });

  it("decodes an object whose prose contains braces, which a brace count would mis-frame", () => {
    const decoded = decodeCandidate({ text: '{"why":"the shape is { open } here"}' });

    expect(decoded!["why"]).toBe("the shape is { open } here");
  });
});

describe("duplicateTopLevelKey", () => {
  it("finds a key the row names twice, which JSON.parse would silently resolve to the last", () => {
    const text =
      '{"actionId":"a-one","why":"CI failed; merge was refused","why":"CI green; merged",' +
      '"subject":"https://example.com/pr/1"}';

    expect(duplicateTopLevelKey({ text })).toBe("why");
  });

  it("answers undefined when every top-level key appears once", () => {
    expect(duplicateTopLevelKey({ text: '{"a":"1","b":"2","c":"3"}' })).toBeUndefined();
  });

  it("does not mistake a repeated key NESTED inside a value for a top-level duplicate", () => {
    expect(duplicateTopLevelKey({ text: '{"a":{"x":"1"},"b":{"x":"2"}}' })).toBeUndefined();
  });

  it("does not mistake a colon inside a string value for a key", () => {
    expect(duplicateTopLevelKey({ text: '{"why":"the ratio is a:b","witness":"a:b again"}' })).toBeUndefined();
  });

  it("does not mistake a braced or quoted run inside prose for structure", () => {
    expect(duplicateTopLevelKey({ text: '{"why":"they said \\"a\\": {open}","witness":"ok"}' })).toBeUndefined();
  });

  it("finds a duplicate in a pretty-printed object too", () => {
    const text = ["{", '  "why": "first",', '  "kind": "enqueue",', '  "why": "second"', "}"].join("\n");

    expect(duplicateTopLevelKey({ text })).toBe("why");
  });
});

describe("recordingProvenanceWitness", () => {
  it("says the act was hand-recorded and names the preserved original, its digest and the line", () => {
    const text = recordingProvenanceWitness({
      actionId: "h249-t0-rule-secret",
      backupReference: BACKUP,
      sha256: SHA,
      source: { firstLine: 25, lastLine: 25, value: witnessless() },
      substitutions: [],
    });

    expect(text).toBe(
      "Hand-recorded row only, no command witness was captured: this act was hand-appended as " +
        "h249-t0-rule-secret before `slopweaver autonomy record` existed. Preserved original " +
        `${BACKUP}, sha256 ${SHA}, line 25.`,
    );
  });

  it("states a multi-line span as a range", () => {
    const text = recordingProvenanceWitness({
      actionId: "weekend-dogfood-p16",
      backupReference: BACKUP,
      sha256: SHA,
      source: { firstLine: 53, lastLine: 61, value: witnessless() },
      substitutions: [],
    });

    expect(text).toContain("lines 53-61.");
  });

  it("quotes an outcome as the acting session's own assertion rather than as evidence", () => {
    const text = recordingProvenanceWitness({
      actionId: "open-prs-enqueue-codex-floor-waived",
      backupReference: BACKUP,
      sha256: SHA,
      source: { firstLine: 48, lastLine: 48, value: witnessless({ outcome: "merged" }) },
      substitutions: [],
    });

    expect(text).toContain("Recorded outcome (the acting session's own assertion): merged.");
  });

  it("quotes a replaced subject, so the substitution is visible on the owner's page", () => {
    const text = recordingProvenanceWitness({
      actionId: "handoff-9251-close-parked-23-0110",
      backupReference: BACKUP,
      sha256: SHA,
      source: { firstLine: 46, lastLine: 46, value: witnessless() },
      substitutions: [{ field: "subject", original: "23 workspaces parked 10h on landed pages" }],
    });

    expect(text).toContain('Original subject: "23 workspaces parked 10h on landed pages".');
  });

  it("quotes a replaced doneIso, so a restamped instant is readable on the row itself", () => {
    const text = recordingProvenanceWitness({
      actionId: "257-1-dogfood-bugs-636-landed",
      backupReference: BACKUP,
      sha256: SHA,
      source: { firstLine: 73, lastLine: 73, value: witnessless() },
      substitutions: [{ field: "doneIso", original: "2026-09-14T01:1xZ" }],
    });

    expect(text).toContain('Original doneIso: "2026-09-14T01:1xZ".');
  });

  it("says a field the row carried nothing in was absent, rather than quoting silence", () => {
    const text = recordingProvenanceWitness({
      actionId: "257-1-dogfood-bugs-636-landed",
      backupReference: BACKUP,
      sha256: SHA,
      source: { firstLine: 73, lastLine: 73, value: witnessless() },
      substitutions: [{ field: "doneIso", original: undefined }],
    });

    expect(text).toContain("The row carried no doneIso.");
  });
});

describe("adoptHandRecordedAutonomyObject", () => {
  it("gives a witness-less row a provenance witness and reports the patched field", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: { firstLine: 25, lastLine: 25, value: witnessless() },
      }),
    );

    expect(adopted.change.fields).toEqual(["witness", "said"]);
    expect(adopted.change.compacted).toBe(false);
    expect(adopted.record.actionId).toBe("h249-t0-rule-secret");
    expect(adopted.wire).toContain("Hand-recorded row only");
  });

  it("preserves a field no type in this repository declares", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: {
          firstLine: 48,
          lastLine: 48,
          value: witnessless({
            actionId: "open-prs-enqueue-codex-floor-waived",
            outcome: "merged",
            subject: "https://github.com/lachiejames/slopweaver/pull/591",
          }),
        },
      }),
    );

    expect(adopted.wire).toContain('"outcome":"merged"');
  });

  it("leaves a well-formed row alone and reports no patched field", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: {
          firstLine: 1,
          lastLine: 1,
          value: witnessless({
            subject: "https://github.com/acme/acme-admin/pull/16644",
            witness: "slopweaver github enqueue --pr 16644 -> queued at position 1",
          }),
        },
      }),
    );

    expect(adopted.change.fields).toEqual(["said"]);
    expect(adopted.wire).toContain("queued at position 1");
  });

  it("reports a pretty-printed object as compacted", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: {
          firstLine: 53,
          lastLine: 61,
          value: witnessless({
            subject: "https://acme.slack.com/archives/D0SYN000001/p1789270915939139",
            witness: "ts=1789270915.939139",
          }),
        },
      }),
    );

    expect(adopted.change.compacted).toBe(true);
    expect(adopted.change.fields).toEqual(["said"]);
  });

  it("replaces a subject when the caller names the act, and patches both fields", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [
          {
            actionId: "handoff-9251-close-parked-23-0110",
            field: "subject",
            replacement: "state:supervisor-scratch/handoff-9251/close251-list.txt",
          },
        ],
        sha256: SHA,
        source: {
          firstLine: 46,
          lastLine: 46,
          value: witnessless({
            actionId: "handoff-9251-close-parked-23-0110",
            subject: "23 workspaces parked 10h on landed pages or released runs",
          }),
        },
      }),
    );

    expect(adopted.change.fields).toEqual(["subject", "witness", "said"]);
    expect(adopted.record.actionId).toBe("handoff-9251-close-parked-23-0110");
    expect(adopted.wire).toContain('"subject":"state:supervisor-scratch/handoff-9251/close251-list.txt"');
    expect(adopted.wire).toContain(
      'Original subject: \\"23 workspaces parked 10h on landed pages or released runs\\".',
    );
  });

  it("refuses to replace a subject that already resolves, which would rewrite history", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [
          {
            actionId: "h249-t0-rule-secret",
            field: "subject",
            replacement: "https://github.com/lachiejames/slopweaver/pull/1",
          },
        ],
        sha256: SHA,
        source: { firstLine: 25, lastLine: 25, value: witnessless({ subject: "https://example.com/pr/1" }) },
      }),
    );

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("already carries a checkable subject");
  });

  it("replaces a doneIso no clock can parse, and quotes the placeholder in the row's own witness", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [
          {
            actionId: "257-1-dogfood-bugs-636-landed",
            field: "doneIso",
            replacement: "2026-09-14T01:15:00Z",
          },
        ],
        sha256: SHA,
        source: {
          firstLine: 73,
          lastLine: 73,
          value: witnessless({
            actionId: "257-1-dogfood-bugs-636-landed",
            doneIso: "2026-09-14T01:1xZ",
            subject: "https://github.com/lachiejames/slopweaver/pull/636",
            witness: "slopweaver github enqueue --number 636 -> queued into main at position 1",
          }),
        },
      }),
    );

    expect(adopted.change.fields).toEqual(["doneIso", "witness", "said"]);
    expect(adopted.record.actionId).toBe("257-1-dogfood-bugs-636-landed");
    expect(adopted.wire).toContain('"doneIso":"2026-09-14T01:15:00Z"');
    expect(adopted.wire).toContain('Original doneIso: \\"2026-09-14T01:1xZ\\".');
  });

  it("keeps every word of an existing witness when a substitution appends to it", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [
          { actionId: "257-1-dogfood-bugs-636-landed", field: "doneIso", replacement: "2026-09-14T01:15:00Z" },
        ],
        sha256: SHA,
        source: {
          firstLine: 73,
          lastLine: 73,
          value: witnessless({
            actionId: "257-1-dogfood-bugs-636-landed",
            doneIso: "2026-09-14T01:1xZ",
            subject: "https://github.com/lachiejames/slopweaver/pull/636",
            witness: "slopweaver github enqueue --number 636 -> queued into main at position 1",
          }),
        },
      }),
    );

    expect(adopted.wire).toContain(
      '"witness":"slopweaver github enqueue --number 636 -> queued into main at position 1 ' +
        'Original doneIso: \\"2026-09-14T01:1xZ\\"."',
    );
    expect(adopted.wire).not.toContain("Hand-recorded row only");
  });

  it("repairs both fields of one row when a caller names each, and quotes both originals", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [
          { actionId: "a-close", field: "subject", replacement: "state:supervisor-scratch/close251-list.txt" },
          { actionId: "a-close", field: "doneIso", replacement: "2026-09-13T01:10:38Z" },
        ],
        sha256: SHA,
        source: {
          firstLine: 46,
          lastLine: 46,
          value: witnessless({
            actionId: "a-close",
            doneIso: "2026-09-13T01:1",
            subject: "23 workspaces parked 10h on landed pages",
          }),
        },
      }),
    );

    expect(adopted.change.fields).toEqual(["subject", "doneIso", "witness", "said"]);
    expect(adopted.wire).toContain('"doneIso":"2026-09-13T01:10:38Z"');
    // The two clauses ASSERTED TOGETHER, because the defect was the join rather than either half:
    // an earlier version ran them together as `Original doneIso: 2026-09-13T01:1 Original subject: 23`,
    // with nothing marking where the first value ended. Splitting this into two `toContain`s would pass
    // on exactly the output that was wrong.
    expect(adopted.wire).toContain(
      'Original subject: \\"23 workspaces parked 10h on landed pages\\". ' + 'Original doneIso: \\"2026-09-13T01:1\\".',
    );
  });

  it("refuses to restamp a doneIso a clock can already parse", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [{ actionId: "h249-t0-rule-secret", field: "doneIso", replacement: "2026-01-01T00:00:00Z" }],
        sha256: SHA,
        source: { firstLine: 25, lastLine: 25, value: witnessless() },
      }),
    );

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("already carries a doneIso a clock can parse");
  });

  it("refuses two replacements for one field of one act rather than silently taking the first", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [
          { actionId: "a-close", field: "doneIso", replacement: "2026-09-13T01:10:38Z" },
          { actionId: "a-close", field: "doneIso", replacement: "2026-09-13T09:10:38Z" },
        ],
        sha256: SHA,
        source: {
          firstLine: 46,
          lastLine: 46,
          value: witnessless({
            actionId: "a-close",
            doneIso: "2026-09-13T01:1",
            subject: "https://github.com/lachiejames/slopweaver/pull/636",
          }),
        },
      }),
    );

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("is named twice for `doneIso`");
  });

  it("names a doneIso the register cannot read when no caller offered a replacement", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: {
          firstLine: 73,
          lastLine: 73,
          value: witnessless({
            doneIso: "2026-09-14T01:1xZ",
            subject: "https://github.com/lachiejames/slopweaver/pull/636",
          }),
        },
      }),
    );

    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("2026-09-14T01:1xZ");
  });

  it("does not read a replaceable field through the prototype chain", () => {
    // A polluted `doneIso` up the chain, holding a readable instant, would make a row carrying none of its
    // own look already repaired — and the one replacement that fixes the register would then be refused as
    // history-rewriting. The row below owns every field EXCEPT doneIso, which only its prototype carries.
    const polluted = {
      actionId: "a-close",
      bySession: "fresh-supervisor-handoff-9251",
      kind: "cmux.close.parked",
      subject: "state:supervisor-scratch/close251-list.txt",
      why: "owner turn 251-2: close what is parked on a landed page.",
    };
    Object.setPrototypeOf(polluted, { doneIso: "2026-01-01T00:00:00Z" });

    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [{ actionId: "a-close", field: "doneIso", replacement: "2026-09-13T01:10:38Z" }],
        sha256: SHA,
        source: { firstLine: 46, lastLine: 46, value: polluted },
      }),
    );

    expect(adopted.wire).toContain('"doneIso":"2026-09-13T01:10:38Z"');
    expect(adopted.wire).toContain("The row carried no doneIso.");
  });

  it("refuses a row carrying a number, which a JSON round trip cannot promise to carry unchanged", () => {
    // A number past 2^53, which `JSON.parse` silently rounds — the counterexample a review built,
    // written through `Number` because the literal itself is what `no-loss-of-precision` refuses to compile.
    const beyondDouble = Number("9007199254740993");
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: { firstLine: 4, lastLine: 4, value: witnessless({ externalId: beyondDouble }) },
      }),
    );

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain('carries "externalId", which is not a string');
  });

  it("refuses a row carrying a nested value for the same reason", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: { firstLine: 4, lastLine: 4, value: witnessless({ meta: { nested: "value" } }) },
      }),
    );

    expect(error.message).toContain('carries "meta", which is not a string');
  });

  it("refuses an object carrying no actionId, which no report could name", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: { firstLine: 7, lastLine: 7, value: { kind: "github.pr.open" } },
      }),
    );

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("carries no actionId");
  });

  it("refuses a row whose subject is prose and which names no replacement", () => {
    const error = unwrapErr(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: {
          firstLine: 46,
          lastLine: 46,
          value: witnessless({ subject: "23 workspaces parked 10h on landed pages or released runs" }),
        },
      }),
    );

    expect(error.code).toBe("UNCHECKABLE_SUBJECT");
  });

  it("leaves a steer row's missing witness alone, because a steer never carries one", () => {
    const adopted = unwrap(
      adoptHandRecordedAutonomyObject({
        backupReference: BACKUP,
        replacements: [],
        sha256: SHA,
        source: {
          firstLine: 27,
          lastLine: 27,
          value: {
            actionId: "h249-t0-rule-secret",
            bySession: "fresh-supervisor-handoff-9249",
            steer: "yep, exactly right",
            steeredIso: "2026-09-12T20:00:00Z",
          },
        },
      }),
    );

    expect(adopted.change.fields).toEqual([]);
    expect(adopted.wire).not.toContain("Hand-recorded row only");
  });

  it("bounds one candidate against the row field ceilings rather than a picked number", () => {
    expect(ADOPT_CANDIDATE_MAX_BYTES).toBe(60000);
  });
});

describe("duplicateTopLevelKey against escaped spellings", () => {
  it("finds a duplicate written with a unicode escape, which the parser reads as the same key", () => {
    const text =
      '{"actionId":"a-one","why":"CI failed; merge was refused","\\u0077hy":"CI green; merged",' +
      '"subject":"https://example.com/pr/1"}';

    expect(duplicateTopLevelKey({ text })).toBe("why");
  });

  it("finds a duplicate written with an escaped quote inside the key", () => {
    expect(duplicateTopLevelKey({ text: '{"a\\"b":"1","a\\u0022b":"2"}' })).toBe('a"b');
  });

  it("still answers undefined when two escaped keys denote different strings", () => {
    expect(duplicateTopLevelKey({ text: '{"\\u0077hy":"1","witness":"2"}' })).toBeUndefined();
  });
});

describe("a substitution clause whose original carries a double quote", () => {
  it("stays delimited, because the quoting escapes rather than assumes", () => {
    const text = recordingProvenanceWitness({
      actionId: "quote-carrier",
      backupReference: "state:ledgers/autonomy.pre-adopt-2026-09-13T05-45-38-326Z.jsonl",
      sha256: "6eea45769df13b332b6a82313b10326e380460f7cbfa33a91e62db19df0e43b8",
      source: { firstLine: 12, lastLine: 12, value: witnessless() },
      substitutions: [
        { field: "subject", original: 'they said "ship it" in the thread' },
        { field: "doneIso", original: "2026-09-14T01:1xZ" },
      ],
    });

    // The inner quotes are ESCAPED, so the clause's own closing quote is still the only unescaped one and
    // the two clauses cannot be read as one. Asserted together for that reason.
    expect(text).toContain(
      'Original subject: "they said \\"ship it\\" in the thread". Original doneIso: "2026-09-14T01:1xZ".',
    );
  });
});
