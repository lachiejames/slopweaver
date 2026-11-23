/**
 * `handover currency`'s board half over a throwaway home: a run waiting on the owner whose doc left the board is the
 * detached ask the Queue draws, a run's reconfirm counts as the ask's still-real check, and a doc or journal that
 * will not read draws no ask, so it never refuses the board.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { askStillRealIsoOf, currencyBoardOf } from "../../../../../cli/commands/handover/currencyBoard.js";
import type { BoardModel } from "../../../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { appendRunEvent, runJournalPath } from "../../../../../handover/runStore.js";
import { scanBoard } from "../../../../../handover/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const ASKED = "2026-10-02T11:00:00.000Z";
const minted: string[] = [];

const freshHome = (): { home: string; handoverDir: string; runsDir: string } => {
  const home = mkdtempSync(join(tmpdir(), "currency-board-"));
  minted.push(home);
  const handoverDir = join(home, "handovers");
  mkdirSync(handoverDir);
  const runsDir = stateHomePaths({ home }).runs;
  mkdirSync(runsDir, { recursive: true });
  return { handoverDir, home, runsDir };
};

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("currencyBoardOf", () => {
  it("carries a run waiting on the owner whose doc left the board as a detached ask, floored at its asking", () => {
    const { handoverDir, home, runsDir } = freshHome();
    for (const event of [
      { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: ASKED, kind: "question", question: "Ship it?" },
    ] satisfies RunEvent[]) {
      unwrap(appendRunEvent({ event, runsDir, slug: "doc-gone" }));
    }

    const { asks } = currencyBoardOf({ docs: [], handoverDir, home, unreadable: [] });

    expect(asks).toEqual([
      {
        anchor: undefined,
        askedIso: ASKED,
        doneWhen: [],
        sameQuestionRuling: undefined,
        slug: "doc-gone",
        stillRealIso: undefined,
      },
    ]);
  });

  it("takes a run-backed ask's reconfirm as its still-real instant, the later of it and the doc's", () => {
    const { handoverDir, home, runsDir } = freshHome();
    const RECONFIRMED = "2026-10-03T09:00:00.000Z";
    writeFileSync(join(handoverDir, "asked.md"), "---\nslug: asked\nstatus: ready\n---\n");
    writeFileSync(
      join(handoverDir, "doc-later.md"),
      '---\nslug: doc-later\nstatus: ready\nstillReal: "re-read"\nstillRealIso: 2026-10-04T09:00:00.000Z\n---\n',
    );
    for (const slug of ["asked", "doc-later"]) {
      for (const event of [
        { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
        { atIso: ASKED, kind: "question", question: "Ship it?" },
        { atIso: RECONFIRMED, kind: "question-reconfirmed", question: "Ship it?", stillReal: "thread still silent" },
      ] satisfies RunEvent[]) {
        unwrap(appendRunEvent({ event, runsDir, slug }));
      }
    }
    const docs = unwrap(scanBoard({ handoverDir })).docs;

    const { asks } = currencyBoardOf({ docs, handoverDir, home, unreadable: [] });

    expect(asks.map(({ slug, stillRealIso }) => ({ slug, stillRealIso }))).toEqual([
      { slug: "asked", stillRealIso: RECONFIRMED },
      { slug: "doc-later", stillRealIso: "2026-10-04T09:00:00.000Z" },
    ]);
  });

  it("drops a reconfirm of the question a re-ask replaced", () => {
    const { handoverDir, home, runsDir } = freshHome();
    writeFileSync(join(handoverDir, "reasked.md"), "---\nslug: reasked\nstatus: ready\n---\n");
    for (const event of [
      { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: ASKED, kind: "question", question: "Ship it?" },
      { atIso: "2026-10-03T09:00:00.000Z", kind: "question-reconfirmed", question: "Ship it?", stillReal: "silent" },
      { atIso: "2026-10-03T10:00:00.000Z", kind: "question", question: "Ship it now?" },
    ] satisfies RunEvent[]) {
      unwrap(appendRunEvent({ event, runsDir, slug: "reasked" }));
    }
    const docs = unwrap(scanBoard({ handoverDir })).docs;

    const { asks } = currencyBoardOf({ docs, handoverDir, home, unreadable: [] });

    expect(asks.map(({ slug, stillRealIso }) => ({ slug, stillRealIso }))).toEqual([
      { slug: "reasked", stillRealIso: undefined },
    ]);
  });

  // A landed ask restored in the same words kept the owner's ruling off its card.
  it("carries the ruling the owner gave before the same question was asked again, and keeps the later asking's instant", () => {
    const { handoverDir, home, runsDir } = freshHome();
    const RESTORED = "2026-10-04T10:00:00.000Z";
    for (const slug of ["restored", "reworded"]) {
      writeFileSync(join(handoverDir, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n`);
      for (const event of [
        { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
        { atIso: ASKED, kind: "question", question: "Ship it?" },
        { anchor: "talk:ruled", atIso: "2026-10-03T09:00:00.000Z", kind: "ruling", ruling: "Ship it." },
        { atIso: RESTORED, kind: "question", question: slug === "restored" ? "Ship it?" : "Ship it today?" },
      ] satisfies RunEvent[]) {
        unwrap(appendRunEvent({ event, runsDir, slug }));
      }
    }
    const docs = unwrap(scanBoard({ handoverDir })).docs;

    const { asks } = currencyBoardOf({ docs, handoverDir, home, unreadable: [] });

    expect(
      asks.map(({ askedIso, sameQuestionRuling, slug }) => ({ askedIso, sameQuestionRuling, slug })),
    ).toStrictEqual([
      {
        askedIso: RESTORED,
        sameQuestionRuling: { anchor: "talk:ruled", decidedIso: "2026-10-03T09:00:00.000Z", words: "Ship it." },
        slug: "restored",
      },
      { askedIso: RESTORED, sameQuestionRuling: undefined, slug: "reworded" },
    ]);
  });

  // A restored ask whose doc left the board carries the owner's ruling off its journal alone.
  it("carries the ruling on a detached ask asked again in the same words", () => {
    const { handoverDir, home, runsDir } = freshHome();
    const RESTORED = "2026-10-04T10:00:00.000Z";
    for (const event of [
      { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: ASKED, kind: "question", question: "Ship it?" },
      { anchor: "talk:ruled", atIso: "2026-10-03T09:00:00.000Z", kind: "ruling", ruling: "Ship it." },
      { answer: "Ship it.", atIso: "2026-10-03T10:00:00.000Z", kind: "answered" },
      { atIso: RESTORED, kind: "question", question: "Ship it?" },
    ] satisfies RunEvent[]) {
      unwrap(appendRunEvent({ event, runsDir, slug: "restored-gone" }));
    }

    const { asks } = currencyBoardOf({ docs: [], handoverDir, home, unreadable: [] });

    expect(asks.map(({ askedIso, sameQuestionRuling, slug }) => ({ askedIso, sameQuestionRuling, slug }))).toEqual([
      {
        askedIso: RESTORED,
        sameQuestionRuling: { anchor: "talk:ruled", decidedIso: "2026-10-03T09:00:00.000Z", words: "Ship it." },
        slug: "restored-gone",
      },
    ]);
  });

  it("draws no ask from a doc or a run journal that will not read, the way the Queue draws no card from them", () => {
    const { handoverDir, home, runsDir } = freshHome();
    writeFileSync(join(handoverDir, "broken.md"), "---\nslug: [\n---\n");
    writeFileSync(runJournalPath({ runsDir, slug: "doc-gone" }), "{not json\n");

    const { asks, models } = currencyBoardOf({ docs: [], handoverDir, home, unreadable: ["broken.md"] });

    expect(asks).toEqual([]);
    expect(models).toEqual([]);
  });
});

describe("askStillRealIsoOf", () => {
  const EARLY = "2026-10-03T09:00:00.000Z";
  const LATE = "2026-10-04T09:00:00.000Z";

  const docWith = ({ stillRealIso }: { stillRealIso: string | undefined }): HandoverDoc => {
    const { handoverDir } = freshHome();
    const stamp = stillRealIso === undefined ? "" : `stillReal: "re-read"\nstillRealIso: ${stillRealIso}\n`;
    writeFileSync(join(handoverDir, "row.md"), `---\nslug: row\nstatus: ready\n${stamp}---\n`);
    return unwrap(scanBoard({ handoverDir })).docs[0]!;
  };

  const waitingRun = ({ reconfirmedIso }: { reconfirmedIso: string | undefined }): BoardModel["run"] => ({
    action: undefined,
    actionUnreadable: false,
    askedIso: ASKED,
    kind: "waiting-on-owner",
    question: "Ship it?",
    ...(reconfirmedIso === undefined
      ? {}
      : { reconfirmed: { atIso: reconfirmedIso, stillReal: "thread still silent" } }),
    shape: undefined,
    shapeIso: undefined,
  });

  it("never confirms a run's open question off a check, doc or run, made before the run asked it", () => {
    const BEFORE_ASKED = "2026-10-02T09:00:00.000Z";

    expect([
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: undefined }), run: waitingRun({ reconfirmedIso: BEFORE_ASKED }) },
      }),
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: BEFORE_ASKED }), run: waitingRun({ reconfirmedIso: undefined }) },
      }),
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: BEFORE_ASKED }), run: waitingRun({ reconfirmedIso: EARLY }) },
      }),
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: ASKED }), run: waitingRun({ reconfirmedIso: undefined }) },
      }),
    ]).toEqual([undefined, undefined, EARLY, ASKED]);
  });

  it("takes the doc's alone, the run's alone, the later of both either way, and nothing from neither", () => {
    const neverStarted: BoardModel["run"] = { kind: "never-started" };

    expect([
      askStillRealIsoOf({ model: { doc: docWith({ stillRealIso: EARLY }), run: neverStarted } }),
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: undefined }), run: waitingRun({ reconfirmedIso: EARLY }) },
      }),
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: EARLY }), run: waitingRun({ reconfirmedIso: LATE }) },
      }),
      askStillRealIsoOf({
        model: { doc: docWith({ stillRealIso: LATE }), run: waitingRun({ reconfirmedIso: EARLY }) },
      }),
      askStillRealIsoOf({ model: { doc: docWith({ stillRealIso: undefined }), run: neverStarted } }),
    ]).toEqual([EARLY, EARLY, LATE, LATE, undefined]);
  });
});
