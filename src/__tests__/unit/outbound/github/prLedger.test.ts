/**
 * The ledger, tested against a real temp directory rather than a mocked filesystem.
 *
 * A `mkdtempSync` round-trip is the sanctioned exception in `.claude/rules/testing.md`: the thing under test
 * IS the on-disk behaviour — `wx` exclusivity, a corrupt file failing closed — and a fake filesystem would
 * assert that the fake works.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  backfillPrIdentity,
  bodyHash,
  confirmPr,
  ledgerDir,
  listPrLoci,
  locusFilename,
  locusOf,
  parsePrRecord,
  readPrRecord,
  releasePrRecord,
  reservePr,
} from "../../../../outbound/github/prLedger.js";
import type { PrForm } from "../../../../outbound/github/types.js";
import { DISK_FULL_MESSAGE, dyingAtomicWriter } from "../../../dyingAtomicWriter.js";
import { FEATURE_BODY, formOf } from "./fixtures.js";
import { FULL_BODY as LEGACY_FULL_BODY, formOf as legacyFormOf } from "./legacy/fixtures.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-prledger-"));
  fixtureDirs.push(dir);
  return dir;
}

const TARGET = { base: "main", head: "feature", owner: "Owner", repo: "Repo" };

/** A whole C3 form, every optional section on, so a decode that drops one is visible. */
const FORM: PrForm = { ...formOf({ body: FEATURE_BODY }), target: TARGET };

/** A reading-order form, as a ledger written before C3 holds it. */
const LEGACY_FORM = legacyFormOf({ body: LEGACY_FULL_BODY });

/** A form in the RETIRED table shape, as a ledger written before the reading-order swap holds it. */
const RETIRED_FORM = {
  badges: [{ kind: "proof" }],
  draft: true,
  next: [{ kind: "text", text: "next" }],
  problem: [{ kind: "text", text: "problem" }],
  proof: { commit: "9f3c1de", evidence: { kind: "link", text: "r", url: "https://example.com/r" }, grade: "gold" },
  solution: [{ kind: "text", text: "solution" }],
  target: TARGET,
  title: "a title",
};

describe("the branch locus", () => {
  it("lower-cases owner and repo, because GitHub treats them case-insensitively", () => {
    expect(locusOf({ target: TARGET })).toBe("owner/repo#main...feature");
    expect(locusOf({ target: { ...TARGET, owner: "OWNER", repo: "REPO" } })).toBe(locusOf({ target: TARGET }));
  });

  it("does NOT lower-case refs, because git refs are case-sensitive", () => {
    expect(locusOf({ target: { ...TARGET, head: "Feature" } })).not.toBe(locusOf({ target: TARGET }));
  });

  it("distinguishes a different base from a different head", () => {
    expect(locusOf({ target: { ...TARGET, base: "develop" } })).toBe("owner/repo#develop...feature");
  });
});

describe("reservation is exclusive", () => {
  it("grants the locus once and refuses it thereafter", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    expect(reservePr({ home: h, locus, nowIso: "2026-08-03T00:00:00Z" }).kind).toBe("fresh");
    const second = reservePr({ home: h, locus, nowIso: "2026-08-03T00:00:01Z" });
    expect(second.kind).toBe("taken");
  });

  it("treats a DIFFERENT locus as free", () => {
    const h = home();
    expect(reservePr({ home: h, locus: "a/b#main...x", nowIso: "2026-08-03T00:00:00Z" }).kind).toBe("fresh");
    expect(reservePr({ home: h, locus: "a/b#main...y", nowIso: "2026-08-03T00:00:00Z" }).kind).toBe("fresh");
  });

  it("records the reservation instant so an unconfirmed create is diagnosable", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "2026-08-03T01:02:03Z" });
    expect(readPrRecord({ home: h, locus })!.reservedIso).toBe("2026-08-03T01:02:03Z");
  });
});

describe("releasing a reservation", () => {
  it("frees the locus for a fresh reservation afterwards", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "2026-08-14T00:00:00Z" });
    expect(reservePr({ home: h, locus, nowIso: "2026-08-14T00:00:01Z" }).kind).toBe("taken");
    releasePrRecord({ home: h, locus });
    expect(reservePr({ home: h, locus, nowIso: "2026-08-14T00:00:02Z" }).kind).toBe("fresh");
  });

  it("is a no-op on a locus that was never reserved", () => {
    const h = home();
    releasePrRecord({ home: h, locus: locusOf({ target: TARGET }) });
    expect(reservePr({ home: h, locus: locusOf({ target: TARGET }), nowIso: "t" }).kind).toBe("fresh");
  });

  it("does not touch a DIFFERENT locus", () => {
    const h = home();
    reservePr({ home: h, locus: "a/b#main...one", nowIso: "t" });
    reservePr({ home: h, locus: "a/b#main...two", nowIso: "t" });
    releasePrRecord({ home: h, locus: "a/b#main...one" });
    expect(reservePr({ home: h, locus: "a/b#main...one", nowIso: "t" }).kind).toBe("fresh");
    expect(reservePr({ home: h, locus: "a/b#main...two", nowIso: "t" }).kind).toBe("taken");
  });
});

