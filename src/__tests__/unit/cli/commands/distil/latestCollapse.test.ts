import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDistilBriefWithRest } from "../../../../../cli/commands/distil/brief.js";
import { type DistilPlanOptions, parseDistilPlanOptions } from "../../../../../cli/commands/distil/core.js";
import { loadDistilBatchPlan } from "../../../../../cli/commands/distil/plan.js";
import { bronzeFile } from "../../../../../corpus/corpusPaths.js";
import { withRowReader } from "../../../../../corpus/rowReader.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { DISTIL_PROMPT_FINGERPRINT } from "../../../../../gold/distil.js";
import { parseDistilBrief } from "../../../../../gold/distilBrief.js";
import { type DistilBatch, groupForDistil } from "../../../../../gold/distilGroup.js";
import { materialiseBatch } from "../../../../../gold/distilStreamPlan.js";
import type { LoadSlotGuard } from "../../../../../lib/loadSlots.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { admittingSlotGuard, refusingSlotGuard } from "../../../../loadSlotFixture.js";

const window = { since: "2026-01-01", until: "2026-02-01" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const record = (over: Partial<CorpusRecord>): CorpusRecord => ({
  container: "acme/web",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#1",
  text: "the ORIGINAL body",
  tsIso: "2026-01-05T00:00:00Z",
  url: "https://example.test/1",
  ...over,
});

/**
 * Seed a temp home's bronze with exactly these rows, in exactly this order — the append-only shape bronze
 * really has, where an edit is a NEW line beside the old one rather than a rewrite.
 */
function seedBronze({ rows }: { rows: readonly CorpusRecord[] }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-collapse-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "github"), { recursive: true });
  writeFileSync(bronzeFile({ home, source: "github", window }), rows.map((r) => JSON.stringify(r)).join("\n"), "utf8");
  return home;
}

/**
 * The plan for a temp home with every batch read back — what distil would hand the model, batch by batch.
 * The plan itself holds byte ranges, so this is the one place the test reads each batch's records.
 */
function loadPlan({
  home,
  options = unwrap(parseDistilPlanOptions({ rest: ["--home", home] })),
  guard = admittingSlotGuard,
}: {
  home: string;
  options?: DistilPlanOptions;
  guard?: LoadSlotGuard;
}): Result<{ batches: readonly DistilBatch[]; warnings: readonly string[] }> {
  return withRowReader({
    run: (reader) => {
      const plan = loadDistilBatchPlan({ guard, home, options, reader });
      if (plan.isErr()) {
        return err(plan.error);
      }
      const batches = plan.value.batches.map((batch) => unwrap(materialiseBatch({ batch, reader })));
      return ok({ batches, warnings: plan.value.warnings });
    },
  });
}

/** The batches distil would spend on, for a temp home. */
function inputsFor({ home }: { home: string }): { batches: readonly DistilBatch[]; warnings: readonly string[] } {
  return unwrap(loadPlan({ home }));
}

describe("loadDistilBatchPlan — the machine's load slot", () => {
  it("returns the refusal as its own errors, without reading bronze, when the slots are full", () => {
    const home = seedBronze({ rows: [record({})] });
    const refused = loadPlan({ guard: refusingSlotGuard({ pid: 4242 }), home });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)).toHaveLength(4);
    expect(unwrapErr(refused)[0]).toContain("pid 4242");
  });
});

// The stale row and its repair: SAME (source, container, sourceId), the edit one day later. Written stale
// first, so a reader that keeps physical order would hand the model the superseded prose.
const stale = record({ text: "the ORIGINAL body", tsIso: "2026-01-05T00:00:00Z" });
const current = record({ text: "the EDITED body", tsIso: "2026-01-06T00:00:00Z" });

