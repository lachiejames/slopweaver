/**
 * The store port for an install's own knowledge domains, over the in-memory seams: the row is the authority, the
 * retired file is imported once and never consulted again, an outage or a corrupt row is a typed refusal rather
 * than an empty vocabulary, and an add commits every row or none, never retried.
 */
import { describe, expect, it } from "vitest";

import { KnowledgeDomainStoreErrors } from "../../../knowledge/domainStoreErrors.js";
import { slugOrdered } from "../../../knowledge/domainStoreRows.js";
import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { knowledgeDomainFake } from "../../knowledgeDomainFixture.js";

const HOME = "/tmp/sw-home";
const ACME_ENTRY = { holds: "the synthetic team monorepo", slug: "acme" } as const;

/** A retired file holding one domain and one alias into it. */
const PRESENT = ok({
  records: [
    { holds: "the synthetic team monorepo", kind: "domain" as const, slug: "acme" },
    { foldsInto: "acme", kind: "alias" as const, slug: "acme-e2e" },
  ],
  state: "present" as const,
});

describe("reading an install's own knowledge domains", () => {
  it("reads a home with no retired file and no rows as no install domains, marking the import done", async () => {
    const fake = knowledgeDomainFake();
    expect(unwrap(await fake.port.read({ home: HOME }))).toEqual(noInstallDomains({ home: HOME }));
    expect([fake.state.marker, fake.state.legacyReads, fake.state.closes]).toEqual([0, 1, 1]);
  });

  it("imports the retired file once, then answers from the rows alone", async () => {
    const fake = knowledgeDomainFake({ legacy: PRESENT });
    const first = unwrap(await fake.port.read({ home: HOME }));
    fake.state.legacy = ok({ records: [], state: "present" });
    const second = unwrap(await fake.port.read({ home: HOME }));
    expect(first).toEqual({ aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home: HOME });
    expect([second, fake.state.marker, fake.state.legacyReads]).toEqual([first, 2, 1]);
  });

  it("refuses, importing nothing, when the retired file exists and will not decode", async () => {
    const fake = knowledgeDomainFake({
      legacy: err(
        KnowledgeDomainStoreErrors.importProblem({
          problem: { kind: "invalid", path: "/tmp/sw-home/knowledge/domains.json", problems: ["not JSON"] },
        }),
      ),
    });
    const error = unwrapErr(await fake.port.read({ home: HOME }));
    expect([error.code, fake.state.marker, fake.state.rows]).toEqual([
      "KNOWLEDGE_DOMAIN_IMPORT_INVALID",
      undefined,
      [],
    ]);
  });

  it("refuses a store it cannot open, rather than reading the file or answering none", async () => {
    const fake = knowledgeDomainFake({ connection: "unavailable", legacy: PRESENT });
    expect(unwrapErr(await fake.port.read({ home: HOME })).code).toBe("KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE");
    expect(fake.state.legacyReads).toBe(0);
  });

  it("refuses a failed read, naming what the store said, and still closes the connection", async () => {
    const fake = knowledgeDomainFake();
    fake.state.readFailure = "connection reset by acme-db";
    const error = unwrapErr(await fake.port.read({ home: HOME }));
    expect([error.code, fake.state.closes]).toEqual(["KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE", 1]);
    expect(error.message).toContain("The store said: connection reset by acme-db");
  });

  it("refuses an empty read behind a marker that imported rows, as a loss rather than none", async () => {
    const fake = knowledgeDomainFake({ legacy: PRESENT });
    unwrap(await fake.port.read({ home: HOME }));
    fake.state.rows = [];
    expect(unwrapErr(await fake.port.read({ home: HOME })).code).toBe("KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE");
  });

  it("refuses a corrupt row and a row that redefines a committed domain, naming each", async () => {
    const fake = knowledgeDomainFake();
    fake.state.marker = 0;
    fake.state.rows = [
      { foldsInto: null, holds: null, kind: "domain", slug: "acme" },
      { foldsInto: null, holds: "ours now", kind: "domain", slug: "ci" },
    ];
    const corrupt = unwrapErr(await fake.port.read({ home: HOME }));
    fake.state.rows = [{ foldsInto: null, holds: "ours now", kind: "domain", slug: "ci" }];
    const redefined = unwrapErr(await fake.port.read({ home: HOME }));
    expect([corrupt.code, redefined.code]).toEqual(["KNOWLEDGE_DOMAIN_ROWS_INVALID", "KNOWLEDGE_DOMAIN_ROWS_INVALID"]);
    expect(corrupt.message).toContain('stored row "acme" is neither a domain');
    expect(redefined.message).toContain('domain "ci" is already a committed domain');
  });

  it("refuses a stored alias whose slug is __proto__ rather than losing it into the prototype", async () => {
    const fake = knowledgeDomainFake();
    fake.state.marker = 1;
    fake.state.rows = [{ foldsInto: "ci", holds: null, kind: "alias", slug: "__proto__" }];
    const refused = unwrapErr(await fake.port.read({ home: HOME }));
    expect(refused.code).toBe("KNOWLEDGE_DOMAIN_ROWS_INVALID");
    expect(refused.message).toContain('alias "__proto__" is not a domain slug');
  });
});