describe("a record's filename, and reading one back", () => {
  // A locus carries `/`, `#` and `.`, all meaningful in a path, so the record is named by a DIGEST of it.
  // Using the raw locus as a filename is how a sibling lane once reported every send as a duplicate.
  it("names a record by a hash of its locus, not by the locus", () => {
    const locus = locusOf({ target: TARGET });
    const name = locusFilename({ locus });
    expect(name).toMatch(/^[0-9a-f]{32}$/);
    expect(name).not.toContain("/");
  });

  it("gives different loci different filenames", () => {
    const one = locusFilename({ locus: locusOf({ target: TARGET }) });
    const other = locusFilename({ locus: locusOf({ target: { ...TARGET, head: "another-branch" } }) });
    expect(one).not.toBe(other);
  });

  it("reads back a well-formed record", () => {
    const parsed = parsePrRecord({ raw: JSON.stringify({ locus: "a/b#main...x", number: 7, reservedIso: "t" }) });
    expect(parsed?.number).toBe(7);
  });

  const unreadable = ["not json at all", "[]", '"a string"', "{}", '{"locus":"a"}', '{"reservedIso":"t"}'];

  // Absent rather than throwing, and that is now SAFE in a way it was not when this file granted permission:
  // a missing cache entry costs a surgical edit its fast path, and the live description is parsed instead.
  it.each(unreadable)("reads %s as absent rather than throwing", (raw) => {
    expect(parsePrRecord({ raw })).toBeUndefined();
  });

  it("drops a stored form that no longer decodes, keeping the rest of the record", () => {
    const parsed = parsePrRecord({
      raw: JSON.stringify({ form: { grade: "not a form" }, locus: "a/b#main...x", number: 7, reservedIso: "t" }),
    });
    expect(parsed?.number).toBe(7);
    expect(parsed?.form).toBeUndefined();
  });

  // The reading-order swap left every older record holding a table-shaped form. It is a cache miss, never a
  // refusal: the surgical edit parses the live description instead, and a retired one is refused THERE by name.
  it("drops a stored form in the retired table shape as a cache miss, keeping the identity", () => {
    const parsed = parsePrRecord({
      raw: JSON.stringify({ form: RETIRED_FORM, locus: "a/b#main...x", number: 7, reservedIso: "t" }),
    })!;
    expect([parsed.number, parsed.form]).toStrictEqual([7, undefined]);
  });

  // C3 left every older record holding a reading-order form: the same cache miss, never a refusal.
  it("drops a reading-order form stored before C3 as a cache miss, keeping the identity", () => {
    const parsed = parsePrRecord({
      raw: JSON.stringify({ form: LEGACY_FORM, locus: "a/b#main...x", number: 7, reservedIso: "t" }),
    })!;
    expect([parsed.number, parsed.form]).toStrictEqual([7, undefined]);
  });

  it("drops a C3 form carrying a retired write stamp", () => {
    const parsed = parsePrRecord({
      raw: JSON.stringify({
        form: { ...FORM, writtenOn: "2026-10-01" },
        locus: "a/b#main...x",
        number: 7,
        reservedIso: "t",
      }),
    })!;
    expect(parsed.form).toBeUndefined();
  });

  it("decodes a C3 form exactly", () => {
    const parsed = parsePrRecord({
      raw: JSON.stringify({ form: FORM, locus: "a/b#main...x", number: 7, reservedIso: "t" }),
    })!;
    expect(parsed.form).toStrictEqual(FORM);
  });
});

describe("the body digest is a cache-invalidation signal, not a gate", () => {
  it("distinguishes an ABSENT body from an EMPTY one", () => {
    expect(bodyHash({ body: undefined })).not.toBe(bodyHash({ body: "" }));
  });

  it("is stable for the same body", () => {
    expect(bodyHash({ body: "x" })).toBe(bodyHash({ body: "x" }));
  });

  it("records the digest of what GitHub STORED, not what was sent", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "t" });
    confirmPr({ form: FORM, home: h, locus, nodeId: "n", nowIso: "t", number: 1, storedBody: "NORMALISED by github" });
    const record = readPrRecord({ home: h, locus })!;
    expect(record.bodyHash).toBe(bodyHash({ body: "NORMALISED by github" }));
  });

  /**
   * The counterexample that shaped the whole recovery design, kept here at the digest's own level.
   *
   * The digest is taken over what GitHub STORED while the form kept is what slopweaver SENT, so a server that
   * normalises on ingest — as Linear was measured to — makes the digest agree while the stored form no longer
   * renders those bytes. A digest match therefore does NOT license re-rendering the stored form. The consumer
   * that has to care is `../../../../outbound/github/recovery.ts`, which requires the digest AND an exact
   * re-render before it will use the cache; `recovery.test.ts` pins that. This test pins only the fact that
   * makes it necessary: agreement here says nothing about the form.
   */
  it("agrees with a normalised body even though the stored form does not render it", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "t" });
    confirmPr({ form: FORM, home: h, locus, nodeId: "n", nowIso: "t", number: 1, storedBody: "NORMALISED by github" });
    const record = readPrRecord({ home: h, locus })!;
    expect(record.bodyHash).toBe(bodyHash({ body: "NORMALISED by github" }));
    expect(record.form).toStrictEqual(FORM);
  });
});

