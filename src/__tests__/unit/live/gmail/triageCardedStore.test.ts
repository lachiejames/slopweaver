import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { readCardedKeys } from "../../../../live/gmail/triageCardedStore.js";
import { pinTriageCard } from "../../../../live/gmail/triageCards.js";
import { stateHomePaths } from "../../../../stateHome.js";

const KEY = "from:alerts@example.test";
const OTHER = "from:other@example.test";
const CARD = "inbox-triage-20261028-from-alerts-example-test";
const OPEN_ASK = "inbox-triage-20261027-from-alerts-example-test";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "triage-carded-"));
  mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
  mkdirSync(stateHomePaths({ home }).runs, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Pin `slug` over `key`, through the real pin store. */
function pin({ slug, key = KEY }: { slug: string; key?: string }): void {
  unwrap(
    pinTriageCard({
      card: { ids: ["m-1"], key, pinnedAtIso: "2026-10-28T08:00:00.000Z", schemaVersion: 1, slug },
      home,
    }),
  );
}

/** A plain board row declaring `slug` and `status`. */
function plainRow({ slug, status }: { slug: string; status: string }): void {
  writeFileSync(
    join(stateHomePaths({ home }).handovers, `${slug}.md`),
    `---\nslug: ${slug}\nstatus: ${status}\n---\n# row\n`,
  );
}

/** An ask row settled `filed` into `witness`. */
function filedAsk({ slug, status = "ready", witness }: { slug: string; status?: string; witness: string }): void {
  writeFileSync(
    join(stateHomePaths({ home }).handovers, `${slug}.md`),
    [
      "---",
      `slug: ${slug}`,
      "kind: ask",
      'summary: "Inbox: 2 from Alerts"',
      `status: ${status}`,
      "askedIso: 2026-10-28T08:00:00.000Z",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      "settlement: filed",
      `settlementWitness: ${witness}`,
      "---",
      "# row",
      "",
    ].join("\n"),
  );
}

/** What the scan says of one key: the card slug it is carded by, or why not. */
function verdict({ keys = new Set([KEY]) }: { keys?: ReadonlySet<string> } = {}): readonly string[] {
  const read = readCardedKeys({ home, keys });
  return [...read.standingsByKey.values()].map(
    (standing) => `${standing.key} ${standing.reason} ${standing.slug} ${String(standing.filedInto)}`,
  );
}

describe("readCardedKeys — which of the reading's keys an open card already stands for", () => {
  it("reads a card filed into a still-open ask as carded (the regression)", () => {
    pin({ slug: CARD });
    filedAsk({ slug: CARD, witness: OPEN_ASK });
    plainRow({ slug: OPEN_ASK, status: "ready" });
    expect(verdict()).toEqual([`${KEY} filed-open ${CARD} ${OPEN_ASK}`]);
  });

  it("reads it as not carded once the row it was filed into is done", () => {
    pin({ slug: CARD });
    filedAsk({ slug: CARD, witness: OPEN_ASK });
    plainRow({ slug: OPEN_ASK, status: "done" });
    expect(verdict()).toEqual([`${KEY} terminal ${CARD} ${OPEN_ASK}`]);
  });

  it("keeps a carded pin over an older closed one for the same key", () => {
    pin({ slug: "inbox-triage-20261001-from-alerts-example-test" });
    plainRow({ slug: "inbox-triage-20261001-from-alerts-example-test", status: "done" });
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "ready" });
    expect(verdict()).toEqual([`${KEY} open-row ${CARD} null`]);
  });

  it("reads no board row for a key the current reading does not hold", () => {
    pin({ key: OTHER, slug: "inbox-triage-20261028-from-other-example-test" });
    plainRow({ slug: "inbox-triage-20261028-from-other-example-test", status: "ready" });
    expect(verdict()).toEqual([]);
  });

  it("is empty, with nothing to report, when no pin was ever written", () => {
    expect(readCardedKeys({ home, keys: new Set([KEY]) })).toEqual({ diagnostics: [], standingsByKey: new Map() });
  });

  it("names a malformed pin, and an unregistered card's key is not carded", () => {
    pin({ slug: CARD });
    const directory = stateHomePaths({ home }).live.gmail.triageCards;
    writeFileSync(join(directory, "inbox-triage-20261029-broken.json"), "not json");
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.diagnostics).toEqual([
      "pin inbox-triage-20261029-broken.json did not read (the pin for card inbox-triage-20261029-broken is not a pin — " +
        "act on nothing, and card the group again), so it cards nothing as already carded",
      `${KEY}: no doc carries the board row ${CARD}, live or archived — carded again, never skipped on unread state`,
    ]);
    expect(read.standingsByKey.get(KEY)!.reason).toBe("missing");
  });

  it("names a pin path that is a dangling link or a directory, never dropping it unseen", () => {
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "ready" });
    const directory = stateHomePaths({ home }).live.gmail.triageCards;
    symlinkSync(join(home, "nowhere.json"), join(directory, "inbox-triage-20261029-dangling.json"));
    mkdirSync(join(directory, "inbox-triage-20261030-a-directory.json"));
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.diagnostics.map((line) => line.split(" did not read ")[0])).toEqual([
      "pin inbox-triage-20261029-dangling.json",
      "pin inbox-triage-20261030-a-directory.json",
    ]);
    expect(read.standingsByKey.get(KEY)!.reason).toBe("open-row");
  });

  it("names a pin entry that links to a valid pin, never carding through the link", () => {
    plainRow({ slug: CARD, status: "ready" });
    pin({ slug: CARD });
    const directory = stateHomePaths({ home }).live.gmail.triageCards;
    renameSync(join(directory, `${CARD}.json`), join(home, "elsewhere.json"));
    symlinkSync(join(home, "elsewhere.json"), join(directory, `${CARD}.json`));
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.size).toBe(0);
    expect(read.diagnostics).toEqual([
      `pin ${CARD}.json did not read (it is not a regular file), so it cards nothing as already carded`,
    ]);
  });

  it("names an entry called exactly .json by its file name, never as a blank", () => {
    mkdirSync(join(stateHomePaths({ home }).live.gmail.triageCards, ".json"), { recursive: true });
    expect(readCardedKeys({ home, keys: new Set([KEY]) }).diagnostics).toEqual([
      "pin .json did not read (it is not a regular file), so it cards nothing as already carded",
    ]);
  });

  it("names a FIFO pin entry without reading it, so the scan never blocks on one", () => {
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "ready" });
    execFileSync("mkfifo", [join(stateHomePaths({ home }).live.gmail.triageCards, "inbox-triage-20261031-fifo.json")]);
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.diagnostics).toEqual([
      "pin inbox-triage-20261031-fifo.json did not read (it is not a regular file), so it cards nothing as already carded",
    ]);
    expect(read.standingsByKey.get(KEY)!.reason).toBe("open-row");
  });

  it("names an unreadable card row, and never reads its key as carded", () => {
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "ready" });
    writeFileSync(join(stateHomePaths({ home }).runs, `${CARD}.jsonl`), "not a journal line\n");
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.carded).toBe(false);
    expect(read.diagnostics).toEqual([
      `${KEY}: the board row ${CARD} did not read whole — 1 run-journal line(s) did not decode — carded again, ` +
        "never skipped on unread state",
    ]);
  });

  it("names a card row whose status is not one the board knows, and never reads its key as carded", () => {
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "bogus" });
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.carded).toBe(false);
    expect(read.diagnostics).toEqual([
      `${KEY}: card ${CARD} declares a status the board could not read (unknown), so nothing proves it open — ` +
        "carded again, never skipped on unread state",
    ]);
  });

  it("names a filed card row whose own status is not one the board knows, never carding it through its witness", () => {
    pin({ slug: CARD });
    filedAsk({ slug: CARD, status: "bogus", witness: OPEN_ASK });
    plainRow({ slug: OPEN_ASK, status: "ready" });
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.carded).toBe(false);
    expect(read.diagnostics).toEqual([
      `${KEY}: card ${CARD} declares a status the board could not read (unknown), so nothing proves it open — ` +
        "carded again, never skipped on unread state",
    ]);
  });

  it("reads a card whose only doc is archived as not carded — off the board, it stands for nothing open", () => {
    pin({ slug: CARD });
    mkdirSync(join(stateHomePaths({ home }).handovers, "archive"), { recursive: true });
    writeFileSync(
      join(stateHomePaths({ home }).handovers, "archive", `${CARD}.md`),
      `---\nslug: ${CARD}\nstatus: ready\n---\n# row\n`,
    );
    expect(verdict()).toEqual([`${KEY} terminal ${CARD} null`]);
  });

  it("names a card row whose run journal is a dangling link, never reading it as an open row", () => {
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "ready" });
    symlinkSync(join(home, "nowhere.jsonl"), join(stateHomePaths({ home }).runs, `${CARD}.jsonl`));
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.carded).toBe(false);
    expect(read.diagnostics.length).toBe(1);
    expect(read.diagnostics[0]).toContain("is a link to nothing");
  });

  it("names a card row that is a dangling link, which the doc reader sees as absent", () => {
    pin({ slug: CARD });
    symlinkSync(join(home, "nowhere.md"), join(stateHomePaths({ home }).handovers, `${CARD}.md`));
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.carded).toBe(false);
    expect(read.diagnostics).toEqual([
      `${KEY}: no doc carries the board row ${CARD}, live or archived — carded again, never skipped on unread state`,
    ]);
  });

  it("names a card row whose settlement is not one the board knows, never reading it as an open row", () => {
    pin({ slug: CARD });
    writeFileSync(
      join(stateHomePaths({ home }).handovers, `${CARD}.md`),
      `---\nslug: ${CARD}\nstatus: ready\nsettlement: typo\n---\n# row\n`,
    );
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.carded).toBe(false);
    expect(read.diagnostics).toEqual([
      `${KEY}: the board row ${CARD} did not read whole — ` +
        `${join(stateHomePaths({ home }).handovers, `${CARD}.md`)}: its front-matter has 1 problem(s): ` +
        'settlement: "typo" is not a settlement — use filed, answered, declined, or remove it — ' +
        "carded again, never skipped on unread state",
    ]);
  });

  it("names EVERY unreadable card row for one key, not only the one the fold kept", () => {
    const second = "inbox-triage-20261029-from-alerts-example-test";
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "bogus" });
    pin({ slug: second });
    plainRow({ slug: second, status: "bogus" });
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.diagnostics.map((line) => line.split(" declares ")[0])).toEqual([
      `${KEY}: card ${CARD}`,
      `${KEY}: card ${second}`,
    ]);
  });

  it("names an unreadable pin beside an open one, and says the group is still carded", () => {
    const open = "inbox-triage-20261029-from-alerts-example-test";
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "bogus" });
    pin({ slug: open });
    plainRow({ slug: open, status: "ready" });
    const read = readCardedKeys({ home, keys: new Set([KEY]) });
    expect(read.standingsByKey.get(KEY)!.slug).toBe(open);
    expect(read.diagnostics).toEqual([
      `${KEY}: card ${CARD} declares a status the board could not read (unknown), so nothing proves it open — ` +
        `still carded by ${open}`,
    ]);
  });

  it("names a pin directory that will not list, and reads nothing as carded", () => {
    pin({ slug: CARD });
    plainRow({ slug: CARD, status: "ready" });
    const directory = stateHomePaths({ home }).live.gmail.triageCards;
    chmodSync(directory, 0o000);
    try {
      const read = readCardedKeys({ home, keys: new Set([KEY]) });
      expect(read.standingsByKey.size).toBe(0);
      expect(read.diagnostics.length).toBe(1);
      expect(read.diagnostics[0]).toContain("the triage card pins did not list");
    } finally {
      chmodSync(directory, 0o700);
    }
  });
});
