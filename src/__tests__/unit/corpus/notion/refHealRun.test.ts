import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listBronzeFiles } from "../../../../corpus/bronzeStorage.js";
import { contentDigest } from "../../../../corpus/contentStore.js";
import { bronzeSourceDir } from "../../../../corpus/corpusPaths.js";
import { parseRow } from "../../../../corpus/corpusRowCore.js";
import { readJsonlLines } from "../../../../corpus/corpusStore.js";
import { writeCorpusRecords } from "../../../../corpus/corpusWriter.js";
import { latestRecords } from "../../../../corpus/latestRecords.js";
import { attachmentRoot, storeAttachment } from "../../../../corpus/notion/attachmentStore.js";
import { applyRefHeal, censusRefHeal } from "../../../../corpus/notion/refHealRun.js";
import { serialiseRecord } from "../../../../corpus/recordSerialisation.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";

/**
 * The first fixture bytes whose sha256 carries a run of nine or more digits — the shape the earlier digit
 * pass carved. Deterministic: the same index is found on every run.
 */
function carvableBytes(): Buffer {
  for (let index = 0; ; index += 1) {
    const bytes = Buffer.from(`attachment fixture ${String(index)}`);
    if (/[0-9]{9,}/.test(contentDigest({ bytes }))) {
      return bytes;
    }
  }
}

/** What the digit pass wrote in place of a digest, before `SHA256_SPAN` exempted it. */
function carve({ digest }: { digest: string }): string {
  return digest.replace(/[0-9]{9,}/g, "[number]");
}

/** A Notion page chunk carrying one attachment ref. */
function page({ ref, tsIso }: { ref: string; tsIso: string }): CorpusRecord {
  return {
    attrs: { chunkIndex: 0, files: [ref] },
    container: "notion",
    kind: "page",
    refs: [],
    source: "notion",
    sourceId: "page:00000000-0000-0000-0000-00000000a002:chunk:0",
    text: "Use this dashboard as the support team's source of truth.",
    title: "Support x Diagnostic Providers (1/3)",
    tsIso,
    url: "https://app.notion.com/p/0000000000000000000000000000a002",
  };
}

const WINDOW = { since: "2026-09-01T00:00:00.000Z", until: "2026-09-10T00:00:00.000Z" };

