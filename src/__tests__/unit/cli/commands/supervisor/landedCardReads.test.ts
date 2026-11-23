/**
 * The approved-draft gate's landing reads over a real throwaway home: the card-landing ledger, then only the cards a
 * landing names.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { landedCardDraftIds, readLandedDraftBindings } from "../../../../../cli/commands/supervisor/landedCardReads.js";
import { appendRunEvent, runJournalPath } from "../../../../../handover/runStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { appendCardLanding } from "../../../../../talk/cardLandingStore.js";
import { draftItem, landed } from "../../../supervisor/draftItemFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh home with the given landings on its ledger. */
function homeWithLandings({ cardKeys }: { cardKeys: readonly string[] }): string {
  const home = mkdtempSync(join(tmpdir(), "landed-card-reads-"));
  homes.push(home);
  for (const cardKey of cardKeys) {
    expect(appendCardLanding({ home, row: landed({ cardKey, decidedIso: "2026-10-08T00:16:54.000Z" }) }).isOk()).toBe(
      true,
    );
  }
  return home;
}

const HELD = draftItem({ id: "sd-c57b4ade", tsIso: "2026-10-08T00:10:00.000Z" });

describe("readLandedDraftBindings", () => {
  it("binds a landing on a draft's own card to that held row", () => {
    const home = homeWithLandings({ cardKeys: ["post:sd-c57b4ade"] });
    const read = readLandedDraftBindings({ home, items: [HELD], skipped: [] });

    expect(read.kind).toBe("read");
    const { bindings } = read as Extract<typeof read, { kind: "read" }>;
    expect(bindings.bound.map((bound) => [bound.landing.cardKey, bound.namedId, bound.item.id])).toEqual([
      ["post:sd-c57b4ade", "sd-c57b4ade", "sd-c57b4ade"],
    ]);
    expect(bindings.unreadable).toEqual([]);
  });

  it("binds nothing for an ask whose doc is gone and a hand step no register holds, and reports both vanished", () => {
    const home = homeWithLandings({ cardKeys: ["ask:organisation-hunt-2026-10-07", "hand:h-0001"] });

    expect(readLandedDraftBindings({ home, items: [HELD], skipped: [] })).toEqual({
      bindings: { bound: [], unreadable: [] },
      kind: "read",
      ledgerRows: 2,
      vanished: [
        {
          landing: landed({ cardKey: "ask:organisation-hunt-2026-10-07", decidedIso: "2026-10-08T00:16:54.000Z" }),
          ledgerRow: 0,
        },
        { landing: landed({ cardKey: "hand:h-0001", decidedIso: "2026-10-08T00:16:54.000Z" }), ledgerRow: 1 },
      ],
    });
  });

  it("refuses a ledger line it cannot read rather than reading it as no landing", () => {
    const home = homeWithLandings({ cardKeys: ["post:sd-c57b4ade"] });
    appendFileSync(join(home, "talk", "card-landings.jsonl"), "{not json\n");

    expect(readLandedDraftBindings({ home, items: [HELD], skipped: [] })).toEqual({
      kind: "unreadable",
      why: "card-landing ledger line(s) 2 would not read, and one may be the owner's yes",
    });
  });

  // A key that is no card key — a one-off sanitiser's space in it — was never a landing, so it cannot be the yes.
  it("reads past a refused line recording a key that is no card key, and still refuses one naming a real card", () => {
    const home = homeWithLandings({ cardKeys: ["post:sd-c57b4ade"] });
    const ledger = join(home, "talk", "card-landings.jsonl");
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "ask:acme Fixture 1", kind: "landed" })}\n`);
    expect(readLandedDraftBindings({ home, items: [HELD], skipped: [] }).kind).toBe("read");
    appendFileSync(ledger, `${JSON.stringify({ cardKey: "post:sd-0000abcd", kind: "landed" })}\n`);
    expect(readLandedDraftBindings({ home, items: [HELD], skipped: [] })).toEqual({
      kind: "unreadable",
      why: "card-landing ledger line(s) 3 would not read, and one may be the owner's yes",
    });
  });

  it("reads an ask as it stood when the owner spoke, not when the landing was written", () => {
    const home = homeWithLandings({ cardKeys: [] });
    const slug = "organisation-hunt-2026-10-07";
    const paths = stateHomePaths({ home });
    mkdirSync(paths.handovers, { recursive: true });
    writeFileSync(
      join(paths.handovers, `${slug}.md`),
      `---\nslug: ${slug}\nkind: ask\nsummary: "the hunt"\nstatus: ready\naskedIso: 2026-10-08T00:00:00.000Z\n` +
        "priority: p1\nrepo: /tmp\nblockedBy: []\nartifact: null\ndoneWhen: []\n---\n\n# the hunt\n",
    );
    const ask = ({ atIso, question }: { atIso: string; question: string }): void => {
      appendRunEvent({ event: { atIso, kind: "question", question }, runsDir: paths.runs, slug });
    };
    ask({ atIso: "2026-10-08T00:05:00.000Z", question: "Send sd-c57b4ade to Seth?" });
    ask({ atIso: "2026-10-08T00:15:00.000Z", question: "Anything else?" });
    const row = landed({ cardKey: `ask:${slug}`, decidedIso: "2026-10-08T00:10:00.000Z" });
    expect(appendCardLanding({ home, row: { ...row, atIso: "2026-10-08T00:20:00.000Z" } }).isOk()).toBe(true);
    const read = readLandedDraftBindings({ home, items: [HELD], skipped: [] });

    expect(read.kind).toBe("read");
    const { bindings, vanished } = read as Extract<typeof read, { kind: "read" }>;
    expect(bindings.bound.map((bound) => bound.namedId)).toEqual(["sd-c57b4ade"]);
    expect(vanished).toEqual([]);
  });

  it("keeps the ids an ask names as the owner's words land, or why it would not read", () => {
    const home = homeWithLandings({ cardKeys: [] });
    const slug = "organisation-hunt-2026-10-07";
    const paths = stateHomePaths({ home });
    mkdirSync(paths.handovers, { recursive: true });
    writeFileSync(
      join(paths.handovers, `${slug}.md`),
      `---\nslug: ${slug}\nkind: ask\nsummary: "the hunt"\nstatus: ready\naskedIso: 2026-10-08T00:00:00.000Z\n` +
        "priority: p1\nrepo: /tmp\nblockedBy: []\nartifact: null\ndoneWhen: []\n---\n\n# the hunt\n",
    );
    appendRunEvent({
      event: { atIso: "2026-10-08T00:05:00.000Z", kind: "question", question: "Send sd-c57b4ade to Seth?" },
      runsDir: paths.runs,
      slug,
    });
    const landing = landed({ cardKey: `ask:${slug}`, decidedIso: "2026-10-08T00:10:00.000Z" });
    const read = landedCardDraftIds({ home, landing, rows: [] });
    appendFileSync(runJournalPath({ runsDir: paths.runs, slug }), "not json\n");
    const unread = landedCardDraftIds({ home, landing, rows: [] });

    expect(read).toEqual({ draftIds: ["sd-c57b4ade"] });
    expect(Object.keys(unread)).toEqual(["draftIdsUnread"]);
    expect(unread.draftIdsUnread).toContain("run journal would not read");
  });

  it("reads an empty ledger as no bindings, and no rows judged", () => {
    const home = homeWithLandings({ cardKeys: [] });

    expect(readLandedDraftBindings({ home, items: [HELD], skipped: [] })).toEqual({
      bindings: { bound: [], unreadable: [] },
      kind: "read",
      ledgerRows: 0,
      vanished: [],
    });
  });
});
