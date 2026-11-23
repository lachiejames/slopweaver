import { describe, expect, it } from "vitest";

import { parseAutonomyLine } from "../../../autonomy/decode.js";
import { isAutonomyActionId, isAutonomyKind, isCheckableSubject } from "../../../autonomy/fields.js";
import { buildAutonomyAction, buildAutonomySteer, isSteerRecord } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One valid act, varying only what a test cares about. */
function action({
  actionId = "16644-enqueue",
  kind = "press-merge-when-ready",
  subject = "https://github.com/acme/acme-admin/pull/16644",
  doneIso = "2026-09-12T02:06:09Z",
  bySession = "workspace:123 act-on-open-acme-admin-prs",
  why = "CI green, mergeable, every review thread resolved, no code-owner request outstanding",
  said = "I merged your pull request on the admin app — the checks had all passed and nobody was waiting to review it.",
  witness = "slopweaver github enqueue --pr 16644 -> queued at position 1",
  run,
  steer,
}: {
  actionId?: string;
  kind?: string;
  subject?: string;
  doneIso?: string;
  bySession?: string;
  why?: string;
  said?: string;
  witness?: string;
  run?: string;
  steer?: string;
} = {}): ReturnType<typeof buildAutonomyAction> {
  return buildAutonomyAction({ actionId, bySession, doneIso, kind, run, said, steer, subject, why, witness });
}

/*
 * The three FIELD predicates below moved to `../../../autonomy/fields.ts` when `said` validation grew
 * `row.ts` past the file-size ratchet, and their cases stayed here rather than moving with them. They are
 * the same assertions against the same functions, reached through the new import — a split of the SOURCE,
 * never of the claim, and `test-enshittification` measures a claim per file.
 */
describe("autonomy kinds and ids", () => {
  it("accepts the hyphenated and dotted vocabularies the register already carries", () => {
    expect(isAutonomyKind({ kind: "press-merge-when-ready" })).toBe(true);
    expect(isAutonomyKind({ kind: "press-merge-when-ready-refused" })).toBe(true);
    expect(isAutonomyKind({ kind: "slack.post.bot.no-fold" })).toBe(true);
    expect(isAutonomyKind({ kind: "slack.post.as-me.one-card" })).toBe(true);
  });

  it("refuses free text, leading and doubled separators, and casing", () => {
    expect(isAutonomyKind({ kind: "Press Merge" })).toBe(false);
    expect(isAutonomyKind({ kind: "-enqueue" })).toBe(false);
    expect(isAutonomyKind({ kind: "enqueue-" })).toBe(false);
    expect(isAutonomyKind({ kind: "enqueue--twice" })).toBe(false);
    expect(isAutonomyKind({ kind: "Enqueue" })).toBe(false);
    expect(isAutonomyKind({ kind: "a" })).toBe(false);
  });

  it("accepts the hand-minted ids a session wrote before the verb existed", () => {
    expect(isAutonomyActionId({ actionId: "16644-enqueue" })).toBe(true);
    expect(isAutonomyActionId({ actionId: "240-4-msg1-ari-example" })).toBe(true);
    expect(isAutonomyActionId({ actionId: "dev-alerts-batch-bump" })).toBe(true);
  });
});

describe("a checkable subject", () => {
  it("accepts an absolute http or https URL, query string and all", () => {
    expect(isCheckableSubject({ subject: "https://github.com/acme/acme-admin/pull/16644" })).toBe(true);
    expect(
      isCheckableSubject({
        subject: "https://acme.slack.com/archives/C0SYN000006/p1789179474210969?thread_ts=1788956581.789719",
      }),
    ).toBe(true);
    expect(isCheckableSubject({ subject: "http://localhost:3000/x" })).toBe(true);
  });

  it("accepts a handover board row slug, which resolves in one command", () => {
    expect(isCheckableSubject({ subject: "acquireoperationlock-s-stale-lock-takeover-is-not-mutually" })).toBe(true);
  });

  it("accepts a state reference to a file under the state home", () => {
    expect(isCheckableSubject({ subject: "state:supervisor-scratch/handoff-9251/close251-list.txt" })).toBe(true);
  });

  it("refuses anything the owner cannot resolve to check the act against", () => {
    expect(isCheckableSubject({ subject: "acme-admin#16644" })).toBe(false);
    expect(isCheckableSubject({ subject: "/pull/16644" })).toBe(false);
    expect(isCheckableSubject({ subject: "mailto:someone@example.com" })).toBe(false);
    expect(isCheckableSubject({ subject: "23 workspaces parked 10h on landed pages" })).toBe(false);
    expect(isCheckableSubject({ subject: "state:../../etc/passwd" })).toBe(false);
    expect(isCheckableSubject({ subject: "" })).toBe(false);
  });
});

