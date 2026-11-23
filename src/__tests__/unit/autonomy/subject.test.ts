import { describe, expect, it } from "vitest";

import { classifyAutonomySubject, STATE_SUBJECT_PREFIX } from "../../../autonomy/subject.js";
import { AUTONOMY_RUN_MAX, AUTONOMY_SUBJECT_MAX } from "../../../autonomy/types.js";

describe("classifyAutonomySubject", () => {
  it("classifies a GitHub pull-request URL as a url", () => {
    const classified = classifyAutonomySubject({ subject: "https://github.com/acme/acme-admin/pull/16644" })!;

    expect(classified.kind).toBe("url");
    expect(classified.value).toBe("https://github.com/acme/acme-admin/pull/16644");
  });

  it("classifies a Slack permalink as a url", () => {
    const classified = classifyAutonomySubject({
      subject: "https://acme.slack.com/archives/C0SYN000006/p1789179474210969",
    })!;

    expect(classified.kind).toBe("url");
  });

  it("accepts plain http as well as https", () => {
    expect(classifyAutonomySubject({ subject: "http://example.internal/thing" })!.kind).toBe("url");
  });

  it("classifies a handover board row slug as a board subject", () => {
    const classified = classifyAutonomySubject({
      subject: "acquireoperationlock-s-stale-lock-takeover-is-not-mutually",
    })!;

    expect(classified.kind).toBe("board");
    expect(classified.value).toBe("acquireoperationlock-s-stale-lock-takeover-is-not-mutually");
  });

  it("classifies the longest real board slug in the live register", () => {
    const slug =
      "a-supervisor-chair-goes-stale-inside-a-two-hour-rotation-so-a-handover-carries-its-unanswered-inbound";

    expect(classifyAutonomySubject({ subject: slug })!.kind).toBe("board");
  });

  it("classifies a board slug carrying capitals, because the board writes slugs as their row names them", () => {
    const slug = "a-killed-doneWhen-probe-reports-an-exit-code-instead-of-timed-out";

    expect(classifyAutonomySubject({ subject: slug })).toEqual({ kind: "board", value: slug });
  });

  it("classifies a dotted slug, which the fleet's own vocabulary uses", () => {
    expect(classifyAutonomySubject({ subject: "slack.post.as-me.one-card" })!.kind).toBe("board");
  });

  it("classifies a state reference and exposes its relative path", () => {
    const classified = classifyAutonomySubject({
      subject: `${STATE_SUBJECT_PREFIX}supervisor-scratch/handoff-9251/close251-list.txt`,
    })!;

    expect(classified).toEqual({
      kind: "state",
      relativePath: "supervisor-scratch/handoff-9251/close251-list.txt",
      value: "state:supervisor-scratch/handoff-9251/close251-list.txt",
    });
  });

  it("classifies a single-segment state reference", () => {
    expect(classifyAutonomySubject({ subject: "state:notes.md" })!.kind).toBe("state");
  });

  it("refuses free prose, which is a description rather than an id", () => {
    expect(
      classifyAutonomySubject({ subject: "23 workspaces parked 10h on landed pages or released runs" }),
    ).toBeUndefined();
  });

  it("refuses a bare reference, which resolves against no repository", () => {
    expect(classifyAutonomySubject({ subject: "#16644" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "acme-admin#16644" })).toBeUndefined();
  });

  it("refuses a scheme that opens nothing the owner can check the act against", () => {
    expect(classifyAutonomySubject({ subject: "mailto:someone@example.com" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "file:///etc/passwd" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "javascript:alert(1)" })).toBeUndefined();
  });

  it("refuses several URLs crammed into one subject, which `new URL` would percent-encode into one", () => {
    const four =
      "https://github.com/acme/acme-admin/pull/16365 https://github.com/acme/acme-admin/pull/16366 " +
      "https://github.com/acme/acme-admin/pull/16369 https://github.com/acme/acme-admin/pull/16371";

    expect(classifyAutonomySubject({ subject: four })).toBeUndefined();
  });

  it("refuses any whitespace inside a URL subject", () => {
    expect(classifyAutonomySubject({ subject: "https://example.com/a b" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "https://example.com/a\tb" })).toBeUndefined();
  });

  it("refuses a single-slash scheme, which a browser resolves against the briefing's own host", () => {
    expect(classifyAutonomySubject({ subject: "https:/github.com/acme/acme-admin/pull/16644" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "http:/example.com/x" })).toBeUndefined();
  });

  it("refuses an uppercase scheme, because the stored string is what reaches the href", () => {
    expect(classifyAutonomySubject({ subject: "HTTPS://github.com/acme/acme-admin/pull/16644" })).toBeUndefined();
  });

  it("refuses a relative web path", () => {
    expect(classifyAutonomySubject({ subject: "/acme/acme-admin/pull/16644" })).toBeUndefined();
  });

  it("refuses traversal in a state reference", () => {
    expect(classifyAutonomySubject({ subject: "state:../../etc/passwd" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "state:ledgers/../../secrets" })).toBeUndefined();
  });

  it("refuses a state reference with an empty segment or a trailing slash", () => {
    expect(classifyAutonomySubject({ subject: "state:ledgers//autonomy.jsonl" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "state:ledgers/" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "state:" })).toBeUndefined();
  });

  it("refuses an absolute path or a backslash in a state reference", () => {
    expect(classifyAutonomySubject({ subject: "state:/etc/passwd" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "state:ledgers\\autonomy.jsonl" })).toBeUndefined();
  });

  it("refuses a segment that opens with a dot, so a dotfile cannot smuggle traversal past the shape", () => {
    expect(classifyAutonomySubject({ subject: "state:.ssh/id_rsa" })).toBeUndefined();
  });

  it("refuses a segment ENDING in a dot, whose label would read as a truncation the page refuses", () => {
    expect(classifyAutonomySubject({ subject: "state:notes..." })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "state:notes." })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "state:scratch/notes../file.txt" })).toBeUndefined();
  });

  it("refuses the empty subject", () => {
    expect(classifyAutonomySubject({ subject: "" })).toBeUndefined();
  });

  it("accepts a slug at the board bound and refuses one past it", () => {
    const atBound = "a".repeat(AUTONOMY_RUN_MAX);
    const pastBound = "a".repeat(AUTONOMY_RUN_MAX + 1);

    expect(classifyAutonomySubject({ subject: atBound })!.kind).toBe("board");
    expect(classifyAutonomySubject({ subject: pastBound })).toBeUndefined();
  });

  it("refuses any subject past the overall length bound", () => {
    const url = `https://example.com/${"a".repeat(AUTONOMY_SUBJECT_MAX)}`;

    expect(classifyAutonomySubject({ subject: url })).toBeUndefined();
  });

  it("still refuses a slug with a doubled or leading separator, whatever its case", () => {
    expect(classifyAutonomySubject({ subject: "Acquire--Lock" })).toBeUndefined();
    expect(classifyAutonomySubject({ subject: "-Acquire-Lock" })).toBeUndefined();
  });
});