describe("a confirm that dies part-way", () => {
  it("leaves the previous record whole and no staged sibling behind", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "t0" });
    confirmPr({ form: FORM, home: h, locus, nodeId: "n", nowIso: "t1", number: 1, storedBody: "first" });
    const path = join(ledgerDir({ home: h }), `${locusFilename({ locus })}.json`);
    const before = readFileSync(path, "utf8");

    expect(() =>
      confirmPr({
        form: FORM,
        home: h,
        locus,
        nodeId: "n2",
        nowIso: "t2",
        number: 2,
        storedBody: "second",
        writeAtomic: dyingAtomicWriter,
      }),
    ).toThrow(DISK_FULL_MESSAGE);

    expect(readFileSync(path, "utf8")).toBe(before);
    expect(readdirSync(ledgerDir({ home: h }))).toEqual([`${locusFilename({ locus })}.json`]);
  });
});

describe("listing", () => {
  it("returns the stored loci, sorted, and skips a corrupt record", () => {
    const h = home();
    reservePr({ home: h, locus: "a/b#main...z", nowIso: "t" });
    reservePr({ home: h, locus: "a/b#main...a", nowIso: "t" });
    writeFileSync(join(h, "ledgers", "github-prs", "corrupt.json"), "{nope");
    expect(listPrLoci({ home: h })).toStrictEqual(["a/b#main...a", "a/b#main...z"]);
  });

  it("is empty when nothing has been reserved", () => {
    expect(listPrLoci({ home: home() })).toStrictEqual([]);
  });
});

describe("recovering a number onto a reservation that never got one", () => {
  it("writes the identity and the digest, and leaves the form ABSENT rather than inventing one", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "2026-08-24T02:20:00Z" });
    backfillPrIdentity({
      home: h,
      locus,
      nodeId: "PR_4242",
      nowIso: "2026-08-24T02:25:00Z",
      number: 4242,
      storedBody: "the body github holds",
    });
    const record = readPrRecord({ home: h, locus })!;
    expect(record.number).toBe(4242);
    expect(record.nodeId).toBe("PR_4242");
    expect(record.confirmedIso).toBe("2026-08-24T02:25:00Z");
    expect(record.bodyHash).toBe(bodyHash({ body: "the body github holds" }));
    expect(record.form).toBeUndefined();
  });

  it("keeps the original reservedIso, so when the locus was claimed survives the recovery", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "2026-08-24T02:20:00Z" });
    backfillPrIdentity({
      home: h,
      locus,
      nodeId: "n",
      nowIso: "2026-08-24T02:25:00Z",
      number: 7,
      storedBody: undefined,
    });
    expect(readPrRecord({ home: h, locus })!.reservedIso).toBe("2026-08-24T02:20:00Z");
  });

  it("carries an existing stored form forward untouched", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "t" });
    confirmPr({ form: FORM, home: h, locus, nodeId: "n", nowIso: "t", number: 1, storedBody: "b" });
    backfillPrIdentity({ home: h, locus, nodeId: "n2", nowIso: "u", number: 2, storedBody: "b2" });
    const record = readPrRecord({ home: h, locus })!;
    expect(record.number).toBe(2);
    expect(record.form).toStrictEqual(FORM);
  });

  it("digests an ABSENT body differently from an empty one, so a failed read never reads as a cleared description", () => {
    const h = home();
    const locus = locusOf({ target: TARGET });
    reservePr({ home: h, locus, nowIso: "t" });
    backfillPrIdentity({ home: h, locus, nodeId: "n", nowIso: "u", number: 9, storedBody: undefined });
    const absent = readPrRecord({ home: h, locus })!.bodyHash;
    backfillPrIdentity({ home: h, locus, nodeId: "n", nowIso: "u", number: 9, storedBody: "" });
    expect(readPrRecord({ home: h, locus })!.bodyHash).not.toBe(absent);
  });
});
