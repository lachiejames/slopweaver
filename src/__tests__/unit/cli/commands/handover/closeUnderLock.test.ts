/**
 * `handover close`'s terminal write holds the row's closing lock and the uncarded-page gate, as finish and settle do.
 * A close appended outside the lock landed between `page publish`'s open-run read and its artifact write, and a close
 * with no gate ended a row whose page artifact never reached the owner's Queue.
 *
 * Real filesystem fixtures — a temp home and runs dir — and the real journal.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  artifactUnderClosingLock,
  closeUnderClosingLock,
} from "../../../../../cli/commands/handover/closeUnderLock.js";
import { acquireClosingLock } from "../../../../../cli/commands/handover/closingLock.js";
import type { PageReachReaders } from "../../../../../cli/commands/handover/uncardedPageGate.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import { applyRowEvent } from "../../../../../handover/rowEvent.js";
import { appendRunEvent, readRunJournal } from "../../../../../handover/runStore.js";
import { ok, unwrap } from "../../../../../lib/result.js";

const ROW = "acme-plan-usage-to-17-nov";

const doc = {
  artifact: undefined,
  kind: "ask",
  lean: undefined,
  options: [],
  problem: undefined,
  ruling: undefined,
  rulingAnchor: undefined,
  slug: ROW,
  summary: "Work out the plan-usage strategy",
} as unknown as HandoverDoc;

const EMPTY: PageReachReaders = { handSteps: () => ok([]), ruledIdentities: () => ok(new Set()) };

describe("closeUnderClosingLock", () => {
  let home = "";
  let runsDir = "";
  const saved = process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-close-"));
    runsDir = join(home, "runs");
    delete process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    if (saved === undefined) {
      delete process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];
    } else {
      process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"] = saved;
    }
  });

  const close = (): { readonly path: string } | number =>
    closeUnderClosingLock({
      doc,
      home,
      nowIso: "2026-11-04T01:00:00.000Z",
      readers: EMPTY,
      runsDir,
      summary: "shipped",
    });

  const kinds = (): string[] => unwrap(readRunJournal({ runsDir, slug: ROW })).events.map((event) => event.kind);

  it("refuses while a page publish, settle or finish holds the row's closing lock, and closes once it is let go", () => {
    const held = unwrap(acquireClosingLock({ home, nowIso: "2026-11-04T00:30:00.000Z", slug: ROW }));
    expect(close()).toBe(EXIT_ERROR);
    expect(kinds()).toStrictEqual([]);
    held.release();
    expect(close()).toStrictEqual({ path: join(runsDir, `${ROW}.jsonl`) });
    expect(kinds()).toStrictEqual(["closed"]);
  });

  it("refuses a row whose page artifact never reached the owner's Queue, writing nothing", () => {
    applyRowEvent({
      event: { atIso: "2026-11-04T00:00:00.000Z", kind: "artifact", url: "page:acme-plan-page-17-nov" },
      runsDir,
      slug: ROW,
    });
    expect(close()).toBe(EXIT_ERROR);
    expect(kinds()).toStrictEqual(["artifact"]);
  });

  it("holds a row its precondition refuses under the lock, writing nothing, and closes one it admits", () => {
    const seen: string[] = [];
    const held = closeUnderClosingLock({
      doc,
      home,
      nowIso: "2026-11-04T01:00:00.000Z",
      precondition: ({ doc: read, runsDir: at }) => {
        seen.push(`${read.slug} ${at}`);
        return "its run is active, and that run ends it";
      },
      readers: EMPTY,
      runsDir,
      summary: "shipped",
    });
    expect(held).toBe(EXIT_ERROR);
    expect(seen).toStrictEqual([`${ROW} ${runsDir}`]);
    expect(existsSync(join(runsDir, `${ROW}.jsonl`))).toBe(false);
    const admitted = closeUnderClosingLock({
      doc,
      home,
      nowIso: "2026-11-04T01:00:00.000Z",
      precondition: () => undefined,
      readers: EMPTY,
      runsDir,
      summary: "shipped",
    });
    expect(admitted).toStrictEqual({ path: join(runsDir, `${ROW}.jsonl`) });
    expect(kinds()).toStrictEqual(["closed"]);
  });

  it("gates a page named by the close's own --artifact, writing nothing, and records a non-page one before closing", () => {
    // `close --artifact page:p` recorded the page after its gated close, so the gate never saw it.
    const withPage = closeUnderClosingLock({
      artifact: "page:acme-plan-page-17-nov",
      doc,
      home,
      nowIso: "2026-11-04T01:00:00.000Z",
      readers: EMPTY,
      runsDir,
      summary: "shipped",
    });
    expect(withPage).toBe(EXIT_ERROR);
    expect(existsSync(join(runsDir, `${ROW}.jsonl`))).toBe(false);
    const withPull = closeUnderClosingLock({
      artifact: "https://github.com/acme/repo/pull/1",
      doc,
      home,
      nowIso: "2026-11-04T01:00:00.000Z",
      readers: EMPTY,
      runsDir,
      summary: "shipped",
    });
    expect(withPull).toStrictEqual({ path: join(runsDir, `${ROW}.jsonl`) });
    expect(kinds()).toStrictEqual(["artifact", "closed"]);
  });
});

describe("artifactUnderClosingLock", () => {
  let home = "";
  let runsDir = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-artifact-"));
    runsDir = join(home, "runs");
    delete process.env["SLOPWEAVER_ALLOW_UNCARDED_PAGE"];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const point = ({ url }: { url: string }): { readonly path: string } | number =>
    artifactUnderClosingLock({ doc, home, nowIso: "2026-11-04T02:00:00.000Z", readers: EMPTY, runsDir, url });

  it("refuses an uncarded page pointer on a row already closed, and records it on an open one", () => {
    const started = { atIso: "2026-11-04T00:00:00.000Z", branch: "work", docHash: "h", kind: "started" } as const;
    unwrap(appendRunEvent({ event: started, runsDir, slug: ROW }));
    expect(point({ url: "page:acme-plan-page-17-nov" })).toStrictEqual({ path: join(runsDir, `${ROW}.jsonl`) });
    unwrap(
      appendRunEvent({
        event: { atIso: "2026-11-04T01:00:00.000Z", kind: "finished", residue: [] },
        runsDir,
        slug: ROW,
      }),
    );
    expect(point({ url: "page:another-page" })).toBe(EXIT_ERROR);
    const kinds = unwrap(readRunJournal({ runsDir, slug: ROW })).events.map((event) => event.kind);
    expect(kinds).toStrictEqual(["started", "artifact", "finished"]);
  });
});
