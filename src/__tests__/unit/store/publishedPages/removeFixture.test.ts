/**
 * The fixture remover's refusals that open nothing, and its verdict over the rows a slug holds: exactly one
 * fixture page, addressed under the walk's home and frozen at its own instant, is removable, and anything else under
 * the slug — another body, version, file, home or freeze instant, a history with no page — leaves it whole.
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { removePublishedPageFixture } from "../../../../store/publishedPages/removeFixture.js";
import { PublishedPageFixtureRemovalErrors } from "../../../../store/publishedPages/removeFixtureErrors.js";
import {
  type FixturePin,
  type FixtureRows,
  fixtureRemovalVerdict,
  PINNED_COLUMNS,
} from "../../../../store/publishedPages/removeFixtureVerdict.js";
import {
  publishedPageFileTable,
  publishedPageTable,
  publishedPageVersionTable,
} from "../../../../store/schema/publishedPages.js";

const SLUG = "desktop-e2e-w1";
const FIXTURE_SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const FROZEN_AT = "2026-11-09T12:00:00.000Z";
const LATER_AT = "2026-11-09T12:00:05.000Z";
const ADDRESS = "file:///acme/home/pages/desktop-e2e-w1/index.html";
const PIN: FixturePin = { bodySha256: FIXTURE_SHA, canonicalAddress: ADDRESS, frozenAtIso: FROZEN_AT };

/** The page row one published fixture leaves, with `over` replacing any of its fields. */
function pageOf(over: Partial<NonNullable<FixtureRows["page"]>> = {}): NonNullable<FixtureRows["page"]> {
  return {
    canonicalAddress: ADDRESS,
    currentBodySha256: FIXTURE_SHA,
    kind: "local",
    latestFrozenAt: new Date(FROZEN_AT),
    latestFrozenBodySha256: FIXTURE_SHA,
    publishedAt: new Date(FROZEN_AT),
    ...over,
  };
}

/** The rows one published fixture leaves, with `over` replacing any of them. */
function rowsOf(over: Partial<FixtureRows> = {}): FixtureRows {
  return {
    aliases: [],
    files: [{ bodySha256: FIXTURE_SHA, relativePath: "index.html" }],
    page: pageOf(),
    versions: [{ bodySha256: FIXTURE_SHA, firstFrozenAt: new Date(FROZEN_AT), origin: "published" }],
    ...over,
  };
}

/** The verdict over `rows` for the walk that froze its fixture at `FROZEN_AT`. */
function verdictOf({ rows }: { rows: FixtureRows }): ReturnType<typeof fixtureRemovalVerdict> {
  return fixtureRemovalVerdict({ pin: PIN, rows, slug: SLUG });
}

/** The message the verdict refuses `rows` with. */
function refusalOf({ rows }: { rows: FixtureRows }): string {
  const refused = unwrapErr(verdictOf({ rows }));
  expect(refused.code).toBe("PAGES_FIXTURE_MISMATCH");
  return refused.message;
}

/** The whole refusal message for one failed check. */
function refusedBecause({ detail }: { detail: string }): string {
  return `refusing to remove ${SLUG}: ${detail}, so it is not exactly the walk's fixture and is left whole`;
}

describe("fixtureRemovalVerdict", () => {
  it("allows exactly one fixture page", () => {
    expect(unwrap(verdictOf({ rows: rowsOf() }))).toBe(undefined);
  });

  it("refuses an absent page as absent", () => {
    expect(unwrapErr(verdictOf({ rows: rowsOf({ page: undefined }) }))).toEqual(
      PublishedPageFixtureRemovalErrors.absent({ slug: SLUG }),
    );
  });

  it("refuses a page pointing anywhere but the fixture's body, or a history with no page", () => {
    const pages = [
      pageOf({ currentBodySha256: OTHER_SHA }),
      pageOf({ latestFrozenBodySha256: OTHER_SHA }),
      pageOf({ currentBodySha256: null, kind: "history-only" }),
    ];
    expect(pages.map((page) => refusalOf({ rows: rowsOf({ page }) }))).toEqual(
      Array(3).fill(refusedBecause({ detail: "its page row does not point at the fixture's body" })),
    );
  });

  it("refuses a history holding another version, or none", () => {
    const histories = [
      [
        { bodySha256: FIXTURE_SHA, firstFrozenAt: new Date(FROZEN_AT), origin: "published" },
        { bodySha256: OTHER_SHA, firstFrozenAt: new Date(FROZEN_AT), origin: "published" },
      ],
      [],
    ];
    expect(histories.map((versions) => refusalOf({ rows: rowsOf({ versions }) }))).toEqual(
      Array(2).fill(refusedBecause({ detail: "its history holds a version that is not the fixture's" })),
    );
  });

  it("refuses a page serving another file, another body or no document", () => {
    const fileSets = [
      [
        { bodySha256: FIXTURE_SHA, relativePath: "index.html" },
        { bodySha256: OTHER_SHA, relativePath: "chart.png" },
      ],
      [{ bodySha256: OTHER_SHA, relativePath: "index.html" }],
      [],
    ];
    expect(fileSets.map((files) => refusalOf({ rows: rowsOf({ files }) }))).toEqual(
      Array(3).fill(refusedBecause({ detail: "it serves a file other than the fixture's one document" })),
    );
  });
});

