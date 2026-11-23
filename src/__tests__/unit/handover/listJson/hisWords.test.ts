/** The owner's words as a row publishes them: a held quote, an unread reason, a defect, steers and pull-request matches. */
import { describe, expect, it } from "vitest";

import {
  boardJsonDocument,
  NO_BOARD_REFERENCES,
  NO_DETACHED_FINDINGS,
} from "../../../../cli/commands/handover/listJson.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import { EMPTY_TAG_FILTER, parseTagFilter } from "../../../../handover/tagFilter.js";
import { unwrap } from "../../../../lib/result.js";
import { doc, modelsFor, OBSERVED, SCAN_STARTED } from "./fixtures.js";

describe("boardJsonDocument's owner words", () => {
  it("publishes a held quote, an unread reason and a defect each in its own field", () => {
    const words = {
      anchor: "talk:t1",
      cut: "none",
      atIso: "2026-09-28T06:03:54.584Z",
      where: "console-voice",
      words: "my exact words",
    } as const;
    const docs = [
      { ...doc({ kind: "ask", slug: "held" }), hisWords: { hisWords: words, kind: "held" } },
      { ...doc({ kind: "ask", slug: "unread" }), hisWords: { anchor: "talk:t2", kind: "unread", why: "gone" } },
      { ...doc({ kind: "ask", slug: "defect" }), hisWords: { kind: "defect", why: "twice" } },
      { ...doc({ kind: "ask", slug: "finding" }), observedBy: "s1", origin: "finding" },
    ] satisfies HandoverDoc[];
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    const bySlug = new Map(document.rows.map((row) => [row.slug, row]));
    expect(
      ["held", "unread", "defect", "finding"].map((slug) => {
        const row = bySlug.get(slug)!;
        return [row.ownerWords, row.ownerWordsUnread, row.ownerWordsDefect, row.origin, row.observedBy];
      }),
    ).toEqual([
      [words, undefined, undefined, undefined, undefined],
      [undefined, "gone", undefined, undefined, undefined],
      [undefined, undefined, "twice", undefined, undefined],
      [undefined, undefined, undefined, "finding", "s1"],
    ]);
  });

  it("publishes every further steer, an unread and a defective one included, so the card can say each", () => {
    const words = {
      anchor: "talk:t3",
      cut: "none",
      atIso: "2026-10-03T08:57:21Z",
      where: "call",
      words: "again",
    } as const;
    const docs = [
      {
        ...doc({ kind: "ask", slug: "steered" }),
        hisWordsSteers: [
          { group: { hisWords: words, kind: "held" }, index: 1 },
          { group: { anchor: "talk:t4", kind: "unread", why: "gone" }, index: 2 },
          { group: { kind: "defect", why: "steer 3: torn" }, index: 3 },
        ],
      },
    ] satisfies HandoverDoc[];
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      models: modelsFor({ docs }),
      observedAtIso: OBSERVED,
      references: NO_BOARD_REFERENCES,
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    expect(document.rows[0]!.ownerWordsSteers).toEqual([
      { index: 1, kind: "held", quote: words },
      { anchor: "talk:t4", index: 2, kind: "unread", why: "gone" },
      { index: 3, kind: "defect", why: "steer 3: torn" },
    ]);
  });

  // MEASURED: a card about a pull request carried none of the owner's words while another row held
  // the owner's proof ask, naming the same pull request by URL.
  it("carries the owner's words onto a row naming the same pull request, even when the filter hides the row holding them", () => {
    const ask = {
      anchor: "talk:proof",
      atIso: "2026-09-25T02:41:26.704Z",
      cut: "none",
      where: "session",
      words: "it needs before and after proof",
    } as const;
    const docs = [
      {
        ...doc({ slug: "proof-row", summary: "proof for https://github.com/acme/acme-admin/pull/17564" }),
        hisWords: { hisWords: ask, kind: "held" },
      },
      doc({ kind: "ask", slug: "card-row", summary: "acme-admin #17564 is ready for the owner's word" }),
      doc({ kind: "ask", slug: "elsewhere", summary: "acme/other#17564" }),
    ] satisfies HandoverDoc[];
    const filter = parseTagFilter({ flagValues: ["kind=ask"] });
    expect(filter.isOk()).toBe(true);
    const document = boardJsonDocument({
      detached: NO_DETACHED_FINDINGS,
      filter: unwrap(filter),
      handoverDir: "/h",
      models: modelsFor({ docs }),
      observedAtIso: OBSERVED,
      references: { ...NO_BOARD_REFERENCES, repoSlugs: new Map([["/w/repo", "acme/acme-admin"]]) },
      scanStartedIso: SCAN_STARTED,
      unreadable: [],
      unresolved: 0,
    });
    expect(document.rows.map((row) => [row.slug, row.prSteers])).toEqual([
      ["card-row", [{ identity: "acme/acme-admin#17564", quote: ask, rowSlug: "proof-row" }]],
      ["elsewhere", []],
    ]);
  });
});