describe("distil reads the logical latest view", () => {
  it("two versions of one record become ONE batch input — not one record beside its own replacement", () => {
    const { batches } = inputsFor({ home: seedBronze({ rows: [stale, current] }) });
    expect(batches).toHaveLength(1);
    // The assertion that matters: what the model would be handed, not merely what was loaded.
    expect(batches[0]!.records).toHaveLength(1);
  });

  it("the surviving batch input is the CURRENT version (newest tsIso), whichever order it was read in", () => {
    const forward = inputsFor({ home: seedBronze({ rows: [stale, current] }) });
    const reversed = inputsFor({ home: seedBronze({ rows: [current, stale] }) });
    expect(forward.batches[0]!.records[0]!.text).toBe("the EDITED body");
    expect(reversed.batches[0]!.records[0]!.text).toBe("the EDITED body");
    // …and read order does not move the cache key either, now that only one version can be in the batch.
    expect(reversed.batches[0]!.hash).toBe(forward.batches[0]!.hash);
  });

  it("a tsIso TIE is broken by the richer row, so a thin re-capture cannot evict the fuller one", () => {
    const thin = record({ sourceId: "#7", text: "thin", tsIso: "2026-01-07T00:00:00Z" });
    const full = record({ sourceId: "#7", text: "the fuller projection of the same message", tsIso: thin.tsIso });
    const { batches } = inputsFor({ home: seedBronze({ rows: [full, thin] }) });
    expect(batches[0]!.records).toHaveLength(1);
    expect(batches[0]!.records[0]!.text).toBe("the fuller projection of the same message");
  });

  it("reports how many superseded versions it hid, rather than dropping the number silently", () => {
    const home = seedBronze({ rows: [stale, current] });
    const loaded = loadPlan({ home });
    expect(loaded.isOk()).toBe(true);
    expect(unwrap(loaded).warnings).toContain("hid 1 superseded record version(s) — distilling the latest of each");
  });

  it("says nothing when there is nothing to hide", () => {
    const home = seedBronze({ rows: [stale] });
    const loaded = loadPlan({ home });
    expect(unwrap(loaded).warnings).toHaveLength(0);
  });

  it("does NOT over-merge: distinct records, and the same sourceId in two containers, both survive", () => {
    const other = record({ sourceId: "#2", text: "a different pr" });
    const otherRepo = record({ container: "acme/api", sourceId: "#1", text: "issue #1 of the OTHER repo" });
    const { batches } = inputsFor({ home: seedBronze({ rows: [stale, current, other, otherRepo] }) });
    // acme/api is its own container ⇒ its own batch; acme/web keeps the collapsed #1 plus #2.
    expect(batches).toHaveLength(2);
    const web = batches.find((b) => b.container === "acme/web")!;
    const api = batches.find((b) => b.container === "acme/api")!;
    // Batch records sit in chronological order, so the earlier #2 precedes the edited #1.
    expect(web.records.map((r) => r.text)).toEqual(["a different pr", "the EDITED body"]);
    expect(api.records.map((r) => r.text)).toEqual(["issue #1 of the OTHER repo"]);
  });

  // An adversarial review pass raised this and it is a REAL property of `latestRecords`: its Map keeps
  // FIRST-insertion order, so a winning later version is emitted at the position its superseded predecessor
  // occupied. Emitted order is therefore NOT the surviving physical order. The claim that it follows through
  // to what distil spends on is what fails: `groupForDistil` re-sorts each container by `byChronology`, and
  // once collapsed that comparator is TOTAL — it ties only on equal `tsIso` AND equal `sourceId`, which
  // inside one container IS the identity, and only one row per identity survives. So the reordering cannot
  // reach batch membership or a cache key. Pinned here, with the reviewer's own counterexample.
  it("emission order from the collapse cannot move batch content or the cache key", () => {
    const aOld = record({ sourceId: "#1", text: "A old", tsIso: "2026-01-01T00:00:00Z" });
    const b = record({ sourceId: "#2", text: "B", tsIso: "2026-01-02T00:00:00Z" });
    const aNew = record({ sourceId: "#1", text: "A new", tsIso: "2026-01-03T00:00:00Z" });

    const { batches } = inputsFor({ home: seedBronze({ rows: [aOld, b, aNew] }) });
    // `latestRecords` emits [A-new, B]; the surviving physical order is [B, A-new]. Chronology wins.
    expect(batches[0]!.records.map((r) => r.text)).toEqual(["B", "A new"]);
    // …and the hash matches grouping the survivors in their physical order — order in, same key out.
    const physicalOrder = groupForDistil({ promptVersion: DISTIL_PROMPT_FINGERPRINT, records: [b, aNew] });
    expect(batches[0]!.hash).toBe(physicalOrder[0]!.hash);
  });

  // A second adversarial pass found this, and it is a REAL behaviour change rather than a harmless one:
  // `--top-containers N` ranks containers by how many records they hold, so collapsing changes the ranking.
  // It is the change we WANT — ranking on physical rows let a container full of stale duplicates outrank a
  // genuinely busier one and buy a batch slot it had not earned, with the only token-spending verb's money.
  // Ranked on logical entities, real activity wins. Pinned so it stays deliberate. (No default applies this
  // filter: `groupForDistil` skips it unless the flag is passed, which is why a bare run is unaffected.)
  it("ranks --top-containers by LOGICAL entities, so stale duplicates cannot buy a container a slot", () => {
    const home = seedBronze({
      rows: [
        // one entity, three versions — physically the biggest container, logically the smallest
        record({ container: "acme/a", sourceId: "#1", text: "v1", tsIso: "2026-01-01T00:00:00Z" }),
        record({ container: "acme/a", sourceId: "#1", text: "v2", tsIso: "2026-01-02T00:00:00Z" }),
        record({ container: "acme/a", sourceId: "#1", text: "v3", tsIso: "2026-01-03T00:00:00Z" }),
        // two distinct entities — physically smaller, logically busier
        record({ container: "acme/b", sourceId: "#2", text: "two", tsIso: "2026-01-01T00:00:00Z" }),
        record({ container: "acme/b", sourceId: "#3", text: "three", tsIso: "2026-01-02T00:00:00Z" }),
      ],
    });
    const options = unwrap(parseDistilPlanOptions({ rest: ["--home", home, "--top-containers", "1"] }));
    const { batches } = unwrap(loadPlan({ home, options }));

    expect(batches).toHaveLength(1);
    expect(batches[0]!.container).toBe("acme/b");
    expect(batches[0]!.records.map((r) => r.text)).toEqual(["two", "three"]);
  });

  it("moves the cache key ONLY in a container that carried a superseded row", () => {
    const clean = [
      record({ container: "acme/clean", sourceId: "#10", text: "one", tsIso: "2026-01-02T00:00:00Z" }),
      record({ container: "acme/clean", sourceId: "#11", text: "two", tsIso: "2026-01-03T00:00:00Z" }),
    ];
    const rows = [...clean, stale, current];
    const collapsed = inputsFor({ home: seedBronze({ rows }) }).batches;
    // What distil produced BEFORE this change: the same grouping over the raw physical rows.
    const physical = groupForDistil({ promptVersion: DISTIL_PROMPT_FINGERPRINT, records: rows });
    expect(collapsed.filter((b) => b.container === "acme/clean").map((b) => b.hash)).toEqual(
      physical.filter((b) => b.container === "acme/clean").map((b) => b.hash),
    );
    // …and the affected container's key DOES move, which is what a populated gold would have re-spent on.
    expect(collapsed.find((b) => b.container === "acme/web")!.hash).not.toBe(
      physical.find((b) => b.container === "acme/web")!.hash,
    );
  });
});

describe("distil briefs the latest view end-to-end", () => {
  it("hands the session ONE batch carrying ONE record — the current text, never the superseded prose", () => {
    const home = seedBronze({ rows: [stale, current] });
    const briefPath = join(home, "brief.json");
    const code = runDistilBriefWithRest({ guard: admittingSlotGuard, rest: ["--home", home, "--out", briefPath] });
    expect(code).toBe(0);
    const brief = unwrap(parseDistilBrief({ input: JSON.parse(readFileSync(briefPath, "utf8")) }));
    expect(brief.refs).toHaveLength(1);
    expect(brief.prompt.user).toContain("Records: 1");
    expect(brief.prompt.user).toContain("the EDITED body");
    expect(brief.prompt.user).not.toContain("the ORIGINAL body"); // the double spend, and the stale prose, both gone
  });
});
