/**
 * The Notion page ledger — the at-most-once primitive under `create` and the ownership authority under
 * `update`.
 *
 * The cases that matter are the fail-closed ones. Notion assigns the page id, so a create whose response is
 * lost leaves a page nothing local can name; every "is this ours?" answer here therefore has to be wrong in
 * the direction of refusing, because the alternative is replacing a page's whole content on a guess.
 *
 * Real filesystem, in a temp dir. No mocks.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adoptPage,
  confirmPage,
  confirmPageMove,
  confirmPageUpdate,
  intentDigest,
  isValidPageId,
  readExternalEditOverrides,
  readIntentRecord,
  readPageRecord,
  recordExternalEditOverride,
  reserveIntent,
} from "../../../../outbound/notion/pageLedger.js";
import { pageOwnershipOf } from "../../../../outbound/notion/pageOwnership.js";
import { stateHomePaths } from "../../../../stateHome.js";

const PAGE = "00000000-0000-0000-0000-00000000a003";
const URL = "https://app.notion.com/p/x-0000000000000000000000000000a003";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-notion-ledger-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("isValidPageId", () => {
  it("accepts a canonical dashed UUID", () => {
    expect(isValidPageId({ id: PAGE })).toBe(true);
  });

  it("rejects a traversal attempt, which would reach a ledger filename", () => {
    expect(isValidPageId({ id: "../../etc/passwd" })).toBe(false);
  });

  it("rejects an undashed 32-hex id, because that is not what the resolver produces", () => {
    expect(isValidPageId({ id: "0000000000000000000000000000a003" })).toBe(false);
  });
});

describe("intentDigest", () => {
  it("is stable for the same parent, title and body", () => {
    const one = intentDigest({ body: "b", parentPageId: "p", title: "t" });
    expect(intentDigest({ body: "b", parentPageId: "p", title: "t" })).toBe(one);
  });

  it("separates the same body under a different parent, so a legitimate second page is not refused", () => {
    expect(intentDigest({ body: "b", parentPageId: "p", title: "t" })).not.toBe(
      intentDigest({ body: "b", parentPageId: "q", title: "t" }),
    );
  });

  it("separates a changed title", () => {
    expect(intentDigest({ body: "b", parentPageId: "p", title: "t" })).not.toBe(
      intentDigest({ body: "b", parentPageId: "p", title: "u" }),
    );
  });
});

describe("reserveIntent", () => {
  it("is fresh once and taken thereafter", () => {
    const dir = home();
    expect(reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" })).toEqual({
      kind: "fresh",
      reservedIso: "2026-08-22T00:00:00.000Z",
    });
    const second = reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:01:00.000Z" });
    expect(second.kind).toBe("taken");
  });

  it("reports the ORIGINAL reservation time when taken, not the retry's", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    const second = reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T09:00:00.000Z" });
    expect(second.kind === "taken" ? second.record.reservedIso : "").toBe("2026-08-22T00:00:00.000Z");
  });

  it("counts an unparseable slot as TAKEN, never as free", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    writeFileSync(join(stateHomePaths({ home: dir }).ledgers, "notion-pages", "intents", "abc.json"), "{ not json");
    expect(reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T01:00:00.000Z" }).kind).toBe("taken");
  });
});

describe("confirmPage", () => {
  it("writes BOTH indexes, so ownership and at-most-once are each answerable without a scan", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    confirmPage({
      images: [],
      canonical: "hash1",
      home: dir,
      intent: "abc",
      nowIso: "2026-08-22T00:00:05.000Z",
      pageId: PAGE,
      url: URL,
    });
    expect(readIntentRecord({ home: dir, intent: "abc" })!.pageId).toBe(PAGE);
    expect(readPageRecord({ home: dir, pageId: PAGE })!.url).toBe(URL);
  });

  it("keeps the original reservation time and records the canonical digest", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    confirmPage({
      images: [],
      canonical: "hash1",
      home: dir,
      intent: "abc",
      nowIso: "2026-08-22T00:00:05.000Z",
      pageId: PAGE,
      url: URL,
    });
    const record = readPageRecord({ home: dir, pageId: PAGE })!;
    expect(record.reservedIso).toBe("2026-08-22T00:00:00.000Z");
    expect(record.lastCanonicalHash).toBe("hash1");
  });
});

describe("confirmPageUpdate", () => {
  it("moves the canonical digest forward on both indexes", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    confirmPage({
      images: [],
      canonical: "hash1",
      home: dir,
      intent: "abc",
      nowIso: "2026-08-22T00:00:05.000Z",
      pageId: PAGE,
      url: URL,
    });
    confirmPageUpdate({ images: [], canonical: "hash2", home: dir, nowIso: "2026-08-22T01:00:00.000Z", pageId: PAGE });
    expect(readPageRecord({ home: dir, pageId: PAGE })!.lastCanonicalHash).toBe("hash2");
    expect(readIntentRecord({ home: dir, intent: "abc" })!.lastCanonicalHash).toBe("hash2");
  });

  it("does nothing for a page it has no record of, rather than inventing ownership", () => {
    const dir = home();
    confirmPageUpdate({ images: [], canonical: "hash2", home: dir, nowIso: "2026-08-22T01:00:00.000Z", pageId: PAGE });
    expect(readPageRecord({ home: dir, pageId: PAGE })).toBe(undefined);
  });
});

describe("pageOwnershipOf", () => {
  it("refuses a page with no record, naming what an update would destroy", () => {
    const owned = pageOwnershipOf({ home: home(), pageId: PAGE });
    expect(owned.owned).toBe(false);
    expect(owned.owned ? "" : owned.reason).toContain("no record of creating page");
  });

  it("refuses a reserved-but-unconfirmed page, because whether it exists is unknown", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    // The intent index holds it, but nothing ever wrote a page index entry, which is the lost-response state.
    const owned = pageOwnershipOf({ home: dir, pageId: PAGE });
    expect(owned.owned).toBe(false);
  });

  it("grants a confirmed page", () => {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    confirmPage({
      images: [],
      canonical: "hash1",
      home: dir,
      intent: "abc",
      nowIso: "2026-08-22T00:00:05.000Z",
      pageId: PAGE,
      url: URL,
    });
    const owned = pageOwnershipOf({ home: dir, pageId: PAGE });
    expect(owned.owned).toBe(true);
    expect(owned.owned ? owned.record.lastCanonicalHash : "").toBe("hash1");
  });
});

describe("adoptPage", () => {
  it("records ownership for a page the ledger never created", () => {
    const dir = home();
    adoptPage({ canonical: "hash9", home: dir, nowIso: "2026-08-22T02:00:00.000Z", pageId: PAGE, url: URL });
    const owned = pageOwnershipOf({ home: dir, pageId: PAGE });
    expect(owned.owned).toBe(true);
    expect(owned.owned ? owned.record.lastCanonicalHash : "").toBe("hash9");
  });

  it("marks the record as adopted rather than borrowing a create intent it never made", () => {
    const dir = home();
    adoptPage({ canonical: "hash9", home: dir, nowIso: "2026-08-22T02:00:00.000Z", pageId: PAGE, url: URL });
    expect(readPageRecord({ home: dir, pageId: PAGE })!.intent).toBe(`adopted:${PAGE}`);
  });

  it("refuses to write a record for a malformed id, which would escape the state home", () => {
    const dir = home();
    adoptPage({ canonical: "h", home: dir, nowIso: "2026-08-22T02:00:00.000Z", pageId: "../../x", url: URL });
    expect(readPageRecord({ home: dir, pageId: "../../x" })).toBe(undefined);
  });
});

describe("recordExternalEditOverride / readExternalEditOverrides", () => {
  it("reads nothing back for a home that never journaled an override", () => {
    expect(readExternalEditOverrides({ home: home() })).toEqual([]);
  });

  it("round-trips exactly what was journaled", () => {
    const dir = home();
    recordExternalEditOverride({
      home: dir,
      override: {
        canonicalHash: "hash1",
        lastEditedBy: "a-human-user-id",
        lastEditedTime: "2026-08-30T21:00:00.000Z",
        nowIso: "2026-08-30T21:05:00.000Z",
        pageId: PAGE,
        reason: "syncing gold on their behalf",
      },
    });
    expect(readExternalEditOverrides({ home: dir })).toEqual([
      {
        canonicalHash: "hash1",
        lastEditedBy: "a-human-user-id",
        lastEditedTime: "2026-08-30T21:00:00.000Z",
        nowIso: "2026-08-30T21:05:00.000Z",
        pageId: PAGE,
        reason: "syncing gold on their behalf",
      },
    ]);
  });

  it("appends rather than replacing, so a second override never erases the first's evidence", () => {
    const dir = home();
    recordExternalEditOverride({
      home: dir,
      override: {
        canonicalHash: "hash1",
        lastEditedBy: "a-human-user-id",
        lastEditedTime: "2026-08-30T21:00:00.000Z",
        nowIso: "2026-08-30T21:05:00.000Z",
        pageId: PAGE,
        reason: "first override",
      },
    });
    recordExternalEditOverride({
      home: dir,
      override: {
        canonicalHash: "hash2",
        lastEditedBy: "another-human-user-id",
        lastEditedTime: "2026-08-30T22:00:00.000Z",
        nowIso: "2026-08-30T22:05:00.000Z",
        pageId: PAGE,
        reason: "second override",
      },
    });
    const overrides = readExternalEditOverrides({ home: dir });
    expect(overrides.map((o) => o.reason)).toEqual(["first override", "second override"]);
  });
});

describe("confirmPageMove", () => {
  const DESTINATION = "3a100000-0000-81aa-b0c2-7f1b0d4a9911";

  /** A confirmed page, so a move has a record to amend. */
  function seeded(): string {
    const dir = home();
    reserveIntent({ home: dir, intent: "abc", nowIso: "2026-08-22T00:00:00.000Z" });
    confirmPage({
      canonical: "hash1",
      home: dir,
      images: [],
      intent: "abc",
      nowIso: "2026-08-22T00:00:05.000Z",
      pageId: PAGE,
      url: URL,
    });
    return dir;
  }

  it("records the new parent and when, on both indexes", () => {
    const dir = seeded();
    confirmPageMove({
      home: dir,
      nowIso: "2026-08-22T01:00:00.000Z",
      pageId: PAGE,
      parentPageId: DESTINATION,
    });
    expect(readPageRecord({ home: dir, pageId: PAGE })!.lastParentId).toBe(DESTINATION);
    expect(readPageRecord({ home: dir, pageId: PAGE })!.movedIso).toBe("2026-08-22T01:00:00.000Z");
    expect(readIntentRecord({ home: dir, intent: "abc" })!.lastParentId).toBe(DESTINATION);
  });

  it("leaves the content digest exactly as it was, because a move reads and sends no content", () => {
    const dir = seeded();
    confirmPageMove({ home: dir, nowIso: "2026-08-22T01:00:00.000Z", pageId: PAGE, parentPageId: DESTINATION });
    expect(readPageRecord({ home: dir, pageId: PAGE })!.lastCanonicalHash).toBe("hash1");
  });

  it("writes nothing for a page the ledger does not hold", () => {
    const dir = home();
    confirmPageMove({ home: dir, nowIso: "2026-08-22T01:00:00.000Z", pageId: PAGE, parentPageId: DESTINATION });
    expect(readPageRecord({ home: dir, pageId: PAGE })).toBe(undefined);
  });
});

describe("pageOwnershipOf — purpose", () => {
  it("names a rewrite by default, which is what the two existing callers do", () => {
    const owned = pageOwnershipOf({ home: home(), pageId: PAGE });
    expect(owned.owned).toBe(false);
    expect(owned.owned ? "" : owned.reason).toContain("An update REPLACES the page body");
  });

  it("names a MOVE when that is what is being gated, so the refusal is not about the wrong act", () => {
    const owned = pageOwnershipOf({ home: home(), pageId: PAGE, purpose: "move" });
    expect(owned.owned).toBe(false);
    expect(owned.owned ? "" : owned.reason).toContain("it will not move it");
    expect(owned.owned ? "" : owned.reason).toContain("whose permissions it inherits");
  });
});
