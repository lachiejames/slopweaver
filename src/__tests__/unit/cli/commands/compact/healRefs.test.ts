import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COMPACT_HEAL_REFS_FLAG_NAMES,
  healRefsLines,
  parseCompactHealRefsArgs,
  runCompactHealRefs,
} from "../../../../../cli/commands/compact/healRefs.js";
import { COMPACT_HEAL_REFS_USAGE } from "../../../../../cli/commands/compact/healRefsUsage.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { RefHealErrors } from "../../../../../corpus/notion/refHealErrors.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const MANGLED = "2f9c62af[number]e38918a4d545fa[number]aa05a2aee060c159ea11e9";

/** A Notion page record — the census lines read only its id and instant. */
const RECORD: CorpusRecord = {
  container: "notion",
  kind: "page",
  refs: [],
  source: "notion",
  sourceId: "page:0000000000000000000000000000a002:chunk:0",
  text: "body text",
  title: "a page",
  tsIso: "2026-09-10T04:48:00.000Z",
  url: "https://app.notion.com/p/0000000000000000000000000000a002",
};

describe("healRefsLines", () => {
  it("heads with the census and lists each target with its refusals under it", () => {
    const refusal = RefHealErrors.noCandidate({ mangled: MANGLED });
    const lines = healRefsLines({
      census: {
        damagedIdentities: 3,
        superseded: 1,
        targets: [
          { heal: { healed: 2, record: RECORD, refusals: [] }, sourceId: "page:a", tsIso: "2026-09-01T00:00:00.000Z" },
          {
            heal: { healed: 0, record: RECORD, refusals: [refusal] },
            sourceId: "page:b",
            tsIso: "2026-09-02T00:00:00.000Z",
          },
        ],
      },
    });

    expect(lines).toEqual([
      "heal-refs · notion: 3 record(s) ever named a carved digest; 1 already superseded by an intact version; 2 still current, 1 healable",
      "  page:a @ 2026-09-01T00:00:00.000Z: 2 ref(s) healed",
      "  page:b @ 2026-09-02T00:00:00.000Z: 0 ref(s) healed",
      `    refused NO_CANDIDATE: sha256:${MANGLED} matches no stored file — only a re-pull of its page can restore it`,
    ]);
  });
});

describe("parseCompactHealRefsArgs", () => {
  it("reads --apply and --home", () => {
    const parsed = unwrap(parseCompactHealRefsArgs({ rest: ["--apply", "--home", "/h"] }));

    expect([...parsed.flags]).toEqual(["apply"]);
    expect(parsed.values).toEqual({ home: "/h" });
  });

  it("refuses a flag it does not advertise", () => {
    const parsed = parseCompactHealRefsArgs({ rest: ["--force"] });

    expect(unwrapErr(parsed).join(" ")).toContain("force");
  });

  it("advertises exactly the flags it parses, and the usage names each", () => {
    expect(COMPACT_HEAL_REFS_FLAG_NAMES).toEqual(["--apply", "--home"]);
    expect(COMPACT_HEAL_REFS_FLAG_NAMES.filter((flag) => !COMPACT_HEAL_REFS_USAGE.includes(flag))).toEqual([]);
  });
});

describe("runCompactHealRefs", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "heal-refs-verb-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("exits expected-empty on a home with no carved ref", () => {
    expect(runCompactHealRefs(["node", "slopweaver", "compact", "heal-refs", "--home", home])).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("prints usage on --help", () => {
    expect(runCompactHealRefs(["node", "slopweaver", "compact", "heal-refs", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an unknown flag as a usage error", () => {
    expect(runCompactHealRefs(["node", "slopweaver", "compact", "heal-refs", "--force", "--home", home])).toBe(
      EXIT_USAGE,
    );
  });
});
