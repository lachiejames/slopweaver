/**
 * The two lookups measured breaking when pages moved off claude.ai, plus
 * the supersession and prose predicates that keep a local address a first-class subject.
 *
 * Every case here FAILED before the local-page work, silently and with no error anywhere — which is
 * why each one asserts the positive fact rather than merely that nothing threw.
 */
import { describe, expect, it } from "vitest";

import { artifactValidity, rankOpenArtifacts } from "../../../briefing/openArtifacts.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { artifactKey } from "../../../outbound/briefing/freezeStore.js";
import { foldLockInLedger, type LockInRow } from "../../../sessionStart/lockIn.js";
import { anchorsIn } from "../../../sessionStart/standing.js";

const NOW = "2026-09-13T12:00:00.000Z";
const PAGE_A = "file:///Users/x/.slopweaver/pages/alpha/index.html";
const PAGE_B = "file:///Users/x/.slopweaver/pages/beta/index.html";

/** One ledger row, with the fields every resolution carries and nothing a case does not set. */
function row(over: Partial<LockInRow> & Pick<LockInRow, "identity">): LockInRow {
  return {
    againstWhenIso: "2026-09-13T09:00:00.000Z",
    outcome: "approved-as-proposed",
    proposed: "the page's own ask",
    tsIso: "2026-09-13T10:00:00.000Z",
    verb: "do",
    ...over,
  };
}

/** One open-page reading, landed before every ruling in these cases. */
function reading({ url, updatedIso }: { url: string; updatedIso?: string }) {
  return {
    ask: "react to it",
    landedIso: "2026-09-13T08:00:00.000Z",
    label: "A Page",
    url,
    ...(updatedIso === undefined ? {} : { updatedIso }),
  };
}

describe("the freeze store's key", () => {
  it("is a local page's SLUG, so two pages no longer collide on index.html", () => {
    expect(unwrap(artifactKey({ artifact: PAGE_A }))).toBe("alpha");
    expect(unwrap(artifactKey({ artifact: PAGE_B }))).toBe("beta");
  });

  it("is unchanged for an artifact URL and for a bare id", () => {
    expect(
      unwrap(artifactKey({ artifact: "https://claude.ai/code/artifact/7d871caf-9d5d-4658-8502-b2bfed2cd9fb" })),
    ).toBe("7d871caf-9d5d-4658-8502-b2bfed2cd9fb");
    expect(unwrap(artifactKey({ artifact: "0dc1a3db" }))).toBe("0dc1a3db");
    expect(unwrap(artifactKey({ artifact: "https://claude.ai/code/artifact/0dc1a3db?v=2" }))).toBe("0dc1a3db");
  });

  it("refuses a file address that is not a local page rather than filing it under index.html", () => {
    const refused = unwrapErr(artifactKey({ artifact: "file:///tmp/scratch/index.html" }));
    expect(refused.code).toBe("FILE_ADDRESS_NOT_A_PAGE");
    expect(refused.message).toBe(
      '"file:///tmp/scratch/index.html" is a file address that does not name a local page: this store files ' +
        "one at `<home>/pages/<slug>/index.html`, and keys it on the slug.",
    );
  });
});

describe("the lock-in lookup behind the ranked index", () => {
  it("finds a ruling recorded against page:<slug>, which the URL alone never matched", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "page:alpha", outcome: "deferred" })] });
    const validity = artifactValidity({
      nowIso: NOW,
      reading: reading({ url: PAGE_A }),
      siblings: [],
      states,
    });
    expect(validity.mark).toBe("partly-ruled");
  });

  it("still finds one recorded against the page's own URL", () => {
    const states = foldLockInLedger({ rows: [row({ identity: PAGE_A, outcome: "noted" })] });
    expect(artifactValidity({ nowIso: NOW, reading: reading({ url: PAGE_A }), siblings: [], states }).mark).toBe(
      "partly-ruled",
    );
  });

  it("does not let one slug's ruling reach another slug that shares its prefix", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "page:alph", outcome: "noted" })] });
    expect(artifactValidity({ nowIso: NOW, reading: reading({ url: PAGE_A }), siblings: [], states }).mark).toBe(
      "valid",
    );
  });

  it("lapses a ruling the page has been republished past, exactly as it does for an artifact", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "page:alpha", outcome: "noted" })] });
    const moved = reading({ updatedIso: "2026-09-13T11:00:00.000Z", url: PAGE_A });
    expect(artifactValidity({ nowIso: NOW, reading: moved, siblings: [], states }).mark).toBe("valid");
  });

  it("leaves an artifact page's own three keys working", () => {
    const url = "https://claude.ai/code/artifact/1e981d93-1a2d-422c-9a3a-75b023ef2eb7";
    const states = foldLockInLedger({ rows: [row({ identity: "artifact:1e981d93", outcome: "noted" })] });
    expect(artifactValidity({ nowIso: NOW, reading: reading({ url }), siblings: [], states }).mark).toBe(
      "partly-ruled",
    );
  });
});

describe("supersession by a local page", () => {
  it("names the replacement page, where a test for http alone found nothing", () => {
    const states = foldLockInLedger({
      rows: [row({ identity: "page:alpha", note: `the live version moved to ${PAGE_B}`, outcome: "dropped" })],
    });
    const ranked = rankOpenArtifacts({
      nowIso: NOW,
      readings: [reading({ url: PAGE_A }), { ...reading({ url: PAGE_B }), label: "The Replacement" }],
      states,
    });
    const alpha = ranked.find((entry) => entry.url === PAGE_A)!;
    expect(alpha.validity).toStrictEqual({ by: "The Replacement", byUrl: PAGE_B, mark: "superseded" });
  });
});

describe("anchorsIn", () => {
  it("extracts a local page address out of a note", () => {
    expect(anchorsIn({ text: `moved to ${PAGE_B}.` })).toStrictEqual([PAGE_B]);
  });

  it("still extracts an http URL and an owner/repo#number reference", () => {
    expect(anchorsIn({ text: "see https://example.com/a and lachiejames/slopweaver#618" })).toStrictEqual([
      "https://example.com/a",
      "lachiejames/slopweaver#618",
    ]);
  });
});

describe("anchorsIn does not widen past a local page", () => {
  it("drops a file address that is not one — found by a Codex review pass, not by writing it", () => {
    expect(anchorsIn({ text: "see file:///tmp/run.log" })).toStrictEqual([]);
    expect(anchorsIn({ text: "file:///x/screenshots/shot.png and file:///x/pages/a/index.html" })).toStrictEqual([
      "file:///x/pages/a/index.html",
    ]);
  });
});

describe("a widened matcher never eats what it then discards", () => {
  it("keeps an http anchor written straight after a non-page file address", () => {
    // Codex review counterexample: a loose `(?:https?|file)` arm matched both as one token and dropped it.
    expect(anchorsIn({ text: "file:///tmp/run.log,https://claude.ai/code/artifact/0dc1a3db" })).toStrictEqual([
      "https://claude.ai/code/artifact/0dc1a3db",
    ]);
  });

  it("still extracts a local page address written the same way", () => {
    expect(anchorsIn({ text: `moved to ${PAGE_B},see also https://example.com/a` })).toStrictEqual([
      PAGE_B,
      "https://example.com/a",
    ]);
  });
});

describe("an http URL that itself ends in the page shape", () => {
  it("is not swallowed by the file arm — the last spelling of the consumption class", () => {
    const text = "file:///tmp/run.log,https://example.com/pages/a/index.html";
    expect(anchorsIn({ text })).toStrictEqual(["https://example.com/pages/a/index.html"]);
  });
});
