/**
 * `readSlackDraftLinesOrError`: an absent register is no lines, a register that exists and will not read is an error
 * — never no lines, which `talk slack-send-outcome` would take for "nothing was held".
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readSlackDraftLinesOrError, slackDraftLogPath } from "../../../admit/slackDraftStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const homes: string[] = [];

/** A fresh state home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "draft-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readSlackDraftLinesOrError", () => {
  it("reads an absent register as no lines, and a written one line by line", () => {
    const empty = freshHome();
    const written = freshHome();
    const path = slackDraftLogPath({ home: written });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"a":1}\n{"b":2}\n');
    expect([
      unwrap(readSlackDraftLinesOrError({ home: empty })),
      unwrap(readSlackDraftLinesOrError({ home: written })),
    ]).toEqual([[], ['{"a":1}', '{"b":2}', ""]]);
  });

  it("delivers a line holding a byte that is not UTF-8 as one lone U+FFFD, never its repaired text", () => {
    const home = freshHome();
    const path = slackDraftLogPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat([Buffer.from('{"a":1}\n{"b":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
    expect(unwrap(readSlackDraftLinesOrError({ home }))).toEqual(['{"a":1}', "�", ""]);
  });

  it("is an error, never no lines, when the register exists and will not read", () => {
    const home = freshHome();
    const path = slackDraftLogPath({ home });
    mkdirSync(path, { recursive: true });
    const error = unwrapErr(readSlackDraftLinesOrError({ home }));
    expect([error.code, error.message.startsWith(`the as-me draft register at ${path} could not be read: `)]).toEqual([
      "DRAFT_REGISTER_UNREADABLE",
      true,
    ]);
  });

  it("is an error, never no lines, when the register sits behind a directory it cannot search", () => {
    const home = freshHome();
    const path = slackDraftLogPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"a":1}\n');
    chmodSync(dirname(path), 0o000);
    try {
      expect(unwrapErr(readSlackDraftLinesOrError({ home })).code).toBe("DRAFT_REGISTER_UNREADABLE");
    } finally {
      chmodSync(dirname(path), 0o700);
    }
  });
});
