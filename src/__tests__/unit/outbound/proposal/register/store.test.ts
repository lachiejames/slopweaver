/** The register store's filesystem tail: real temp-dir round-trips, no mocks. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { RegisterEvent } from "../../../../../outbound/proposal/register/events.js";
import {
  appendRegisterEvent,
  isSafeRegisterSlug,
  listRegisterSlugs,
  loadRegisterEntry,
  readRegisterJournal,
  registerJournalPath,
} from "../../../../../outbound/proposal/register/store.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-register-"));
  fixtureDirs.push(dir);
  return dir;
}

const CREATED: RegisterEvent = {
  atIso: "2026-08-01T00:00:00.000Z",
  kind: "created",
  address: { id: "page-1", provider: "notion", url: "https://example.test/page-1" },
  source: "publish",
  title: "A proposal",
};

describe("isSafeRegisterSlug", () => {
  it("accepts a lowercase-alphanumeric-dash slug", () => {
    expect(isSafeRegisterSlug({ slug: "a-slug-123" })).toBe(true);
  });

  it("refuses a slug that could traverse a path", () => {
    expect(isSafeRegisterSlug({ slug: "../../etc" })).toBe(false);
  });

  it("refuses an uppercase slug", () => {
    expect(isSafeRegisterSlug({ slug: "Not-Lowercase" })).toBe(false);
  });
});

describe("readRegisterJournal", () => {
  it("reports a missing journal as an empty journal, not an error", () => {
    const parsed = unwrap(readRegisterJournal({ home: tempHome(), slug: "never-registered" }));
    expect(parsed.events).toEqual([]);
  });

  it("refuses a slug that could escape the register directory", () => {
    const read = readRegisterJournal({ home: tempHome(), slug: "../../elsewhere" });
    expect(unwrapErr(read).kind).toBe("io");
    expect(unwrapErr(read).message).toBe(
      '"../../elsewhere" is not usable as a register journal filename — a slug must match ^[a-z0-9][a-z0-9-]{0,79}$',
    );
  });
});

describe("appendRegisterEvent + readRegisterJournal", () => {
  it("round-trips one appended event", () => {
    const home = tempHome();
    unwrap(appendRegisterEvent({ event: CREATED, home, slug: "a-slug" }));
    const parsed = unwrap(readRegisterJournal({ home, slug: "a-slug" }));
    expect(parsed.events).toEqual([CREATED]);
  });

  it("preserves earlier events across multiple appends, in order", () => {
    const home = tempHome();
    unwrap(appendRegisterEvent({ event: CREATED, home, slug: "a-slug" }));
    unwrap(
      appendRegisterEvent({
        event: { atIso: "2026-08-02T00:00:00.000Z", audience: "eng", kind: "audience-set" },
        home,
        slug: "a-slug",
      }),
    );
    const parsed = unwrap(readRegisterJournal({ home, slug: "a-slug" }));
    expect(parsed.events.length).toBe(2);
    expect(parsed.events[0]).toEqual(CREATED);
  });

  it("keeps two different slugs in two different files", () => {
    const home = tempHome();
    unwrap(appendRegisterEvent({ event: CREATED, home, slug: "slug-one" }));
    unwrap(
      appendRegisterEvent({
        event: { ...CREATED, address: { id: "page-2", provider: "notion" } },
        home,
        slug: "slug-two",
      }),
    );
    expect(unwrap(readRegisterJournal({ home, slug: "slug-one" })).events.length).toBe(1);
    expect(unwrap(readRegisterJournal({ home, slug: "slug-two" })).events.length).toBe(1);
  });

  it("appends onto a journal whose last line has no trailing newline without corrupting it", () => {
    const home = tempHome();
    unwrap(appendRegisterEvent({ event: CREATED, home, slug: "a-slug" }));
    const path = registerJournalPath({ home, slug: "a-slug" });
    // Simulate a killed process: the file exists, but its final byte is not `\n`.
    writeFileSync(path, JSON.stringify(CREATED));
    unwrap(
      appendRegisterEvent({
        event: { atIso: "2026-08-02T00:00:00.000Z", audience: "eng", kind: "audience-set" },
        home,
        slug: "a-slug",
      }),
    );
    const parsed = unwrap(readRegisterJournal({ home, slug: "a-slug" }));
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events.length).toBe(2);
  });
});

describe("loadRegisterEntry", () => {
  it("returns undefined for a slug with no journal", () => {
    expect(unwrap(loadRegisterEntry({ home: tempHome(), slug: "never-registered" }))).toBe(undefined);
  });

  it("returns the folded entry for a registered slug", () => {
    const home = tempHome();
    unwrap(appendRegisterEvent({ event: CREATED, home, slug: "a-slug" }));
    const entry = unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!;
    expect(entry.slug).toBe("a-slug");
    expect(entry.status).toBe("strawman");
  });
});

describe("listRegisterSlugs", () => {
  it("returns nothing when the register directory does not exist yet", () => {
    expect(listRegisterSlugs({ home: tempHome() })).toEqual([]);
  });

  it("lists every registered slug once the directory exists", () => {
    const home = tempHome();
    unwrap(appendRegisterEvent({ event: CREATED, home, slug: "slug-one" }));
    unwrap(
      appendRegisterEvent({
        event: { ...CREATED, address: { id: "page-2", provider: "notion" } },
        home,
        slug: "slug-two",
      }),
    );
    expect(listRegisterSlugs({ home }).toSorted()).toEqual(["slug-one", "slug-two"]);
  });
});