describe("an act on something with no web page", () => {
  it("round-trips a board row subject through the builder and the parser", () => {
    const built = unwrap(action({ subject: "acquireoperationlock-s-stale-lock-takeover-is-not-mutually" }));
    const parsed = unwrap(parseAutonomyLine({ line: JSON.stringify(built), lineNumber: 1 })) as AutonomyActionRow;

    expect(built.subject).toBe("acquireoperationlock-s-stale-lock-takeover-is-not-mutually");
    expect(parsed.subject).toBe("acquireoperationlock-s-stale-lock-takeover-is-not-mutually");
  });

  it("round-trips a state reference through the builder and the parser", () => {
    const built = unwrap(action({ subject: "state:supervisor-scratch/handoff-9251/close251-list.txt" }));
    const parsed = unwrap(parseAutonomyLine({ line: JSON.stringify(built), lineNumber: 1 })) as AutonomyActionRow;

    expect(parsed.subject).toBe("state:supervisor-scratch/handoff-9251/close251-list.txt");
  });

  it("still refuses a bare reference with the subject's own error code", () => {
    expect(unwrapErr(action({ subject: "acme-admin#16644" })).code).toBe("UNCHECKABLE_SUBJECT");
  });
});

describe("building an act", () => {
  it("keeps every field it was given", () => {
    const row = unwrap(action());
    expect(row.actionId).toBe("16644-enqueue");
    expect(row.kind).toBe("press-merge-when-ready");
    expect(row.subject).toBe("https://github.com/acme/acme-admin/pull/16644");
    expect(row.doneIso).toBe("2026-09-12T02:06:09Z");
    expect(row.witness).toBe("slopweaver github enqueue --pr 16644 -> queued at position 1");
  });

  it("omits run and steer rather than writing them as undefined", () => {
    expect("run" in unwrap(action())).toBe(false);
    expect("steer" in unwrap(action())).toBe(false);
  });

  it("attaches run and an inline steer when they carry something", () => {
    const row = unwrap(action({ run: "act-on-open-acme-admin-prs", steer: "yes, keep doing that" }));
    expect(row.run).toBe("act-on-open-acme-admin-prs");
    expect(row.steer).toBe("yes, keep doing that");
  });

  it("names the field that refused it", () => {
    expect(unwrapErr(action({ kind: "Press Merge" })).code).toBe("INVALID_KIND");
    expect(unwrapErr(action({ subject: "acme-admin#16644" })).code).toBe("UNCHECKABLE_SUBJECT");
    expect(unwrapErr(action({ why: "   " })).code).toBe("INVALID_FIELD");
    expect(unwrapErr(action({ why: "   " })).message).toContain("why is empty");
    expect(unwrapErr(action({ doneIso: "yesterday" })).message).toContain("doneIso");
    expect(unwrapErr(action({ actionId: "Not An Id" })).message).toContain("actionId");
  });

  it("refuses a why longer than the serialisation bound rather than truncating it", () => {
    const error = unwrapErr(action({ why: "x".repeat(4001) }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("4001 characters, over the 4000 allowed");
  });
});

describe("the plain-words line", () => {
  it("keeps a line written in words the owner reads", () => {
    expect(unwrap(action()).said).toBe(
      "I merged your pull request on the admin app — the checks had all passed and nobody was waiting to review it.",
    );
  });

  it("refuses one naming a doctrine rule, quoting the phrase and the class", () => {
    const error = unwrapErr(action({ said: "Rule 10 made this mine to do, so I did it." }));
    expect(error.code).toBe("UNPARSABLE_SAID");
    expect(error.message).toContain('said carries "Rule 10", which is a rule-number');
  });

  it("refuses one naming a board slug", () => {
    const error = unwrapErr(action({ said: "I opened it for eight-of-the-workos-atlas-s-fourteen-declared." }));
    expect(error.code).toBe("UNPARSABLE_SAID");
    expect(error.message).toContain("which is a slug");
  });

  it("refuses one naming a session id", () => {
    const error = unwrapErr(action({ said: "Observed by ab5b7089-9ea4-4b19-9aa7-100c6277eb04 this morning." }));
    expect(error.code).toBe("UNPARSABLE_SAID");
    expect(error.message).toContain("which is a session-id");
  });

  it("refuses an empty one as an ordinary field, never as an unparsable token", () => {
    const error = unwrapErr(action({ said: "   " }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("said is empty");
  });

  it("refuses one past its own bound rather than truncating it", () => {
    const error = unwrapErr(action({ said: "x".repeat(401) }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("401 characters, over the 400 allowed");
  });

  // Built directly rather than through `action()`: a destructuring default fires on an explicit
  // `undefined`, so the helper would hand the builder its own readable line and prove nothing.
  it("omits it rather than writing it as undefined, so a row written before it existed still builds", () => {
    const row = unwrap(
      buildAutonomyAction({
        actionId: "16644-enqueue",
        bySession: "workspace:123",
        doneIso: "2026-09-12T02:06:09Z",
        kind: "press-merge-when-ready",
        run: undefined,
        said: undefined,
        steer: undefined,
        subject: "https://github.com/acme/acme-admin/pull/16644",
        why: "CI green, mergeable, no code-owner request outstanding",
        witness: "slopweaver github enqueue --pr 16644",
      }),
    );
    expect("said" in row).toBe(false);
    expect(row.why).toBe("CI green, mergeable, no code-owner request outstanding");
  });

  it("re-runs the plain-words rule over a STORED line, not only over a new one", () => {
    const line = JSON.stringify({
      actionId: "16644-enqueue",
      bySession: "workspace:123",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "press-merge-when-ready",
      said: "Rule 10 made this mine to do.",
      subject: "https://github.com/acme/acme-admin/pull/16644",
      why: "CI green",
      witness: "slopweaver github enqueue --pr 16644",
    });
    // A stored line's failures arrive as CORRUPT_ROW carrying the rule that refused them, exactly as an
    // uncheckable subject does — the caller's question about a stored line is which LINE to go and fix.
    const error = unwrapErr(parseAutonomyLine({ line, lineNumber: 3 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 3");
    expect(error.message).toContain('said carries "Rule 10", which is a rule-number');
  });

  it("parses a stored line that carries a readable one", () => {
    const line = JSON.stringify({
      actionId: "16644-enqueue",
      bySession: "workspace:123",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "press-merge-when-ready",
      said: "I merged your pull request on the admin app once every check had passed.",
      subject: "https://github.com/acme/acme-admin/pull/16644",
      why: "CI green",
      witness: "slopweaver github enqueue --pr 16644",
    });
    const row = unwrap(parseAutonomyLine({ line, lineNumber: 3 }));
    expect(isSteerRecord(row)).toBe(false);
    expect((row as AutonomyActionRow).said).toBe(
      "I merged your pull request on the admin app once every check had passed.",
    );
  });
});

describe("building a steer", () => {
  it("keeps the owner's words and the session that wrote them down", () => {
    const row = unwrap(
      buildAutonomySteer({
        actionId: "16644-enqueue",
        bySession: "supervisor",
        steer: "yep, exactly right",
        steeredIso: "2026-09-12T03:00:00Z",
      }),
    );
    expect(row.steer).toBe("yep, exactly right");
    expect(row.bySession).toBe("supervisor");
    expect(row.steeredIso).toBe("2026-09-12T03:00:00Z");
  });

  it("refuses an id that could never name an act", () => {
    const error = unwrapErr(
      buildAutonomySteer({ actionId: "Not An Id", bySession: "s", steer: "x", steeredIso: "2026-09-12T03:00:00Z" }),
    );
    expect(error.code).toBe("UNKNOWN_ACTION");
  });
});

describe("telling the two shapes apart", () => {
  it("reads an act carrying an inline steer as an act, not a steer", () => {
    const row: AutonomyActionRow = unwrap(action({ steer: "they already said this was right" }));
    expect(isSteerRecord(row)).toBe(false);
  });

  it("reads a line carrying steeredIso as a steer", () => {
    const decoded = unwrap(
      parseAutonomyLine({
        line: JSON.stringify({
          actionId: "16644-enqueue",
          bySession: "supervisor",
          steer: "yep",
          steeredIso: "2026-09-12T03:00:00Z",
        }),
        lineNumber: 1,
      }),
    );
    expect(isSteerRecord(decoded)).toBe(true);
  });
});

describe("parsing a stored line", () => {
  it("decodes the exact shape the fleet wrote before the verb existed", () => {
    const line = JSON.stringify({
      actionId: "16359-enqueue-attempt",
      bySession: "workspace:123 act-on-open-acme-admin-prs (fd64a339)",
      doneIso: "2026-09-12T02:07:26Z",
      kind: "press-merge-when-ready-refused",
      subject: "https://github.com/acme/acme-admin/pull/16359",
      why: "CI green, MERGEABLE, approved — GitHub refused the press because it is the bottom of a native stack",
      witness: "slopweaver github enqueue --pr 16359 -> 'must be enqueued using the asynchronous merge REST API'",
    });
    const row = unwrap(parseAutonomyLine({ line, lineNumber: 1 }));
    expect(isSteerRecord(row)).toBe(false);
    expect(row.actionId).toBe("16359-enqueue-attempt");
  });

  it("refuses a hybrid carrying both a steeredIso and an act's own fields", () => {
    const line = JSON.stringify({
      actionId: "16644-enqueue",
      bySession: "s",
      kind: "press-merge-when-ready",
      steer: "yep",
      steeredIso: "2026-09-12T03:00:00Z",
      subject: "https://github.com/acme/acme-admin/pull/16644",
    });
    const error = unwrapErr(parseAutonomyLine({ line, lineNumber: 4 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 4");
    expect(error.message).toContain("kind, subject");
  });

  it("names the missing field of an incomplete act", () => {
    const line = JSON.stringify({ actionId: "x-y", kind: "press-merge-when-ready" });
    expect(unwrapErr(parseAutonomyLine({ line, lineNumber: 2 })).message).toContain("subject is not a string");
  });

  it("re-runs every builder rule rather than only checking field types", () => {
    const line = JSON.stringify({
      actionId: "16644-enqueue",
      bySession: "s",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "press-merge-when-ready",
      subject: "acme-admin#16644",
      why: "w",
      witness: "v",
    });
    expect(unwrapErr(parseAutonomyLine({ line, lineNumber: 7 })).message).toContain("is not a checkable id");
  });

  it("refuses a line that is not JSON at all", () => {
    expect(unwrapErr(parseAutonomyLine({ line: "{not json", lineNumber: 9 })).message).toContain("not valid JSON");
  });
});

describe("an inherited field is never a recorded fact", () => {
  // A polluted `Object.prototype.steer` made every act ever read carry a
  // word the owner never said, which the briefing renders as their steer and the `unsteered` filter then hides.
  // Restored in a finally, so a failure here cannot leak the pollution into the rest of the lane.
  it("does not read a steer off the prototype chain", () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["steer"] = "yes, keep merging";
    try {
      const line = JSON.stringify({
        actionId: "a-one",
        bySession: "workspace:123",
        doneIso: "2026-09-12T02:06:09Z",
        kind: "press-merge-when-ready",
        subject: "https://github.com/acme/acme-admin/pull/16644",
        why: "CI green",
        witness: "queued",
      });
      const row = unwrap(parseAutonomyLine({ line, lineNumber: 1 }));
      // `Object.hasOwn`, not `in` — `in` would find the pollution itself and prove nothing.
      expect(Object.hasOwn(row, "steer")).toBe(false);
    } finally {
      delete proto["steer"];
    }
  });

  it("does not read an act's own fields off the prototype chain either", () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["kind"] = "press-merge-when-ready";
    try {
      const line = JSON.stringify({
        actionId: "a-one",
        bySession: "workspace:123",
        doneIso: "2026-09-12T02:06:09Z",
        subject: "https://github.com/acme/acme-admin/pull/16644",
        why: "CI green",
        witness: "queued",
      });
      expect(unwrapErr(parseAutonomyLine({ line, lineNumber: 1 })).message).toContain("kind is not a string");
    } finally {
      delete proto["kind"];
    }
  });
});

describe("parseAutonomyLine against a duplicated key", () => {
  it("refuses a line whose why is written twice, rather than keeping only the second", () => {
    const line =
      '{"actionId":"a-one","kind":"enqueue","subject":"https://github.com/acme/acme-admin/pull/16644",' +
      '"doneIso":"2026-09-12T02:06:09Z","bySession":"session-one","why":"CI failed; merge refused",' +
      '"why":"CI green; merged","witness":"enqueue -> queued"}';
    expect(unwrapErr(parseAutonomyLine({ line, lineNumber: 4 })).message).toBe(
      "line 4 of the autonomy ledger is neither a complete action nor a complete steer: the field `why` is " +
        "written twice, and only the second spelling would survive the decode",
    );
  });

  it("refuses a duplicate written in two spellings of the same key", () => {
    const line =
      '{"actionId":"a-one","kind":"enqueue","subject":"https://github.com/acme/acme-admin/pull/16644",' +
      '"doneIso":"2026-09-12T02:06:09Z","bySession":"session-one","why":"CI green","\\u0077hy":"it was red",' +
      '"witness":"enqueue -> queued"}';
    expect(unwrapErr(parseAutonomyLine({ line, lineNumber: 9 })).message).toContain("the field `why` is written twice");
  });

  it("accepts a row whose nested objects repeat a key across different parents", () => {
    const line = JSON.stringify({
      actionId: "a-one",
      bySession: "session-one",
      doneIso: "2026-09-12T02:06:09Z",
      kind: "enqueue",
      subject: "https://github.com/acme/acme-admin/pull/16644",
      why: "CI green",
      witness: "enqueue -> queued",
    });
    expect(unwrap(parseAutonomyLine({ line, lineNumber: 1 })).actionId).toBe("a-one");
  });
});

describe("parseAutonomyLine against instant spellings a clock parses but ISO-8601 does not", () => {
  /** One act's line, varying only the instant under test. */
  function lineWithInstant({ doneIso }: { doneIso: string }): string {
    return JSON.stringify({
      actionId: "a-one",
      bySession: "session-one",
      doneIso,
      kind: "enqueue",
      subject: "https://github.com/acme/acme-admin/pull/16644",
      why: "CI green",
      witness: "queued",
    });
  }

  it("refuses a dotted date, which a fraction scan would read as a fractional second", () => {
    expect(
      unwrapErr(parseAutonomyLine({ line: lineWithInstant({ doneIso: "2026.09.12 00:00:00 GMT" }), lineNumber: 1 }))
        .message,
    ).toContain("is not an ISO-8601 instant a clock can parse");
  });

  it("refuses a single-digit hour, which a fraction scan would not match at all", () => {
    expect(
      unwrapErr(
        parseAutonomyLine({ line: lineWithInstant({ doneIso: "2026-09-12 2:06:09.000001 GMT" }), lineNumber: 1 }),
      ).message,
    ).toContain("is not an ISO-8601 instant a clock can parse");
  });

  it("accepts an instant carrying a fraction far below the millisecond", () => {
    const parsed = unwrap(
      parseAutonomyLine({ line: lineWithInstant({ doneIso: "2026-09-12T02:06:09.0000000001Z" }), lineNumber: 1 }),
    ) as AutonomyActionRow;
    expect(parsed.doneIso).toBe("2026-09-12T02:06:09.0000000001Z");
  });

  it("accepts an instant written with a numeric zone offset", () => {
    const parsed = unwrap(
      parseAutonomyLine({ line: lineWithInstant({ doneIso: "2026-09-12T12:06:09+10:00" }), lineNumber: 1 }),
    ) as AutonomyActionRow;
    expect(parsed.doneIso).toBe("2026-09-12T12:06:09+10:00");
  });
});
