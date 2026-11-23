/**
 * An incident replayed over written synthetic register lines in its shape: sd-b9230a1c reached the owner's
 * Queue a second time with no receipt after the owner sent its first cut, sd-aca21d36, back for exactly that, and
 * sd-6288fa83's yes was set down by a hold re-reading it as an intent. Each fixture line is a
 * whole register line the shipped parser reads, so a reader change that stops reading them reddens here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runDraftHold } from "../../../../cli/commands/slack/draftJudgementRun.js";
import type { SlackDraftDeps } from "../../../../cli/commands/slack/draftRun.js";
import { EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../outbound/slack/draftLog.js";
import { receiptsOfRecording } from "../../../../outbound/slack/draftReceipts.js";
import type { SlackDraftEvent } from "../../../../outbound/slack/draftRegister.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/incidents/queue-receipts");

/** One fixture's register lines, in order. */
function linesOf({ id }: { id: string }): readonly string[] {
  return readFileSync(join(FIXTURES, `${id}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/** The parked draft one fixture opens with, as the register folds it. */
function parkedDraftOf({ id }: { id: string }) {
  return foldSlackDraftLog({ log: parseSlackDraftLog({ lines: linesOf({ id }).slice(0, 1) }) })[0]!.draft;
}

describe("sd-b9230a1c: a re-cut the owner sent back for its receipts, parked again with none", () => {
  const draft = parkedDraftOf({ id: "sd-b9230a1c" });

  it("is a re-cut of sd-aca21d36 carrying no link and no file", () => {
    expect([draft.recuts, draft.media]).toEqual([["sd-aca21d36"], undefined]);
  });

  it("is refused at recording, undeclared", () => {
    const refused = receiptsOfRecording({
      bump: false,
      declared: { kind: "undeclared" },
      media: 0,
      payload: draft.payload,
      sentBackFor: undefined,
    });

    expect(unwrapErr(refused).message).toContain("this card carries no receipt");
  });

  it("is refused when it calls itself self-evident, since the owner already sent its first cut back for receipts", () => {
    const refused = receiptsOfRecording({
      bump: false,
      declared: { kind: "self-evident", why: "the DM itself says it" },
      media: 0,
      payload: draft.payload,
      sentBackFor: "sd-aca21d36",
    });

    expect(unwrapErr(refused).message).toContain(
      "this re-cuts sd-aca21d36, which the owner sent back for its receipts",
    );
  });
});

describe("sd-6288fa83: a card that brought its receipts, approved, then set down", () => {
  const draft = parkedDraftOf({ id: "sd-6288fa83" });

  it("derives its receipts off its own message and files, no flag needed", () => {
    const receipts = unwrap(
      receiptsOfRecording({
        bump: false,
        declared: { kind: "undeclared" },
        media: draft.media!.length,
        payload: draft.payload,
        sentBackFor: undefined,
      }),
    );

    expect(receipts).toEqual({
      kind: "attached",
      links: [
        "https://github.com/acme/acme-admin/pull/101",
        "https://observe.acme.example/apm/trace/00000000000000000000000000000001?env=acme-cache-baseline&graphType=span_list",
        "https://observe.acme.example/apm/trace/00000000000000000000000000000002?env=acme-cache-experiment&graphType=span_list",
        "https://github.com/acme/acme-admin/pull/102",
        "https://observe.acme.example/apm/trace/00000000000000000000000000000003?env=acme-cache-baseline&graphType=waterfall&spanViewType=profiles",
        "https://observe.acme.example/apm/trace/00000000000000000000000000000004?env=acme-cache-experiment&graphType=waterfall&spanViewType=profiles",
        "https://github.com/acme/acme-admin/pull/103",
        "https://observe.acme.example/databases/queries?query=env%3Aproduction%20-service%3Aacme-cache%20%40db.user%3Aacme-user&dbType=PostgreSQL&view=samples",
        "https://observe.acme.example/databases/queries?query=env%3Aacme-cache-experiment%20-service%3Aacme-cache&dbType=PostgreSQL&view=samples",
      ],
      media: 3,
    });
  });

  it("refuses the set-down hold over the register as it stood, appending nothing", () => {
    const lines = linesOf({ id: "sd-6288fa83" });
    const stood = lines.slice(0, 3);
    const setDown = parseSlackDraftLog({ lines: lines.slice(3) }).events.find(
      (event): event is Extract<SlackDraftEvent, { kind: "held" }> => event.kind === "held",
    )!;
    const appended: SlackDraftEvent[] = [];
    const deps: Pick<
      SlackDraftDeps,
      "appendEvent" | "lockRegister" | "nowIso" | "out" | "readLandedDrafts" | "readLog"
    > = {
      appendEvent: ({ event }) => {
        appended.push(event);
        return ok(true as const);
      },
      lockRegister: () => ok(() => undefined),
      nowIso: () => "2026-10-13T03:49:37.881Z",
      out: () => undefined,
      readLandedDrafts: () => ({
        bindings: { bound: [], unreadable: [] },
        kind: "read" as const,
        ledgerRows: 1732,
        vanished: [],
      }),
      readLog: () => stood,
    };

    expect(foldSlackDraftLog({ log: parseSlackDraftLog({ lines: stood }) })[0]!.draft.approval!.heard).toBe(
      "That covers it, and I'm going to approve sending it",
    );
    expect(
      runDraftHold({
        deps,
        options: {
          home: "/tmp/no-home",
          id: "sd-6288fa83",
          json: false,
          mode: "hold",
          reason: setDown.reason,
          why: setDown.why,
        },
      }),
    ).toBe(EXIT_USAGE);
    expect(appended).toEqual([]);
  });
});
