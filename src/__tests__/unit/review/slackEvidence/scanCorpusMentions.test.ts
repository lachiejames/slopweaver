import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../../corpus/types.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { reviewErrorLines } from "../../../../review/errors.js";
import { scanCorpusMentions } from "../../../../review/slackEvidenceScan.js";
import type { SlackMention } from "../../../../review/slackEvidenceTypes.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { IDENTITY, slackRecord } from "./harness.js";

describe("scanCorpusMentions — a bronze that cannot be listed", () => {
  it("answers a typed unlistable failure naming the directory, never an empty success", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-unlistable-"));
    try {
      const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
      const error = unwrapErr(
        scanCorpusMentions({ home, identity: IDENTITY, refs: [{ number: 1, owner: "o", repo: "r" }] }),
      );
      expect(error.code).toBe("SLACK_BRONZE_UNLISTABLE");
      expect(reviewErrorLines({ error })).toEqual([
        `the Slack bronze at ${dir} could not be listed: ENOENT: no such file or directory, scandir '${dir}'`,
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("scanCorpusMentions — the threads a wanted link sits in", () => {
  it("reads every linkless reply in the thread, and attaches the root's pull request to each", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-threads-"));
    try {
      const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
      mkdirSync(dir, { recursive: true });
      const root = {
        ...slackRecord({ sourceId: "C1:1.0", text: "<https://github.com/o/r/pull/1> is ready" }),
        author: "U1",
      };
      const ask = {
        ...slackRecord({ kind: "comment", sourceId: "C1:1.0:reply:2.0", text: "<@U9> please review this" }),
        author: "U1",
      };
      const answer = {
        ...slackRecord({ kind: "comment", sourceId: "C1:1.0:reply:3.0", text: "I need you to fix the schema first" }),
        author: "U9",
      };
      const unrelated = { ...slackRecord({ sourceId: "C1:8.0", text: "<@U9> please review this" }), author: "U1" };
      writeFileSync(
        join(dir, "a.jsonl"),
        [root, ask, answer, unrelated].map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
      const scanned = unwrap(
        scanCorpusMentions({ home, identity: IDENTITY, refs: [{ number: 1, owner: "o", repo: "r" }] }),
      );
      expect(scanned.map((m) => [m.messageKey, m.association, m.threadKey, m.threadPrKeys])).toEqual([
        ["C1:1.0", "linked", "C1:1.0", []],
        ["C1:2.0", "thread", "C1:1.0", ["o/r#1"]],
        ["C1:3.0", "thread", "C1:1.0", ["o/r#1"]],
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("scanCorpusMentions — a quote or forward decides what a thread message is about", () => {
  /** A record whose raw payload carries a Slack message unfurl linking another pull request. */
  const quoting = ({ sourceId, text, author }: { sourceId: string; text: string; author: string }): CorpusRecord => {
    const permalink = "https://x.slack.com/archives/C2/p9";
    const base = slackRecord({ kind: sourceId.includes(":reply:") ? "comment" : "message", sourceId, text });
    return {
      ...base,
      author,
      raw: {
        attachments: [{ from_url: permalink, is_msg_unfurl: true, text: "approved <https://github.com/o/r/pull/2>" }],
        text: `${text} <${permalink}>`,
      },
    };
  };

  const scan = ({ records }: { records: readonly CorpusRecord[] }): readonly SlackMention[] => {
    const home = mkdtempSync(join(tmpdir(), "sw-thread-quotes-"));
    try {
      const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "a.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return unwrap(
        scanCorpusMentions({
          home,
          identity: IDENTITY,
          refs: [
            { number: 1, owner: "o", repo: "r" },
            { number: 2, owner: "o", repo: "r" },
          ],
        }),
      );
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  };

  it("never inherits the root's pull request onto a reply that forwards another one", () => {
    const root = {
      ...slackRecord({ sourceId: "C1:1.0", text: "<https://github.com/o/r/pull/1> is ready" }),
      author: "U1",
    };
    const reply = quoting({ author: "U1", sourceId: "C1:1.0:reply:2.0", text: "<@U9> please review this" });
    const found = scan({ records: [root, reply] });
    expect(found.filter((m) => m.messageKey === "C1:2.0").map((m) => [m.prKey, m.association])).toEqual([
      ["o/r#2", "linked"],
    ]);
  });

  it("reads a root that quotes a second pull request as naming both, so a reply under it cannot pick one", () => {
    const root = quoting({ author: "U1", sourceId: "C1:1.0", text: "<https://github.com/o/r/pull/1> fixes" });
    const reply = {
      ...slackRecord({ kind: "comment", sourceId: "C1:1.0:reply:2.0", text: "<@U9> please review this" }),
      author: "U1",
    };
    const inherited = scan({ records: [root, reply] }).filter((m) => m.messageKey === "C1:2.0");
    expect(
      inherited
        .map((m) => [m.prKey, m.threadPrKeys.toSorted((x, y) => x.localeCompare(y))])
        .toSorted((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ["o/r#1", ["o/r#1", "o/r#2"]],
      ["o/r#2", ["o/r#1", "o/r#2"]],
    ]);
  });
});

describe("scanCorpusMentions — a reply whose only link is a forward it does not write", () => {
  it("carries no thread pull requests, so the classifier cannot route it to the root's", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-thread-forward-"));
    try {
      const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
      mkdirSync(dir, { recursive: true });
      const root = {
        ...slackRecord({ sourceId: "C1:1.0", text: "<https://github.com/o/r/pull/1> is ready" }),
        author: "U1",
      };
      const reply: CorpusRecord = {
        ...slackRecord({ kind: "comment", sourceId: "C1:1.0:reply:2.0", text: "<@U9> please review this" }),
        author: "U1",
        raw: {
          attachments: [
            {
              from_url: "https://x.slack.com/archives/C2/p9",
              is_msg_unfurl: true,
              text: "<https://github.com/o/r/pull/1> and <https://github.com/o/r/pull/3>",
            },
          ],
          text: "<@U9> please review this",
        },
      };
      writeFileSync(join(dir, "a.jsonl"), [root, reply].map((r) => JSON.stringify(r)).join("\n") + "\n");
      const found = unwrap(
        scanCorpusMentions({ home, identity: IDENTITY, refs: [{ number: 1, owner: "o", repo: "r" }] }),
      );
      expect(found.map((m) => [m.messageKey, m.association, m.threadPrKeys])).toEqual([
        ["C1:1.0", "linked", []],
        ["C1:2.0", "linked", []],
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("scanCorpusMentions — a thread somebody else started", () => {
  it("lends its pull request to none of the owner's replies, so the owner's comment on their pull request is not an ask", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-their-thread-"));
    try {
      const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
      mkdirSync(dir, { recursive: true });
      const theirRoot = {
        ...slackRecord({ sourceId: "C1:1.0", text: "raised <https://github.com/o/r/pull/1>, would love eyes" }),
        author: "U7",
      };
      const ownerReply = {
        ...slackRecord({
          kind: "comment",
          sourceId: "C1:1.0:reply:2.0",
          text: "<@U7> pls confirm, then I'm happy to approve",
        }),
        author: "U1",
      };
      writeFileSync(join(dir, "a.jsonl"), [theirRoot, ownerReply].map((r) => JSON.stringify(r)).join("\n") + "\n");
      const found = unwrap(
        scanCorpusMentions({ home, identity: IDENTITY, refs: [{ number: 1, owner: "o", repo: "r" }] }),
      );
      expect(found.map((m) => [m.messageKey, m.association, m.threadPrKeys])).toEqual([
        ["C1:1.0", "linked", []],
        ["C1:2.0", "thread", []],
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
