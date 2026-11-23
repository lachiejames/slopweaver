/*
 * Every verb that rewrites a board row takes the one per-board row lock, so two writers on one row cannot both
 * report success while one edit is lost. The interleaving is deterministic: the test is an in-flight quote-steer
 * write (lock held, row read, its edit computed over that read), and the writer under test is handed a `wait` that
 * finishes that write — the moment a real second process would have let it go.
 */
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { type AskFrontMatterEdit, writeAskFrontMatter } from "../../../cli/commands/handover/askFrontMatterWrite.js";
import { boardRowLockSite, withBoardRowLock } from "../../../cli/commands/handover/boardRowLock.js";
import { pauseFields } from "../../../cli/commands/handover/pausePlan.js";
import { pauseRefusal, writePauseEdit } from "../../../cli/commands/handover/pauseRun.js";
import { textWithSteer } from "../../../cli/commands/handover/quoteSteer.js";
import { writePriority } from "../../../cli/commands/handover/setPriorityRun.js";
import { settleCardThenRow } from "../../../cli/commands/handover/settleRowWrite.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { HisWords } from "../../../handover/hisWords.js";
import { PauseEditErrors } from "../../../handover/pauseEditErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";

const OWN = "talk:a0000015-0000-4000-8000-000000000016";
const NOW_ISO = "2026-10-18T09:00:00.000Z";

const STEER: HisWords = {
  anchor: "talk-call:a0000051-0000-4000-8000-000000000054#turn_7",
  atIso: "2026-10-18T08:57:21.724Z",
  cut: "end",
  where: "call",
  words: "fix it however seems right",
};

let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { force: true, recursive: true });
    dir = undefined;
  }
});

/** A fresh board holding one ready row, an ask row when `kind` says so, and that row's path. */
function boardWithRow({ kind = "" }: { kind?: string } = {}): string {
  dir = mkdtempSync(join(tmpdir(), "row-lock-"));
  const path = join(dir, "the-ask.md");
  writeFileSync(path, `---\nslug: the-ask\n${kind}status: ready\nanchor: ${OWN}\n---\n\n# the ask\n`);
  return path;
}

