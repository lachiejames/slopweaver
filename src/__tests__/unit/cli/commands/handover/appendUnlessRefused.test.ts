/**
 * `appendUnlessRefused` holds the row's lock from the re-read through the append, so a settle — which writes
 * `settlement:` under that same lock — cannot land between `handover ask`'s last check and its journal write. The race is interleaved in one process: the test holds the lock as an in-flight settle would, and
 * from inside the writer's `wait` writes the settlement and releases it, the moment another process would have.
 */
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { appendUnlessRefused } from "../../../../../cli/commands/handover/appendUnlessRefused.js";
import { boardRowLockSite } from "../../../../../cli/commands/handover/boardRowLock.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { askOnSettledRowRefusal, SETTLED_ASK_CHECK } from "../../../../../handover/settledAsk.js";
import { unwrap } from "../../../../../lib/result.js";

const NOW_ISO = "2026-10-08T00:00:00.000Z";

let dir = "";

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** An unsettled ask row on disk, and the doc a verb resolved from it before the settle. */
function unsettledRow(): { path: string; doc: ReturnType<typeof parseHandoverDoc> } {
  dir = mkdtempSync(join(tmpdir(), "append-unless-"));
  const path = join(dir, "race-row.md");
  const text = ["---", "slug: race-row", "kind: ask", "summary: a row", "status: ready", "---", ""].join("\n");
  writeFileSync(path, text);
  return { doc: parseHandoverDoc({ path, text }), path };
}

/** Write the settlement into the row's front matter, as `handover settle` does under the lock. */
function settle({ path }: { path: string }): void {
  const text = readFileSync(path, "utf8").replace(
    "status: ready\n",
    "status: ready\nsettlement: answered\nsettlementWitness: w\nsettledIso: 2026-10-08T00:00:01.000Z\n",
  );
  writeFileSync(path, text);
}

describe("appendUnlessRefused", () => {
  it("refuses, appending nothing, when a settle holding the row's lock lands before the ask takes it", () => {
    const { doc, path } = unsettledRow();
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    let appended = 0;

    const written = appendUnlessRefused({
      append: () => {
        appended += 1;
        return "wrote";
      },
      doc,
      fresh: SETTLED_ASK_CHECK,
      rowLock: {
        wait: () => {
          settle({ path });
          held.release();
        },
      },
    });

    const settledDoc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
    expect(written).toEqual({ kind: "refused", lines: askOnSettledRowRefusal({ doc: settledDoc }) });
    expect(askOnSettledRowRefusal({ doc: settledDoc })![0]).toContain("race-row is an ask row already settled");
    expect(appended).toBe(0);
  });

  it("appends once when the lock is released with the row still unsettled — the witness for the case above", () => {
    const { doc, path } = unsettledRow();
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));
    let appended = 0;

    const written = appendUnlessRefused({
      append: () => {
        appended += 1;
        return "wrote";
      },
      doc,
      fresh: SETTLED_ASK_CHECK,
      rowLock: {
        wait: () => {
          // An unrelated edit by the writer holding the lock: the row stays unsettled.
          appendFileSync(path, "\nnote\n");
          held.release();
        },
      },
    });

    expect(written).toEqual({ appended: "wrote", kind: "appended" });
    expect(appended).toBe(1);
  });

  it("appends on a hard-linked unsettled row, since the row is only read and the journal is what is written", () => {
    const { doc, path } = unsettledRow();
    mkdirSync(join(dir, "elsewhere"));
    linkSync(path, join(dir, "elsewhere", "race-row.md"));
    let appended = 0;

    const written = appendUnlessRefused({
      append: () => {
        appended += 1;
        return "wrote";
      },
      doc,
      fresh: SETTLED_ASK_CHECK,
    });

    expect(written).toEqual({ appended: "wrote", kind: "appended" });
    expect(appended).toBe(1);
  });

  it("still refuses a hard-linked row settled on disk, so skipping the link check opens no way past the settlement", () => {
    const { doc, path } = unsettledRow();
    settle({ path });
    mkdirSync(join(dir, "elsewhere"));
    linkSync(path, join(dir, "elsewhere", "race-row.md"));

    const written = appendUnlessRefused({ append: () => "wrote", doc, fresh: SETTLED_ASK_CHECK });

    const settledDoc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
    expect(written).toEqual({ kind: "refused", lines: askOnSettledRowRefusal({ doc: settledDoc }) });
  });

  it("refuses a row the verb resolved as a doc that is a settled ask on disk at the append", () => {
    const { path } = unsettledRow();
    const asDoc = readFileSync(path, "utf8").replace("kind: ask", "kind: doc");
    const resolvedAsDoc = parseHandoverDoc({ path, text: asDoc });
    settle({ path });
    let appended = 0;

    const written = appendUnlessRefused({
      append: () => {
        appended += 1;
        return "wrote";
      },
      doc: resolvedAsDoc,
      fresh: SETTLED_ASK_CHECK,
    });

    const settledDoc = parseHandoverDoc({ path, text: readFileSync(path, "utf8") });
    expect(resolvedAsDoc.kind).toBe("doc");
    expect(written).toEqual({ kind: "refused", lines: askOnSettledRowRefusal({ doc: settledDoc }) });
    expect(appended).toBe(0);
  });

  it("appends on a row that is not an ask on disk while its lock is held, so such a row takes no lock", () => {
    const { path } = unsettledRow();
    const asDoc = readFileSync(path, "utf8").replace("kind: ask", "kind: doc");
    writeFileSync(path, asDoc);
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));

    const written = appendUnlessRefused({
      append: () => "wrote",
      doc: parseHandoverDoc({ path, text: asDoc }),
      fresh: SETTLED_ASK_CHECK,
      rowLock: { attempts: 1 },
    });
    held.release();

    expect(written).toEqual({ appended: "wrote", kind: "appended" });
  });

  it("refuses an ask row on disk while its lock stays held, the witness that the case above took no lock", () => {
    const { doc, path } = unsettledRow();
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));

    const written = appendUnlessRefused({
      append: () => "wrote",
      doc,
      fresh: SETTLED_ASK_CHECK,
      rowLock: { attempts: 1 },
    });
    held.release();

    expect(written.kind).toBe("refused");
    expect(JSON.stringify(written)).toContain("nothing was recorded");
  });

  it("appends without the lock when the verb names no fresh refusal", () => {
    const { doc, path } = unsettledRow();
    const held = unwrap(acquireOperationLock({ ...boardRowLockSite({ path }), nowIso: NOW_ISO }));

    const written = appendUnlessRefused({ append: () => "wrote", doc, fresh: undefined });
    held.release();

    expect(written).toEqual({ appended: "wrote", kind: "appended" });
  });
});
