/**
 * The chair hand-off episode as a pure fold: what each journal prefix says to do next, which note the episode will
 * take, the address scrub, and the strict decode the store reads it through.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type ChairHandOffEvent,
  type ChairHandOffStarted,
  episodeIsOpen,
  nextStep,
  noteRefusal,
} from "../../../supervisor/chairHandOff.js";
import { recordChairHandOffNote } from "../../../supervisor/chairHandOffNote.js";
import {
  appendEpisodeEvent,
  decodeEpisodeJournal,
  episodeJournalPath,
  findOpenEpisode,
} from "../../../supervisor/chairHandOffStore.js";
import { withoutAddresses } from "../../../supervisor/chairWatch.js";

const AT = "2026-11-27T08:00:00.000Z";

const STARTED: ChairHandOffStarted = {
  alias: "plan-two",
  atIso: AT,
  basis: { kind: "auto" },
  episodeId: "chair-hand-off:old",
  kind: "started",
  noteWaitSeconds: 600,
  predecessor: "old",
  predecessorSlug: "fresh-supervisor-handoff-9007",
  reasons: ["plan-one Fable week 97%"],
  vendor: "claude",
};

const ASKED: ChairHandOffEvent = {
  atIso: AT,
  deadlineIso: "2026-11-27T08:10:00.000Z",
  kind: "note-asked",
  notePath: "/n",
};
const ARRIVED: ChairHandOffEvent = { atIso: AT, kind: "note-arrived", note: "n" };
const MISSING: ChairHandOffEvent = { atIso: AT, kind: "note-missing", why: "deadline" };
const CLOSED: ChairHandOffEvent = {
  alreadyClosed: false,
  atIso: AT,
  kind: "row-closed",
  slug: "fresh-supervisor-handoff-9007",
};
const RESERVED: ChairHandOffEvent = { atIso: AT, kind: "slug-reserved", slug: "fresh-supervisor-handoff-9008" };
const WRITTEN: ChairHandOffEvent = {
  atIso: AT,
  kind: "doc-written",
  path: "/d",
  slug: "fresh-supervisor-handoff-9008",
};
const OPENING: ChairHandOffEvent = { atIso: AT, kind: "successor-opening", slug: "fresh-supervisor-handoff-9008" };

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("nextStep", () => {
  it("walks the journal's order one step at a time", () => {
    const order = [STARTED, ASKED, ARRIVED, CLOSED, RESERVED, WRITTEN, OPENING];
    const steps = order.map((_, index) => nextStep({ events: order.slice(0, index) }).kind);
    expect(steps).toEqual([
      "start",
      "ask-note",
      "await-note",
      "close-row",
      "reserve-slug",
      "write-doc",
      "open-successor",
    ]);
    expect(nextStep({ events: order }).kind).toBe("reconcile");
  });

  it("reconciles, never re-opens, after a resumable spawn failure", () => {
    const events = [STARTED, ASKED, MISSING, CLOSED, RESERVED, WRITTEN, OPENING];
    const failed: ChairHandOffEvent = { atIso: AT, kind: "failed", resumable: true, why: "spawn exited 1" };
    expect(nextStep({ events: [...events, failed] }).kind).toBe("reconcile");
  });

  it("is done once a successor opened, and abandoned on an unresumable failure", () => {
    const opened: ChairHandOffEvent = {
      atIso: AT,
      kind: "successor-opened",
      sessionId: "new",
      slug: "fresh-supervisor-handoff-9008",
    };
    expect(nextStep({ events: [STARTED, ASKED, ARRIVED, CLOSED, RESERVED, WRITTEN, OPENING, opened] })).toEqual({
      kind: "done",
      sessionId: "new",
      slug: "fresh-supervisor-handoff-9008",
    });
    const failed: ChairHandOffEvent = { atIso: AT, kind: "failed", resumable: false, why: "the pin moved" };
    expect(nextStep({ events: [STARTED, ASKED, ARRIVED, failed] })).toEqual({
      kind: "abandoned",
      why: "the pin moved",
    });
    expect(episodeIsOpen({ events: [STARTED, ASKED, ARRIVED, failed] })).toBe(false);
  });

  it("takes the FIRST note outcome: a note racing the deadline cannot change it", () => {
    const state = nextStep({ events: [STARTED, ASKED, MISSING, ARRIVED] });
    expect(state.kind).toBe("close-row");
    expect(noteRefusal({ episodeId: "chair-hand-off:old", events: [STARTED, ASKED, MISSING] })).toBe(
      "chair-hand-off:old stopped waiting for a note at its deadline and the successor rebuilds from files; this note is too late",
    );
  });

  it("re-reserves past a slug another writer took, the latest reservation winning", () => {
    const again: ChairHandOffEvent = { atIso: AT, kind: "slug-reserved", slug: "fresh-supervisor-handoff-9009" };
    expect(nextStep({ events: [STARTED, ASKED, ARRIVED, CLOSED, RESERVED, again] })).toEqual({
      kind: "write-doc",
      slug: "fresh-supervisor-handoff-9009",
      started: STARTED,
    });
  });
});

describe("noteRefusal", () => {
  it("takes a note only while the episode waits on one", () => {
    expect(noteRefusal({ episodeId: "e", events: [STARTED, ASKED] })).toBe(undefined);
    expect(noteRefusal({ episodeId: "e", events: [] })).toBe(
      "no chair hand-off e is journalled, so there is nothing to attach a note to",
    );
    expect(noteRefusal({ episodeId: "e", events: [STARTED] })).toBe("e has not asked for a note yet");
    expect(noteRefusal({ episodeId: "e", events: [STARTED, ASKED, ARRIVED] })).toBe(
      "e already has its note; a second one would not reach the successor",
    );
  });
});

describe("withoutAddresses", () => {
  it("replaces every address and leaves the rest", () => {
    expect(withoutAddresses({ text: "plan-one (seat-1@example.test) and a@b.co, 97%" })).toBe(
      "plan-one (<account>) and <account>, 97%",
    );
    expect(withoutAddresses({ text: "plan-one week 97%" })).toBe("plan-one week 97%");
  });
});

describe("the journal on disk", () => {
  it("refuses a malformed line by number rather than skipping it", () => {
    const text = `${JSON.stringify(STARTED)}\n{"kind":"note-asked"}\n`;
    const failure = unwrapErr(decodeEpisodeJournal({ path: "/j.jsonl", text }));
    expect(failure.code).toBe("JOURNAL_MALFORMED");
    expect(failure.message).toContain("/j.jsonl line 2 is not a chair hand-off event");
  });

  it("finds an open episode for a chair, and none for a chair never handed off", () => {
    const home = mkdtempSync(join(tmpdir(), "ho-store-"));
    scratch.push(home);
    expect(unwrap(findOpenEpisode({ home, predecessor: "old" }))).toBe(undefined);
    for (const event of [STARTED, ASKED]) {
      unwrap(appendEpisodeEvent({ episodeId: "chair-hand-off:old", event, home }));
    }
    expect(episodeJournalPath({ episodeId: "chair-hand-off:old", home })).toBe(
      join(home, "supervisor", "hand-offs", "chair-hand-off-old.jsonl"),
    );
    expect(unwrap(findOpenEpisode({ home, predecessor: "old" }))).toEqual({
      episodeId: "chair-hand-off:old",
      events: [STARTED, ASKED],
    });
  });

  it("refuses to append through a link at the journal's own name, leaving the linked file untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "ho-link-"));
    scratch.push(home);
    const target = join(home, "elsewhere.jsonl");
    writeFileSync(target, "kept\n");
    const path = episodeJournalPath({ episodeId: "chair-hand-off:old", home });
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path);

    const appended = appendEpisodeEvent({ episodeId: "chair-hand-off:old", event: STARTED, home });

    expect(unwrapErr(appended).code).toBe("HAND_OFF_IO");
    expect(readFileSync(target, "utf8")).toBe("kept\n");
  });

  it("an empty note file is refused before the journal is read", () => {
    const home = mkdtempSync(join(tmpdir(), "ho-note-"));
    scratch.push(home);
    const file = join(home, "note.md");
    writeFileSync(file, "  \n");
    const empty = unwrapErr(recordChairHandOffNote({ episodeId: "chair-hand-off:old", file, home, nowIso: AT }));
    expect(empty.message).toBe(`${file} is empty, so there is no note to record`);
  });
});
