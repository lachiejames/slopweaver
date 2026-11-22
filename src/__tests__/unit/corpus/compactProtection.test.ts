/**
 * Compaction's write preflight over synthetic paths only: nothing here names a real directory, and the resolver is
 * injected, so no registry is ever read.
 */
import { describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { compactWritePreflight } from "../../../corpus/compactProtection.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { NO_PROTECTION } from "../../noProtection.js";

const DIR = "/fixture/home/corpus/bronze/github";
const CANONICAL = `${DIR}/canonical.jsonl`;
const FILES = [
  { bytes: 10, path: `${DIR}/2026-06-01_2026-06-08.jsonl` },
  { bytes: 20, path: `${DIR}/2026-06-08_2026-06-15.jsonl` },
];

const readOnlyAt =
  ({ path }: { path: string }): OwnerProtectionResolver =>
  () =>
    ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode: "read-only", path, why: "fixture" }]);

describe("compactWritePreflight", () => {
  it("hands back a judge that allows the sweep's temp files when nothing is covered", () => {
    const judge = unwrap(
      compactWritePreflight({
        canonicalPath: CANONICAL,
        files: FILES,
        home: "/fixture/home",
        protection: NO_PROTECTION,
        source: "github",
      }),
    );
    expect(unwrap(judge({ access: "write", path: `${DIR}/.tmp-dead-writer` }))).toBeUndefined();
  });

  it("refuses on a read-only window it would unlink, naming that window", () => {
    const held = FILES[1]!.path;
    expect(
      unwrapErr(
        compactWritePreflight({
          canonicalPath: CANONICAL,
          files: FILES,
          home: "/fixture/home",
          protection: readOnlyAt({ path: held }),
          source: "github",
        }),
      ),
    ).toStrictEqual({
      code: "COMPACT_PROTECTED",
      message:
        `refusing to compact github: it would write to ${held}, which the owner's protect list marks read-only at ` +
        `${held} (fixture) — nothing was compacted`,
    });
  });

  it("judges the canonical file first, so a list covering the whole source names it", () => {
    expect(
      unwrapErr(
        compactWritePreflight({
          canonicalPath: CANONICAL,
          files: FILES,
          home: "/fixture/home",
          protection: readOnlyAt({ path: DIR }),
          source: "github",
        }),
      ).message,
    ).toBe(
      `refusing to compact github: it would write to ${CANONICAL}, which the owner's protect list marks read-only at ` +
        `${DIR} (fixture) — nothing was compacted`,
    );
  });
});
