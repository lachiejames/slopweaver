/**
 * The home journal's read: absent when nothing is there, its nonblank lines and the witness of their raw bytes when
 * something is, and a refusal — never a followed link — for a journal or a `judgement/` that is a symlink.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readStandingAskJournal, standingAskImportSource } from "../../../profile/standingAskImport.js";
import { standingAskLine } from "../../../profile/standingAsks.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway `judgement/` directory, removed after the test.
 *
 * @returns the directory and the journal path inside it
 */
function freshJudgement(): { readonly root: string; readonly dir: string; readonly path: string } {
  const root = mkdtempSync(join(tmpdir(), "standing-ask-import-"));
  dirs.push(root);
  const dir = join(root, "judgement");
  mkdirSync(dir);
  return { dir, path: join(dir, "standing-asks.jsonl"), root };
}

const LINE = standingAskLine({
  event: {
    covers: ["findings"],
    id: "a",
    kind: "recorded",
    quote: {
      anchor: "talk:a0000017-0000-4000-8000-000000000019",
      atIso: "2026-10-04T00:55:00.000Z",
      cut: "none",
      where: "console-voice",
      words: "chuck anything worth a look on the board",
    },
    recordedAtIso: "2026-10-05T00:00:00.000Z",
  },
});

describe("readStandingAskJournal", () => {
  it("answers absent when no journal was ever written", () => {
    const { path } = freshJudgement();
    expect(unwrap(readStandingAskJournal({ path }))).toEqual({ state: "absent" });
  });

  it("reads the nonblank lines by physical number, witnessing the raw bytes", () => {
    const { path } = freshJudgement();
    const bytes = `\n${LINE}\n\n`;
    writeFileSync(path, bytes);
    expect(unwrap(readStandingAskJournal({ path }))).toEqual({
      lines: [{ line: LINE, number: 2 }],
      state: "present",
      witness: {
        bytes: Buffer.byteLength(bytes),
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      },
    });
  });

  it("refuses a journal that is a symlink, and one under a judgement directory that is", () => {
    const { root, dir, path } = freshJudgement();
    const target = join(root, "elsewhere.jsonl");
    writeFileSync(target, `${LINE}\n`);
    symlinkSync(target, path);
    expect(unwrapErr(readStandingAskJournal({ path })).code).toBe("STANDING_ASK_HOME_FILE_UNREADABLE");
    const linked = join(root, "linked");
    symlinkSync(dir, linked);
    expect(unwrapErr(readStandingAskJournal({ path: join(linked, "standing-asks.jsonl") })).message).toContain(
      `${linked} is a symlink, which no write here makes`,
    );
  });

  it("refuses a journal path that is a directory rather than a regular file", () => {
    const { path } = freshJudgement();
    mkdirSync(path);
    expect(unwrapErr(readStandingAskJournal({ path })).message).toContain(
      `${path} is not a regular file, so it is not read`,
    );
  });
});

describe("standingAskImportSource", () => {
  it("imports nothing from an absent journal, and every event with the witness from a present one", () => {
    const { path } = freshJudgement();
    expect(unwrap(standingAskImportSource({ file: { state: "absent" } }))).toEqual({ state: "absent" });
    writeFileSync(path, `${LINE}\n`);
    const file = unwrap(readStandingAskJournal({ path }));
    const source = unwrap(standingAskImportSource({ file }));
    expect(source).toEqual({
      records: [
        {
          ask: {
            covers: ["findings"],
            id: "a",
            quote: {
              anchor: "talk:a0000017-0000-4000-8000-000000000019",
              atIso: "2026-10-04T00:55:00.000Z",
              cut: "none",
              where: "console-voice",
              words: "chuck anything worth a look on the board",
            },
            recordedAtIso: "2026-10-05T00:00:00.000Z",
          },
          exactLine: LINE,
          finalState: "active",
          journalSeq: 1,
          kind: "recorded",
        },
      ],
      state: "present",
      witness: {
        bytes: Buffer.byteLength(`${LINE}\n`),
        sha256: `sha256:${createHash("sha256").update(`${LINE}\n`).digest("hex")}`,
      },
    });
  });

  it("refuses a line holding a byte that is not UTF-8 rather than importing its repaired words", () => {
    const { path } = freshJudgement();
    const [head, tail] = LINE.split("chuck");
    writeFileSync(path, Buffer.concat([Buffer.from(`${head!}ch`), Buffer.from([0x96]), Buffer.from(`ck${tail!}\n`)]));
    const file = unwrap(readStandingAskJournal({ path }));
    expect(unwrapErr(standingAskImportSource({ file })).message).toContain("standing-ask journal line 1 does not read");
  });
});