/** `text` as a pattern matching exactly itself. */
function escapeRegExp({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** The row as it reads on disk now. */
function rowNow({ path }: { path: string }): HandoverDoc {
  return parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
}

/**
 * A quote-steer write caught between its read and its write, exactly as `quoteSteerRow.ts` makes one: the row's lock
 * held, the row read, the steer spliced into that read. `finish` writes it and lets the lock go, once however often
 * it is called, so a test calls it after the writer under test whether or not that writer already waited on it.
 */
function steerInFlight({ path }: { path: string }): { readonly finish: () => void } {
  const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
  const edited = unwrap(
    textWithSteer({ index: 1, path, record: { hisWords: STEER, kind: "held" }, text: readFileSync(path, "utf8") }),
  );
  let finished = false;
  return {
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      writeFileAtomic({ contents: edited, path });
      held.release();
    },
  };
}

/** An ask front-matter edit that sets the row's priority, standing in for `handover example` and `handover shot`. */
const PRIORITY_EDIT: AskFrontMatterEdit = {
  holds: (doc) => doc.priority === "p1",
  remove: [],
  set: [{ key: "priority", value: "p1" }],
};

describe("an ask's front-matter edit under the row lock", () => {
  it("keeps the owner's steer AND the edit that landed while the steer was being written", () => {
    const path = boardWithRow();
    const steer = steerInFlight({ path });
    const written = writeAskFrontMatter({
      edit: PRIORITY_EDIT,
      path,
      rowLock: { wait: () => steer.finish() },
      slug: "the-ask",
    });
    steer.finish();
    expect(written).toEqual({ kind: "written", path });
    expect(rowNow({ path }).priority).toBe("p1");
    expect(rowNow({ path }).hisWordsSteers).toEqual([{ group: { hisWords: STEER, kind: "held" }, index: 1 }]);
  });

  it("answers unchanged without the lock when the row already holds the edit, as on a hard-linked row it refuses", () => {
    const path = boardWithRow({ kind: "priority: p1\n" });
    linkSync(path, join(dirname(path), "alias.md"));
    const before = readFileSync(path, "utf8");
    expect(writeAskFrontMatter({ edit: PRIORITY_EDIT, path, slug: "the-ask" })).toEqual({ kind: "unchanged" });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses, writing nothing, when the file now holds another row", () => {
    const path = boardWithRow();
    const before = readFileSync(path, "utf8");
    expect(writeAskFrontMatter({ edit: PRIORITY_EDIT, path, slug: "another-ask" })).toEqual({
      kind: "refused",
      problem: `${path} now holds the row "the-ask" — nothing was written`,
    });
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("one lock for every board-row rewrite", () => {
  it("keeps the owner's steer AND a set-priority that landed while the steer was being written", () => {
    const path = boardWithRow();
    const steer = steerInFlight({ path });
    const written = writePriority({
      apply: true,
      doc: rowNow({ path }),
      request: { because: "the audit gate is Friday", kind: "set", priority: "p0" },
      rowLock: { wait: () => steer.finish() },
    });
    steer.finish();
    expect(written.kind).toBe("written");
    expect(rowNow({ path }).priority).toBe("p0");
    expect(rowNow({ path }).hisWordsSteers).toEqual([{ group: { hisWords: STEER, kind: "held" }, index: 1 }]);
  });

  it("keeps the owner's steer AND a pause that landed while the steer was being written", () => {
    const path = boardWithRow();
    const steer = steerInFlight({ path });
    const written = writePauseEdit({
      path,
      refusal: ({ current }) => pauseRefusal({ row: current }),
      remove: [],
      rowLock: { wait: () => steer.finish() },
      set: pauseFields({ since: NOW_ISO, who: "the reviewer", why: undefined }),
      slug: "the-ask",
    });
    steer.finish();
    expect(unwrap(written).status).toBe("ready");
    expect(rowNow({ path }).status).toBe("paused");
    expect(rowNow({ path }).pausedOn).toBe("the reviewer");
    expect(rowNow({ path }).hisWordsSteers).toEqual([{ group: { hisWords: STEER, kind: "held" }, index: 1 }]);
  });

  it("keeps the owner's steer AND a settle whose row write landed while the steer was being written", () => {
    const path = boardWithRow({ kind: "kind: ask\naskedIso: 2026-10-18T08:00:00Z\n" });
    const steer = steerInFlight({ path });
    const settled = settleCardThenRow({
      bySession: "the-settling-session",
      inputs: {
        card: { kind: "none" },
        home: dir!,
        precondition: undefined,
        reason: undefined,
        row: rowNow({ path }),
        settledIso: NOW_ISO,
        settlement: "answered",
        witness: "https://example.invalid/the-answer",
      },
      rowLock: { wait: () => steer.finish() },
      slug: "the-ask",
    });
    steer.finish();
    expect(settled).toBe(true);
    expect(rowNow({ path }).settlement).toBe("answered");
    expect(rowNow({ path }).hisWordsSteers).toEqual([{ group: { hisWords: STEER, kind: "held" }, index: 1 }]);
  });

  it("refuses a pause, writing nothing, when the row it reads under the lock was paused since the scan", () => {
    const path = boardWithRow();
    const scanned = rowNow({ path });
    writeFileSync(path, readFileSync(path, "utf8").replace("status: ready\n", "status: paused\npausedOn: ops\n"));
    const before = readFileSync(path, "utf8");
    const written = writePauseEdit({
      path,
      refusal: ({ current }) => pauseRefusal({ row: current }),
      remove: [],
      set: pauseFields({ since: NOW_ISO, who: "the reviewer", why: undefined }),
      slug: scanned.slug,
    });
    expect(unwrapErr(written)).toEqual(
      PauseEditErrors.refused({ why: "the-ask is already paused on ops — unpause it first if the subject changed" }),
    );
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("waits between tries with a backoff that doubles, then runs the write once the holder lets go", () => {
    const path = boardWithRow();
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    const waits: number[] = [];
    const ran = withBoardRowLock({
      path,
      wait: ({ ms }) => {
        waits.push(ms);
        if (waits.length === 3) {
          held.release();
        }
      },
      write: ({ target }) => readFileSync(target, "utf8").length,
    });
    expect(waits).toEqual([50, 100, 200]);
    expect(unwrap(ran)).toBe(readFileSync(path, "utf8").length);
  });

  it("refuses a set-priority, writing nothing, while another writer holds the row past every try", () => {
    const path = boardWithRow();
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    const before = readFileSync(path, "utf8");
    const written = writePriority({
      apply: true,
      doc: rowNow({ path }),
      request: { because: "the audit gate is Friday", kind: "set", priority: "p0" },
      rowLock: { attempts: 2, wait: () => undefined },
    });
    held.release();
    // Anchored on everything but the holder's age and the instant it was checked, which the lock primitive reads off
    // the real clock: the refusal names this row, this holder's pid and when it took the lock.
    const holderLine = new RegExp(
      `^another board-row write holds ${escapeRegExp({ text: path })}: held by pid ${String(process.pid)} since ` +
        `${escapeRegExp({ text: NOW_ISO })} \\(\\d+ms old, `,
      "u",
    );
    expect(written).toEqual({ kind: "refused", problems: [expect.stringMatching(holderLine)] });
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
