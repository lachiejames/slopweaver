/*
 * The `tagged` event on the journal — `rowEventIssues` and `applyRowEvent` refusing an event the decoder would not
 * read back, before anything is written, and a well-formed one round-tripping every field. It moved here when
 * `rowTags.test.ts` was split by behaviour.
 *
 * The journal round-trips write into a `mkdtempSync` directory and read it back, which `testing.md` allows:
 * `applyRowEvent`'s own read-back is what proves the decoder keeps every field it wrote.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { rowEventIssues } from "../../../../handover/rowEventSchema.js";
import { declaredTagsOf } from "../../../../handover/rowTagFold.js";
import { readRunJournal } from "../../../../handover/runStore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { AT, tagged } from "./harness.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { force: true, recursive: true });
  }
});

describe("the tagged event on the journal", () => {
  it("refuses an event carrying an unknown key before anything is written", () => {
    const issues = rowEventIssues({ event: tagged({ set: [{ key: "platfrom", value: "slack" }] }) });
    expect(issues).toEqual(['tagged: "platfrom" is not a tag key — did you mean platform?']);
  });

  it("refuses a key or value with surrounding whitespace, judged on the exact bytes written", () => {
    const issues = rowEventIssues({
      event: tagged({ drop: [" audience"], set: [{ key: " platform ", value: "slack" }] }),
    });
    expect(issues).toContain(
      'tagged: " platform " carries surrounding whitespace, which the journal would keep and no filter would match',
    );
    expect(issues).toContain(
      'tagged: " audience" carries surrounding whitespace, which the journal would keep and no filter would match',
    );
  });

  it("refuses a pair carrying a field the decoder would not read back", () => {
    const issues = rowEventIssues({
      event: { ...tagged({}), set: [{ extra: "survives-validation", key: "platform", value: "slack" }] },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("extra");
  });

  it("refuses a top-level field the decoder would not read back", () => {
    const issues = rowEventIssues({ event: { ...tagged({ drop: ["audience"] }), extra: "survives-validation" } });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("extra");
  });

  it("refuses a value-specific drop of a one-valued key before anything is written", () => {
    expect(rowEventIssues({ event: tagged({ drop: ["impact=high"] }) })).toEqual([
      "tagged: impact holds one value, so it is dropped whole — write the drop as impact",
    ]);
  });

  it("refuses a set array whose class would serialise it empty, before anything is written", () => {
    const dir = mkdtempSync(join(tmpdir(), "rowtags-"));
    dirs.push(dir);
    unwrap(
      applyRowEvent({ event: { atIso: AT, branch: "b", docHash: "h", kind: "started" }, runsDir: dir, slug: "a-row" }),
    );
    class VanishingArray<T> extends Array<T> {
      /** Serialises as empty, whatever it holds. */
      toJSON(): readonly T[] {
        return [];
      }
    }
    const set = VanishingArray.from([{ key: "platform", value: "slack" }]);
    const refused = unwrapErr(applyRowEvent({ event: tagged({ set }), runsDir: dir, slug: "a-row" }));
    expect(refused.code).toBe("INVALID_EVENT");
    expect(unwrap(readRunJournal({ runsDir: dir, slug: "a-row" })).events.length).toBe(1);
  });

  it("refuses an event whose own reflection throws, rather than throwing past the Result", () => {
    const dir = mkdtempSync(join(tmpdir(), "rowtags-"));
    dirs.push(dir);
    const target: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
    const event = new Proxy(target, {
      ownKeys: (): never => {
        throw new Error("boom");
      },
    });
    const refused = unwrapErr(applyRowEvent({ event, runsDir: dir, slug: "a-row" }));
    expect(refused.code).toBe("INVALID_EVENT");
    expect(refused.message).toContain("the event could not be inspected as plain data: boom");
  });

  it("answers a typed refusal for an event whose kind accessor throws, never the throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "rowtags-"));
    dirs.push(dir);
    const event: RunEvent = Object.defineProperty({ atIso: AT, branch: "b", docHash: "h" }, "kind", {
      enumerable: true,
      get: (): never => {
        throw new Error("boom-kind");
      },
    }) as RunEvent;
    const refused = unwrapErr(applyRowEvent({ event, runsDir: dir, slug: "a-row" }));
    expect(refused.code).toBe("INVALID_EVENT");
    expect(refused.message).toBe(
      '"an event whose kind cannot be read" does not satisfy its own schema: the event could not be inspected as plain data: boom-kind',
    );
  });

  it("refuses an event whose trap throws a value that cannot be described", () => {
    const target: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
    const thrown: unknown = Object.create(null);
    const event = new Proxy(target, {
      has: (): never => {
        throw thrown;
      },
    });
    expect(rowEventIssues({ event })).toEqual([
      "the event could not be inspected as plain data, and what it threw could not be described either",
    ]);
  });

  it("refuses an event whose kind read throws, before any schema is chosen", () => {
    const target: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
    const event = new Proxy(target, {
      has: (): never => {
        throw new Error("no has");
      },
    });
    expect(rowEventIssues({ event })).toEqual(["the event could not be inspected as plain data: no has"]);
  });

  it("refuses a symbol-keyed field the line would drop", () => {
    const event = Object.assign(tagged({ drop: ["audience"] }), { [Symbol("lost")]: "journal-me" });
    expect(rowEventIssues({ event })).toEqual(["tagged carries the symbol key Symbol(lost), which JSON drops"]);
  });

  it("refuses a write whose set array carries a named property the line would drop", () => {
    const dir = mkdtempSync(join(tmpdir(), "rowtags-"));
    dirs.push(dir);
    const started: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
    unwrap(applyRowEvent({ event: started, runsDir: dir, slug: "a-row" }));
    const set = Object.assign([{ key: "platform", value: "slack" }], { extra: { key: "colour", value: "red" } });
    const refused = unwrapErr(applyRowEvent({ event: tagged({ set }), runsDir: dir, slug: "a-row" }));
    expect(refused.code).toBe("INVALID_EVENT");
  });

  it("refuses a write whose set array carries a digits-only key that is not an index", () => {
    const dir = mkdtempSync(join(tmpdir(), "rowtags-"));
    dirs.push(dir);
    const started: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
    unwrap(applyRowEvent({ event: started, runsDir: dir, slug: "a-row" }));
    const set = Object.assign([{ key: "platform", value: "slack" }], { "01": { key: "colour", value: "red" } });
    const refused = unwrapErr(applyRowEvent({ event: tagged({ set }), runsDir: dir, slug: "a-row" }));
    expect(refused.code).toBe("INVALID_EVENT");
  });

  it("round-trips through the write path, every field read back, and moves no phase", () => {
    const dir = mkdtempSync(join(tmpdir(), "rowtags-"));
    dirs.push(dir);
    const event = tagged({
      drop: ["audience"],
      set: [
        { key: "workstream", value: "iso-certification" },
        { key: "impact", value: "high" },
      ],
    });
    const started: RunEvent = { atIso: AT, branch: "b", docHash: "h", kind: "started" };
    unwrap(applyRowEvent({ event: started, runsDir: dir, slug: "a-row" }));
    const written = unwrap(applyRowEvent({ event, runsDir: dir, slug: "a-row" }));
    expect(written.state.phase).toBe("open");
    const journal = unwrap(readRunJournal({ runsDir: dir, slug: "a-row" }));
    expect(journal.events).toEqual([started, event]);
    expect(declaredTagsOf({ events: journal.events }).map((tag) => `${tag.key}=${tag.value}`)).toEqual([
      "workstream=iso-certification",
      "impact=high",
    ]);
  });
});