describe("refHealRun over a real home", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ref-heal-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("heals the damaged winner so the latest view names the stored file", () => {
    const bytes = carvableBytes();
    const { digest } = storeAttachment({ bytes, home });
    const intactRef = `attachment: sha256:${digest} (${String(bytes.length)} bytes)`;
    const carvedRef = `attachment: sha256:${carve({ digest })} (${String(bytes.length)} bytes)`;
    unwrap(
      writeCorpusRecords({
        home,
        protection: () => ok([]),
        records: [page({ ref: carvedRef, tsIso: "2026-09-10T04:48:00.000Z" })],
        window: WINDOW,
      }),
    );

    const census = unwrap(censusRefHeal({ home, protection: () => ok([]) }));
    expect(census.damagedIdentities).toBe(1);
    expect(census.superseded).toBe(0);
    expect(census.targets.map((target) => target.heal.healed)).toEqual([1]);

    const applied = unwrap(applyRefHeal({ census, home }));
    expect(applied).toEqual({ stillDamaged: [], written: 1 });

    const rows: CorpusRecord[] = [];
    for (const file of unwrap(listBronzeFiles({ home, protection: () => ok([]), source: "notion" }))) {
      readJsonlLines({
        onLine: ({ line }) => {
          const parsed = parseRow({ line });
          if ("record" in parsed) {
            rows.push(parsed.record);
          }
        },
        path: file.path,
      });
    }
    expect(rows.length).toBe(2);
    expect(latestRecords({ records: rows }).map((record) => record.attrs?.["files"])).toEqual([[intactRef]]);
  });

  it("heals a damaged row still on disk under its UNDASHED id, which the writer appends dashed", () => {
    // Written past the writer, the way bronze from before the frontier fix holds it: undashed and uncompacted.
    const bytes = carvableBytes();
    const { digest } = storeAttachment({ bytes, home });
    const carvedRef = `attachment: sha256:${carve({ digest })} (${String(bytes.length)} bytes)`;
    const undashed = {
      ...page({ ref: carvedRef, tsIso: "2026-09-10T04:48:00.000Z" }),
      sourceId: "page:0000000000000000000000000000a002:chunk:0",
    };
    const dir = bronzeSourceDir({ home, source: "notion" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old.jsonl"), `${serialiseRecord({ record: undashed })}\n`, "utf8");

    const census = unwrap(censusRefHeal({ home, protection: () => ok([]) }));
    expect(census.targets.map((target) => target.sourceId)).toEqual([
      "page:00000000-0000-0000-0000-00000000a002:chunk:0",
    ]);

    expect(unwrap(applyRefHeal({ census, home }))).toEqual({ stillDamaged: [], written: 1 });
  });

  it("counts a DASHED damaged row superseded by a newer intact version still on disk UNDASHED", () => {
    const bytes = carvableBytes();
    const { digest } = storeAttachment({ bytes, home });
    const intactRef = `attachment: sha256:${digest} (${String(bytes.length)} bytes)`;
    const carvedRef = `attachment: sha256:${carve({ digest })} (${String(bytes.length)} bytes)`;
    const newerUndashed = {
      ...page({ ref: intactRef, tsIso: "2026-09-09T00:00:00.000Z" }),
      sourceId: "page:0000000000000000000000000000a002:chunk:0",
    };
    const dir = bronzeSourceDir({ home, source: "notion" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "old.jsonl"),
      `${serialiseRecord({ record: page({ ref: carvedRef, tsIso: "2026-09-01T00:00:00.000Z" }) })}\n` +
        `${serialiseRecord({ record: newerUndashed })}\n`,
      "utf8",
    );

    expect(unwrap(censusRefHeal({ home, protection: () => ok([]) }))).toEqual({
      damagedIdentities: 1,
      superseded: 1,
      targets: [],
    });
  });

  it("leaves a damaged row alone when an intact version already supersedes it", () => {
    const bytes = carvableBytes();
    const { digest } = storeAttachment({ bytes, home });
    const intactRef = `attachment: sha256:${digest} (${String(bytes.length)} bytes)`;
    const carvedRef = `attachment: sha256:${carve({ digest })} (${String(bytes.length)} bytes)`;
    unwrap(
      writeCorpusRecords({
        home,
        protection: () => ok([]),
        records: [
          page({ ref: carvedRef, tsIso: "2026-09-01T00:00:00.000Z" }),
          page({ ref: intactRef, tsIso: "2026-09-09T00:00:00.000Z" }),
        ],
        window: WINDOW,
      }),
    );

    const census = unwrap(censusRefHeal({ home, protection: () => ok([]) }));
    expect(census).toEqual({ damagedIdentities: 1, superseded: 1, targets: [] });
  });

  it("finds nothing on a home with no carved ref", () => {
    const bytes = carvableBytes();
    const { digest } = storeAttachment({ bytes, home });
    const intactRef = `attachment: sha256:${digest} (${String(bytes.length)} bytes)`;
    unwrap(
      writeCorpusRecords({
        home,
        protection: () => ok([]),
        records: [page({ ref: intactRef, tsIso: "2026-09-09T00:00:00.000Z" })],
        window: WINDOW,
      }),
    );

    expect(unwrap(censusRefHeal({ home, protection: () => ok([]) }))).toEqual({
      damagedIdentities: 0,
      superseded: 0,
      targets: [],
    });
  });

  it("refuses a ref whose bytes were never stored and writes nothing", () => {
    const bytes = carvableBytes();
    const carvedRef = `attachment: sha256:${carve({ digest: contentDigest({ bytes }) })} (${String(bytes.length)} bytes)`;
    unwrap(
      writeCorpusRecords({
        home,
        protection: () => ok([]),
        records: [page({ ref: carvedRef, tsIso: "2026-09-10T04:48:00.000Z" })],
        window: WINDOW,
      }),
    );

    const census = unwrap(censusRefHeal({ home, protection: () => ok([]) }));
    expect(census.targets.flatMap((target) => target.heal.refusals.map((refusal) => refusal.code))).toEqual([
      "NO_CANDIDATE",
    ]);
    expect(unwrap(applyRefHeal({ census, home }))).toEqual({
      stillDamaged: ["page:00000000-0000-0000-0000-00000000a002:chunk:0"],
      written: 0,
    });
  });

  it("refuses the census when the protect list marks the Notion attachment store no-access", () => {
    const bytes = carvableBytes();
    storeAttachment({ bytes, home });
    const store = attachmentRoot({ home });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: store, why: "fixture" };

    const refusal = unwrapErr(censusRefHeal({ home, protection: () => ok([entry]) }));

    expect(refusal).toEqual([
      `refusing to read the Notion content stores: it would search ${store}, which the owner's protect list marks ` +
        `no-access at ${store} (fixture)`,
    ]);
  });

  it("refuses a stored digest symlinked into a protected tree before anything hashes it", () => {
    // The entry sits at the link's REAL target, as the owner's registry reader resolves one (`/var` is `/private/var`).
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "ref-heal-protected-")));
    try {
      const bytes = carvableBytes();
      const { digest } = storeAttachment({ bytes, home });
      const stored = join(attachmentRoot({ home }), digest.slice(0, 2), digest);
      writeFileSync(join(outside, "blob"), bytes);
      rmSync(stored);
      symlinkSync(join(outside, "blob"), stored);
      const carvedRef = `attachment: sha256:${carve({ digest })} (${String(bytes.length)} bytes)`;
      unwrap(
        writeCorpusRecords({
          home,
          protection: () => ok([]),
          records: [page({ ref: carvedRef, tsIso: "2026-09-10T04:48:00.000Z" })],
          window: WINDOW,
        }),
      );
      const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: outside, why: "fixture" };

      const refusal = unwrapErr(censusRefHeal({ home, protection: () => ok([entry]) }));

      expect(refusal).toEqual([
        `refusing to read the Notion content stores: it would read ${stored}, which the owner's protect list marks ` +
          `no-access at ${outside} (fixture)`,
      ]);
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });
});
