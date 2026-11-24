/**
 * The `store` backfill verbs' manifest rows: `edges`, `bots` and `classify`, against what each verb really is.
 *
 * A manifest row is help text and a catalogue entry, so nothing at runtime notices it drifting. What can be
 * asserted is the join: `classify`'s usage names exactly the flags its real parser advertises, and every row
 * says it writes to this machine's own store and nothing else.
 */
import { describe, expect, it } from "vitest";

import { parseStoreClassifyArgs, STORE_CLASSIFY_FLAG_NAMES } from "../../../../cli/commands/store/classifyCore.js";
import { backfillVerbs } from "../../../../cli/manifests/storeBackfillMeta.js";
import { unwrap } from "../../../../lib/result.js";

describe("backfillVerbs", () => {
  it("holds the three backfill verbs, in the order the store manifest spreads them", () => {
    expect(Object.keys(backfillVerbs)).toEqual(["edges", "bots", "classify"]);
  });

  it("marks every row local-state and undoored, because each writes only this machine's own store", () => {
    const rows = Object.values(backfillVerbs);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.meta.effect)).toEqual(["local-state", "local-state", "local-state"]);
    expect(rows.map((row) => row.meta.doorRouted)).toEqual([false, false, false]);
    expect(rows.map((row) => row.meta.createsWorkItem)).toEqual([false, false, false]);
  });

  it("names exactly classify's advertised flags in its usage", () => {
    const usage = backfillVerbs["classify"]!.meta.usage;
    const named = [...new Set(usage.match(/--[a-z][a-z-]*/g))].toSorted();
    expect(named).toEqual([...STORE_CLASSIFY_FLAG_NAMES].toSorted());
  });

  it("gives classify an example its own parser accepts as a dry run", () => {
    expect(backfillVerbs["classify"]!.meta.example).toBe("slopweaver store classify --dry-run");
    expect(unwrap(parseStoreClassifyArgs({ rest: ["--dry-run"] })).dryRun).toBe(true);
  });
});
