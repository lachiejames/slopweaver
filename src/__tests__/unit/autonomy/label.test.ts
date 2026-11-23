import { describe, expect, it } from "vitest";

import { autonomyKindLabel, autonomySessionLabel, autonomySubjectLabel } from "../../../autonomy/label.js";
import { AUTONOMY_SESSION_LABEL_MAX_CHARS, AUTONOMY_SUBJECT_LABEL_MAX_CHARS } from "../../../briefing/caps.js";

describe("a subject's derived label", () => {
  it("names a GitHub pull request by its repository and number, never bare", () => {
    expect(autonomySubjectLabel({ subject: "https://github.com/acme/acme-admin/pull/16644" })).toBe(
      "acme/acme-admin#16644",
    );
  });

  it("names a GitHub issue the same way", () => {
    expect(autonomySubjectLabel({ subject: "https://github.com/acme/acme-admin/issues/42" })).toBe(
      "acme/acme-admin#42",
    );
  });

  it("names a Slack permalink by its channel and message, query string and all", () => {
    expect(
      autonomySubjectLabel({
        subject: "https://acme.slack.com/archives/C0SYN000006/p1789179474210969?thread_ts=1788956581.789719",
      }),
    ).toBe("slack C0SYN000006 p1789179474210969");
  });

  it("falls back to the host and path for a URL it does not recognise", () => {
    expect(autonomySubjectLabel({ subject: "https://linear.app/acme/issue/KK-2386" })).toBe(
      "linear.app/acme/issue/KK-2386",
    );
  });

  it("returns an unparseable subject unchanged rather than throwing", () => {
    expect(autonomySubjectLabel({ subject: "not a url" })).toBe("not a url");
  });

  it("uses a board row slug as its own label", () => {
    expect(autonomySubjectLabel({ subject: "acquireoperationlock-s-stale-lock-takeover-is-not-mutually" })).toBe(
      "acquireoperationlock-s-stale-lock-takeover-is-not-mutually",
    );
  });

  it("falls back to a truthful kind rather than truncating an over-long board slug", () => {
    expect(autonomySubjectLabel({ subject: "a".repeat(AUTONOMY_SUBJECT_LABEL_MAX_CHARS + 1) })).toBe("board row");
  });

  it("uses the file's own name for a state reference", () => {
    expect(autonomySubjectLabel({ subject: "state:supervisor-scratch/handoff-9251/close251-list.txt" })).toBe(
      "close251-list.txt",
    );
  });

  it("falls back to a truthful kind rather than truncating an over-long state file name", () => {
    const name = `${"a".repeat(AUTONOMY_SUBJECT_LABEL_MAX_CHARS)}.txt`;

    expect(autonomySubjectLabel({ subject: `state:scratch/${name}` })).toBe("local record");
  });

  it("falls back for a long URL rather than blowing the cap and refusing the whole page", () => {
    const long = `https://example.com/${"a".repeat(109)}`;

    expect(long.length).toBe(129);
    expect(autonomySubjectLabel({ subject: long })).toBe("a link");
  });

  it("keeps every label inside the page's own bound, whichever form the subject takes", () => {
    const labels = [
      autonomySubjectLabel({ subject: `https://example.com/${"a".repeat(109)}` }),
      autonomySubjectLabel({ subject: "a".repeat(AUTONOMY_SUBJECT_LABEL_MAX_CHARS + 1) }),
      autonomySubjectLabel({ subject: `state:scratch/${"a".repeat(AUTONOMY_SUBJECT_LABEL_MAX_CHARS)}.txt` }),
    ];

    expect(labels.every((label) => label.length <= AUTONOMY_SUBJECT_LABEL_MAX_CHARS)).toBe(true);
  });

  it("never returns a label carrying an ellipsis, which the page budget refuses", () => {
    const labels = [
      autonomySubjectLabel({ subject: "a".repeat(AUTONOMY_SUBJECT_LABEL_MAX_CHARS + 1) }),
      autonomySubjectLabel({ subject: `state:scratch/${"a".repeat(AUTONOMY_SUBJECT_LABEL_MAX_CHARS)}.txt` }),
    ];

    expect(labels.some((label) => label.includes("…") || label.includes("..."))).toBe(false);
  });
});

describe("a kind's derived label", () => {
  it("opens a hyphenated kind out into words", () => {
    expect(autonomyKindLabel({ kind: "press-merge-when-ready" })).toBe("press merge when ready");
  });

  it("keeps a refused act saying it was refused", () => {
    expect(autonomyKindLabel({ kind: "press-merge-when-ready-refused" })).toBe("press merge when ready refused");
  });

  it("opens a dotted kind out too, so an unknown vocabulary still reads", () => {
    expect(autonomyKindLabel({ kind: "slack.post.as-me.one-card" })).toBe("slack post as me one card");
  });
});

describe("a session's derived label", () => {
  it("shortens a full session string to the workspace the owner would go and look at", () => {
    expect(
      autonomySessionLabel({
        bySession: "workspace:123 act-on-open-acme-admin-prs-under-graduated-autonomy (fd64a339-a7e5)",
      }),
    ).toBe("workspace:123");
  });

  it("leaves a name with no workspace prefix exactly as it is, never truncated", () => {
    expect(autonomySessionLabel({ bySession: "policy-dm-renders-with-no-show-more" })).toBe(
      "policy-dm-renders-with-no-show-more",
    );
  });
});

describe("autonomySessionLabel against the page's own cap", () => {
  it("falls back to a truthful word when a prefixless name is one character over the cap", () => {
    expect(autonomySessionLabel({ bySession: "s".repeat(AUTONOMY_SESSION_LABEL_MAX_CHARS + 1) })).toBe("a session");
  });

  it("keeps a prefixless name that is exactly the cap", () => {
    const name = "s".repeat(AUTONOMY_SESSION_LABEL_MAX_CHARS);
    expect(autonomySessionLabel({ bySession: name })).toBe(name);
  });

  it("falls back for a name that honestly ends in an ellipsis, which the form refuses", () => {
    expect(autonomySessionLabel({ bySession: "the-session-that-named-itself..." })).toBe("a session");
  });

  it("still shortens to the workspace prefix when a long name has one", () => {
    expect(autonomySessionLabel({ bySession: `workspace:9 ${"s".repeat(400)}` })).toBe("workspace:9");
  });
});
