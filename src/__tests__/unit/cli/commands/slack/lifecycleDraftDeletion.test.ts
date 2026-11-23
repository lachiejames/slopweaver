/**
 * The one seam both `slack delete` lanes journal through: it reports what it recorded, and a journal that fails, by
 * returning an error or by throwing, prints nothing on stdout and never escapes, because the delete already happened.
 */
import { describe, expect, it } from "vitest";

import { journalDeletedDraft } from "../../../../../cli/commands/slack/lifecycleDraftDeletion.js";
import type { JournalDraftDeletion } from "../../../../../cli/commands/slack/lifecycleRunTypes.js";
import { err, ok } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";

const NOW = "2026-10-25T08:00:00.000Z";

/** Run the seam over one journal and return what it printed and what the journal was asked. */
function run({ journal }: { journal: JournalDraftDeletion }): {
  out: string[];
  calls: { channel: string; home: string; nowIso: string; ts: string }[];
} {
  const out: string[] = [];
  const calls: { channel: string; home: string; nowIso: string; ts: string }[] = [];
  journalDeletedDraft({
    channel: "C1",
    deps: {
      journalDraftDeletion: (args) => {
        calls.push(args);
        return journal(args);
      },
      nowIso: () => NOW,
      out: (line) => {
        out.push(line);
      },
    },
    home: "/home",
    ts: "1700000000.000100",
  });
  return { calls, out };
}

describe("journalDeletedDraft", () => {
  it("names every row it recorded, stamped with the clock, and prints nothing when no row was released there", () => {
    const recorded = run({ journal: () => ok(["sd-a", "sd-b"]) });
    const none = run({ journal: () => ok([]) });

    expect(recorded).toEqual({
      calls: [{ channel: "C1", home: "/home", nowIso: NOW, ts: "1700000000.000100" }],
      out: ["draft register: recorded deleted on sd-a, sd-b"],
    });
    expect(none.out).toEqual([]);
  });

  it("prints nothing on stdout and returns normally when the journal returns an error or throws", () => {
    const returned = run({
      journal: () => err(SlackDraftErrors.writeFailed({ cause: new Error("disk full"), path: "/home/x" })),
    });
    const thrown = run({
      journal: () => {
        throw new Error("EACCES: permission denied, unlink 'slack-drafts.jsonl.lock'");
      },
    });

    // A thrown value String() itself throws on.
    const unprintable = run({
      journal: () => {
        throw Object.create(null) as unknown;
      },
    });

    expect([returned.out, thrown.out, unprintable.out]).toEqual([[], [], []]);
    expect([returned.calls.length, thrown.calls.length, unprintable.calls.length]).toEqual([1, 1, 1]);
  });
});