describe("adding one of an install's own knowledge domains", () => {
  it("inserts the domain and its aliases and answers the vocabulary as it now stands", async () => {
    const fake = knowledgeDomainFake();
    const added = unwrap(
      await fake.port.add({
        aliases: { "acme-e2e": "acme" },
        entry: { holds: "  the synthetic team monorepo ", slug: "acme" },
        home: HOME,
      }),
    );
    expect(added).toEqual({ aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home: HOME });
    expect(fake.state.closes).toBe(1);
  });

  it("answers a committed add as landed even when the store becomes unreadable straight after the commit", async () => {
    const fake = knowledgeDomainFake();
    fake.state.readFailureAfterInsert = "connection dropped after commit";
    const added = unwrap(await fake.port.add({ aliases: { "acme-e2e": "acme" }, entry: ACME_ENTRY, home: HOME }));
    expect(added).toEqual({ aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home: HOME });
    expect(fake.state.rows.map((row) => row.slug)).toEqual(["acme", "acme-e2e"]);
    expect(unwrapErr(await fake.port.read({ home: HOME })).code).toBe("KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE");
  });

  it("refuses an add whose connection fails to close after the commit, and a retry meets the slug rather than doubling it", async () => {
    const fake = knowledgeDomainFake();
    fake.state.closeFailure = "socket reset on close";
    const first = unwrapErr(await fake.port.add({ aliases: {}, entry: ACME_ENTRY, home: HOME }));
    expect(first.code).toBe("KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE");
    fake.state.closeFailure = undefined;
    const second = unwrapErr(await fake.port.add({ aliases: {}, entry: ACME_ENTRY, home: HOME }));
    expect(second.message).toContain('domain "acme" is already configured');
    expect(fake.state.rows.map((row) => row.slug)).toEqual(["acme"]);
  });

  it("runs the one-time import before judging an add, so the retired file's domains count", async () => {
    const fake = knowledgeDomainFake({ legacy: PRESENT });
    const error = unwrapErr(await fake.port.add({ aliases: {}, entry: ACME_ENTRY, home: HOME }));
    expect([error.code, fake.state.marker]).toEqual(["KNOWLEDGE_DOMAINS_ADD_REFUSED", 2]);
  });

  it("refuses an add another writer raced, writing none of its own rows and never retrying", async () => {
    const fake = knowledgeDomainFake();
    fake.state.raceBeforeInsert = [{ foldsInto: null, holds: "theirs", kind: "domain", slug: "acme-e2e" }];
    const error = unwrapErr(await fake.port.add({ aliases: { "acme-e2e": "acme" }, entry: ACME_ENTRY, home: HOME }));
    expect([error.code, fake.state.rows.map((row) => row.slug)]).toEqual([
      "KNOWLEDGE_DOMAIN_ADD_CONFLICT",
      ["acme-e2e"],
    ]);
    expect(error.message).toContain('another writer added "acme-e2e"');
  });

  it("refuses an add against a store it cannot open", async () => {
    const fake = knowledgeDomainFake({ connection: "unavailable" });
    expect(unwrapErr(await fake.port.add({ aliases: {}, entry: ACME_ENTRY, home: HOME })).code).toBe(
      "KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE",
    );
  });
});

describe("the order an add's rows are inserted in", () => {
  it("is slug order whatever order they arrive in, so two racing adds take their key locks in the same order", () => {
    const fooFirst = [
      { holds: "one repository", kind: "domain" as const, slug: "foo" },
      { foldsInto: "foo", kind: "alias" as const, slug: "bar" },
    ];
    const barFirst = [
      { holds: "another repository", kind: "domain" as const, slug: "bar" },
      { foldsInto: "bar", kind: "alias" as const, slug: "foo" },
    ];
    expect(slugOrdered({ records: fooFirst }).map((record) => record.slug)).toEqual(["bar", "foo"]);
    expect(slugOrdered({ records: barFirst }).map((record) => record.slug)).toEqual(["bar", "foo"]);
  });

  it("orders by code point, never by locale, so every writer agrees", () => {
    const records = [
      { holds: "x", kind: "domain" as const, slug: "b2" },
      { holds: "x", kind: "domain" as const, slug: "b-2" },
      { holds: "x", kind: "domain" as const, slug: "a" },
    ];
    expect(slugOrdered({ records }).map((record) => record.slug)).toEqual(["a", "b-2", "b2"]);
  });
});
