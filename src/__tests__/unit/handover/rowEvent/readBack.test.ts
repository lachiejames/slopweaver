/**
 * `applyRowEvent`'s read-back: it compares the event it appended to what the file decodes, not the order of its
 * keys, so a question written in the order `handover ask` builds it, nested stakes included, reads back whole, while
 * a write the journal would genuinely lose is still refused. A genuine `mkdtempSync` round trip, every directory
 * removed after the case that minted it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseLedger } from "../../../../handover/ledger.js";
import { applyRowEvent } from "../../../../handover/rowEvent.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { LATER, runsDir, STARTED, seed, useRunsDirs } from "./harness.js";

useRunsDirs();

describe("the read-back compares the event, not its key ORDER", () => {
  it("accepts a multi-field question whose keys are not in the decoder's own order", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "shaped" });
    // Exactly the order `handover ask` builds: `question` ahead of the three shape fields, where
    // `ledger.ts` answers with them alphabetically. Written the other way round the write is byte-identical,
    // which is why this case names the order rather than only the fields.
    const written = unwrap(
      applyRowEvent({
        event: {
          atIso: LATER,
          kind: "question",
          question: "which base branch?",
          lean: "main",
          options: [
            { letter: "A", option: "main", tradeoff: "none" },
            { letter: "B", option: "the release branch", tradeoff: "one more rebase" },
          ],
          problem: "the doc names two",
        },
        runsDir: dir,
        slug: "shaped",
      }),
    );

    expect(written.state.phase).toBe("waiting-on-owner");
    const events = parseLedger({ text: readFileSync(join(dir, "shaped.jsonl"), "utf8") }).events;
    expect(events.map((event) => event.kind)).toEqual(["started", "question"]);
  });

  it("round-trips the stakes as one nested object, whatever order its own keys were written in", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "staked" });
    unwrap(
      applyRowEvent({
        event: {
          atIso: LATER,
          kind: "question",
          question: "which base branch?",
          lean: "main",
          options: [
            { letter: "A", option: "main", tradeoff: "none" },
            { letter: "B", option: "the release branch", tradeoff: "one more rebase" },
          ],
          problem: "the doc names two",
          // Deliberately NOT alphabetical: the read-back sorts keys, and a nested object is where a shallow
          // sort would have missed it.
          stakes: {
            stillReal: "the doc still names both",
            risk: "a run starts on the wrong base",
            blastRadius: "one doc",
          },
        },
        runsDir: dir,
        slug: "staked",
      }),
    );

    const question = parseLedger({ text: readFileSync(join(dir, "staked.jsonl"), "utf8") }).events[1]!;
    expect(question).toMatchObject({
      kind: "question",
      stakes: { blastRadius: "one doc", risk: "a run starts on the wrong base", stillReal: "the doc still names both" },
    });
  });

  it("still refuses a write the journal genuinely lost, so the check has not been turned off", () => {
    const dir = runsDir();
    seed({ dir, events: [STARTED], slug: "shaped" });
    const failed = unwrapErr(
      applyRowEvent({
        // `question` is the field a `question` event's own schema requires, so an empty one is refused
        // BEFORE the append — the same guard, reached on a shape the writer must never put on disk.
        event: { atIso: LATER, kind: "question", question: "" },
        runsDir: dir,
        slug: "shaped",
      }),
    );

    expect(failed.code).toBe("INVALID_EVENT");
  });
});