describe("fixtureRemovalVerdict over the freeze instant", () => {
  it("refuses the same bytes when a later publish froze the page, or its version was first frozen at another instant", () => {
    const moved = [
      rowsOf({ page: pageOf({ latestFrozenAt: new Date(LATER_AT) }) }),
      rowsOf({ page: pageOf({ latestFrozenAt: null }) }),
      rowsOf({ versions: [{ bodySha256: FIXTURE_SHA, firstFrozenAt: new Date(LATER_AT), origin: "published" }] }),
    ];
    expect(moved.map((rows) => refusalOf({ rows }))).toEqual(
      Array(3).fill(refusedBecause({ detail: "it was frozen at another instant than this walk's publish" })),
    );
  });
});

describe("fixtureRemovalVerdict over the page's publish instant", () => {
  it("refuses an otherwise exact fixture whose page another write re-dated", () => {
    const pages = [pageOf({ publishedAt: new Date(LATER_AT) }), pageOf({ publishedAt: null })];
    expect(pages.map((page) => refusalOf({ rows: rowsOf({ page }) }))).toEqual(
      Array(2).fill(refusedBecause({ detail: "it was published at another instant than this walk's publish" })),
    );
  });
});

describe("PINNED_COLUMNS", () => {
  it("names every column of the three tables a removal deletes from, so a new one is never left unread", () => {
    const tables = { file: publishedPageFileTable, page: publishedPageTable, version: publishedPageVersionTable };
    const columns = Object.fromEntries(
      Object.entries(tables).map(([name, table]) => [name, Object.keys(getTableColumns(table)).toSorted()]),
    );
    expect(columns).toEqual(PINNED_COLUMNS);
  });
});

describe("fixtureRemovalVerdict over a version's origin", () => {
  it("refuses an otherwise exact fixture whose version an import carried in", () => {
    const versions = [{ bodySha256: FIXTURE_SHA, firstFrozenAt: new Date(FROZEN_AT), origin: "imported" }];
    expect(refusalOf({ rows: rowsOf({ versions }) })).toBe(
      refusedBecause({ detail: "its history holds a version an import carried in, which no walk writes" }),
    );
  });
});

describe("fixtureRemovalVerdict over the page's address", () => {
  it("refuses the same bytes at the same instant when the page is addressed under another home", () => {
    const page = pageOf({ canonicalAddress: "file:///acme/other-home/pages/desktop-e2e-w1/index.html" });
    expect(refusalOf({ rows: rowsOf({ page }) })).toBe(
      refusedBecause({ detail: "it is addressed under another home than this walk's" }),
    );
  });
});

describe("fixtureRemovalVerdict over aliases", () => {
  it("refuses an otherwise exact fixture that another address resolves to, since no publish writes one", () => {
    expect(
      refusalOf({ rows: rowsOf({ aliases: [{ address: "file:///acme/pages/desktop-e2e-w1/index.html" }] }) }),
    ).toBe(refusedBecause({ detail: "another address resolves to it, which no publish writes" }));
  });
});

describe("removePublishedPageFixture", () => {
  it("refuses a slug no walk could have planned, a malformed digest and a malformed instant, before opening the store", async () => {
    // `/nonexistent` would fail to resolve a store; each refusal answering first proves nothing was opened.
    const home = "/nonexistent-home";
    const pinned = { expectedBodySha256: FIXTURE_SHA, expectedFrozenAtIso: FROZEN_AT, home };
    expect(unwrapErr(await removePublishedPageFixture({ ...pinned, slug: "standup-brief" }))).toEqual(
      PublishedPageFixtureRemovalErrors.slugRefused({ slug: "standup-brief" }),
    );
    expect(unwrapErr(await removePublishedPageFixture({ ...pinned, expectedBodySha256: "ABC", slug: SLUG }))).toEqual(
      PublishedPageFixtureRemovalErrors.digestMalformed({ slug: SLUG }),
    );
    expect(
      unwrapErr(await removePublishedPageFixture({ ...pinned, expectedFrozenAtIso: "yesterday", slug: SLUG })),
    ).toEqual(PublishedPageFixtureRemovalErrors.instantMalformed({ slug: SLUG }));
  });
});
