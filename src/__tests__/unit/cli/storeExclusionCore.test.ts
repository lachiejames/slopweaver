/**
 * `slopweaver store exclusions` — what it refuses, and what a preview and an apply each say.
 *
 * The refusal worth having a test for is `detect --apply`: detection cannot apply anything, and a flag that
 * parsed and then quietly did nothing is the one an operator later swears they passed. The rendering cases
 * pin two sentences a reader of a destructive report depends on — that a preview says nothing was deleted,
 * and that bronze still holds what a purge removed.
 */
import { describe, expect, it } from "vitest";

import { storeCommandErrorLines } from "../../../cli/commands/store/errors.js";
import { detectLines, parseExclusionArgs, purgeLines } from "../../../cli/commands/store/exclusionCore.js";
import { unwrap } from "../../../lib/result.js";
import type { PurgeReport } from "../../../store/syncExclusionStore.js";

/** A purge report, with only the numbers a case cares about spelled out. */
function report(over: Partial<PurgeReport> = {}): PurgeReport {
  return {
    after: 2136908,
    applied: false,
    before: 2136908,
    candidates: 1073350,
    deleted: 0,
    keptHumanThreads: true,
    retainedByRuleD: 42,
    unresolvedIds: [],
    ...over,
  };
}

describe("parseExclusionArgs", () => {
  it("reads the detect verb", () => {
    expect(unwrap(parseExclusionArgs({ rest: ["detect"] })).verb).toBe("detect");
  });

  it("reads purge --apply", () => {
    const args = unwrap(parseExclusionArgs({ rest: ["purge", "--apply"] }));
    expect(args.verb).toBe("purge");
    expect(args.apply).toBe(true);
  });

  it("defaults purge to a preview, so the destructive act is never the one you get by omission", () => {
    expect(unwrap(parseExclusionArgs({ rest: ["purge"] })).apply).toBe(false);
  });

  it("REFUSES detect --apply rather than ignoring it", () => {
    const parsed = parseExclusionArgs({ rest: ["detect", "--apply"] });
    expect(parsed.isErr()).toBe(true);
    expect(storeCommandErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("detection never changes policy");
  });

  it("refuses a verb it does not have, naming what was typed", () => {
    const parsed = parseExclusionArgs({ rest: ["delete"] });
    expect(storeCommandErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("got delete");
  });

  it("refuses an empty invocation rather than picking a verb", () => {
    expect(storeCommandErrorLines({ error: parseExclusionArgs({ rest: [] })._unsafeUnwrapErr() })[0]).toContain(
      "got nothing",
    );
  });

  it("carries --home through, because the denylist and the database must come from the same install", () => {
    expect(unwrap(parseExclusionArgs({ rest: ["purge", "--home", "/elsewhere"] })).home).toBe("/elsewhere");
  });

  it("honours rule D by default, so the orphaning shape is never the one you get by omission", () => {
    expect(unwrap(parseExclusionArgs({ rest: ["purge"] })).deleteHumanThreads).toBe(false);
  });

  it("reads purge --delete-human-threads as the waiver it is", () => {
    const args = unwrap(parseExclusionArgs({ rest: ["purge", "--apply", "--delete-human-threads"] }));
    expect(args.apply).toBe(true);
    expect(args.deleteHumanThreads).toBe(true);
  });

  it("REFUSES detect --delete-human-threads, because detection removes nothing to waive a rule about", () => {
    const parsed = parseExclusionArgs({ rest: ["detect", "--delete-human-threads"] });
    expect(parsed.isErr()).toBe(true);
    expect(storeCommandErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("detection removes nothing");
  });
});

describe("detectLines", () => {
  it("prints the denylist line to paste, and says nothing has changed", () => {
    const lines = detectLines({
      path: "/fixture/sync-author-denylist.txt",
      proposals: [
        {
          appId: "AAPP",
          appRows: 1000020,
          channelId: "C1",
          channelName: "#monitor-feed",
          channelRows: 1001672,
          denylistLine: "AAPP @ #monitor-feed",
          share: 99.8,
        },
      ],
    });
    expect(lines[0]).toBe("1 pair(s) read as pure alert traffic, holding 1000020 row(s):");
    expect(lines[1]).toContain("AAPP @ #monitor-feed");
    expect(lines.join("\n")).toContain("nothing has changed");
  });

  it("says so plainly when nothing qualifies", () => {
    expect(detectLines({ path: "/f", proposals: [] })[0]).toContain("no (app, channel) pair is dominant enough");
  });
});

describe("purgeLines", () => {
  it("says a preview deleted nothing and names the flag that would", () => {
    const lines = purgeLines({ report: report() });
    expect(lines[1]).toBe("Nothing has been deleted — this is a preview. Add --apply to delete.");
  });

  it("reports before, deleted and after on one line, because that is what the owner asked to see", () => {
    const lines = purgeLines({ report: report({ after: 1063558, applied: true, deleted: 1073350 }) });
    expect(lines[0]).toBe("store had 2136908 row(s); deleted 1073350; now 1063558");
  });

  it("always states that bronze still holds what was deleted", () => {
    expect(purgeLines({ report: report({ applied: true }) }).at(-1)).toContain("bronze is untouched");
  });

  it("names the ids a purge cannot act on rather than pretending it covered them", () => {
    const lines = purgeLines({ report: report({ unresolvedIds: ["u08gh5wb41j"] }) });
    expect(lines.join("\n")).toContain("1 denylist id(s) name no column this store records");
  });

  it("says nothing about unresolved ids when every entry was actionable", () => {
    expect(purgeLines({ report: report() }).join("\n")).not.toContain("name no column");
  });

  it("says rule D KEPT the replied-under rows, and names the flag that would take them", () => {
    const lines = purgeLines({ report: report() });
    expect(lines[2]).toBe(
      "rule D held back a further 42 denied row(s) a human replied under, so those threads keep their " +
        "parent. Pass --delete-human-threads to take them too.",
    );
  });

  it("says the replied-under rows GO, and that their replies lose their parent, when rule D is waived", () => {
    const lines = purgeLines({ report: report({ keptHumanThreads: false }) });
    expect(lines[2]).toBe(
      "--delete-human-threads: 42 denied row(s) a human replied under go as well, and every existing such " +
        "record is deleted retroactively. Their replies will have no parent in the store.",
    );
  });
});
