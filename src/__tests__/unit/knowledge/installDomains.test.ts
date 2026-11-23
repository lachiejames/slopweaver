/**
 * An install's own knowledge domains, the pure half: every check that keeps an install adding to the committed
 * vocabulary rather than redefining it, the retired file's decoder, the vocabulary assembled from stored records,
 * and the records an add writes, plus the one read a `knowledge` verb makes through its port. The store half is
 * `domainStorePort.test.ts`.
 *
 * The file's own parse, read, render and write went out with the file as the authority, and their cases with them.
 */
import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../../atlas/registry.js";
import { installDomainsOrExit } from "../../../cli/commands/knowledge/installDomainsEdge.js";
import { EXIT_ERROR } from "../../../cli/exitCodes.js";
import { domainStanding, type InstallKnowledgeDomains, noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import {
  addInstallKnowledgeDomain,
  decodeInstallDomainsDocument,
  installDomainProblems,
  installDomainsFromRecords,
} from "../../../knowledge/installDomains.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { knowledgeDomainFake } from "../../knowledgeDomainFixture.js";

const HOME = "/tmp/sw-home";
const ACME_ENTRY = { holds: "the synthetic team monorepo", slug: "acme" } as const;

describe("installDomainProblems", () => {
  it("finds nothing wrong with a domain of the install's own and aliases into it and into a committed one", () => {
    expect(
      installDomainProblems({ aliases: { "acme-e2e": "acme", "acme-gates": "ci" }, domains: [ACME_ENTRY] }),
    ).toEqual([]);
  });

  it("refuses a slug that is not a slug, a committed domain, an atlas platform, a committed alias and a repeat", () => {
    const platform = atlasPlatforms()[0]!;
    expect(
      installDomainProblems({
        aliases: {},
        domains: [
          { holds: "x", slug: "Acme Repo" },
          { holds: "x", slug: "ci" },
          { holds: "x", slug: platform },
          { holds: "x", slug: "github-ci" },
          ACME_ENTRY,
          ACME_ENTRY,
        ],
      }),
    ).toEqual([
      'domain "Acme Repo" is not a domain slug',
      'domain "ci" is already a committed domain',
      `domain "${platform}" is already a committed domain`,
      'domain "github-ci" is already a committed alias',
      'domain "acme" appears twice',
    ]);
  });

  it("refuses a domain whose holds is only whitespace, which the file's own reader would refuse", () => {
    expect(installDomainProblems({ aliases: {}, domains: [{ holds: "   ", slug: "acme-ops" }] })).toEqual([
      'domain "acme-ops" says nothing about what it holds',
    ]);
  });

  it("refuses an alias that shadows a domain, re-points a committed alias, or folds into nothing", () => {
    expect(
      installDomainProblems({
        aliases: { "Acme E2E": "acme", acme: "ci", "acme-lost": "acme-nowhere", "github-ci": "acme" },
        domains: [ACME_ENTRY],
      }),
    ).toEqual([
      'alias "Acme E2E" is not a domain slug',
      'alias "acme" is itself a domain',
      'alias "acme-lost" folds into "acme-nowhere", which is not a domain',
      'alias "github-ci" is already a committed alias',
    ]);
  });
});

describe("decodeInstallDomainsDocument", () => {
  it("decodes a valid retired file into records, domains then aliases, each by slug", () => {
    expect(
      unwrap(
        decodeInstallDomainsDocument({
          value: {
            aliases: { "acme-z": "acme", "acme-a": "acme-ops" },
            domains: [{ holds: "operations", slug: "acme-ops" }, ACME_ENTRY],
          },
        }),
      ),
    ).toEqual([
      { holds: "the synthetic team monorepo", kind: "domain", slug: "acme" },
      { holds: "operations", kind: "domain", slug: "acme-ops" },
      { foldsInto: "acme-ops", kind: "alias", slug: "acme-a" },
      { foldsInto: "acme", kind: "alias", slug: "acme-z" },
    ]);
  });

  it("refuses a misspelt key rather than ignoring it", () => {
    expect(unwrapErr(decodeInstallDomainsDocument({ value: { aliases: {}, domain: [], domains: [] } }))).toEqual([
      'Unrecognized key: "domain"',
    ]);
  });

  it("refuses a document missing either key, and one that is not an object", () => {
    expect([
      unwrapErr(decodeInstallDomainsDocument({ value: { domains: [] } })).length,
      unwrapErr(decodeInstallDomainsDocument({ value: [] })).length,
    ]).toEqual([1, 1]);
  });

  it("refuses a domain with nothing it holds, naming where", () => {
    expect(
      unwrapErr(decodeInstallDomainsDocument({ value: { aliases: {}, domains: [{ holds: "   ", slug: "acme" }] } })),
    ).toEqual(["domains.0.holds: holds is empty"]);
  });

  it("refuses a file whose domain redefines a committed one", () => {
    expect(
      unwrapErr(decodeInstallDomainsDocument({ value: { aliases: {}, domains: [{ holds: "ours now", slug: "ci" }] } })),
    ).toEqual(['domain "ci" is already a committed domain']);
  });
});

describe("installDomainsFromRecords", () => {
  it("assembles the vocabulary of the home it is given", () => {
    const vocabulary = unwrap(
      installDomainsFromRecords({
        home: HOME,
        records: [
          { holds: "the synthetic team monorepo", kind: "domain", slug: "acme" },
          { foldsInto: "acme", kind: "alias", slug: "acme-e2e" },
        ],
      }),
    );
    expect(vocabulary).toEqual({ aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home: HOME });
    expect(domainStanding({ domain: "acme", installDomains: vocabulary })).toEqual({ kind: "canonical" });
  });

  it("reads no records as no install domains", () => {
    expect(unwrap(installDomainsFromRecords({ home: HOME, records: [] }))).toEqual(noInstallDomains({ home: HOME }));
  });

  it("refuses stored records that would redefine the committed vocabulary, rather than trusting them", () => {
    expect(
      unwrapErr(
        installDomainsFromRecords({
          home: HOME,
          records: [
            { holds: "ours now", kind: "domain", slug: "ci" },
            { foldsInto: "acme-nowhere", kind: "alias", slug: "acme-lost" },
          ],
        }),
      ),
    ).toEqual([
      'domain "ci" is already a committed domain',
      'alias "acme-lost" folds into "acme-nowhere", which is not a domain',
    ]);
  });
});

describe("addInstallKnowledgeDomain", () => {
  it("answers the records to insert: the domain, trimmed, then its aliases", () => {
    expect(
      unwrap(
        addInstallKnowledgeDomain({
          aliases: { "acme-gates": "ci", "acme-e2e": "acme" },
          entry: { holds: "  the synthetic team monorepo  ", slug: "acme" },
          installDomains: noInstallDomains({ home: HOME }),
        }),
      ),
    ).toEqual([
      { holds: "the synthetic team monorepo", kind: "domain", slug: "acme" },
      { foldsInto: "acme", kind: "alias", slug: "acme-e2e" },
      { foldsInto: "ci", kind: "alias", slug: "acme-gates" },
    ]);
  });

  it("refuses a slug and an alias the install already holds, naming the home", () => {
    const held: InstallKnowledgeDomains = { aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home: HOME };
    const error = unwrapErr(
      addInstallKnowledgeDomain({ aliases: { "acme-e2e": "acme" }, entry: ACME_ENTRY, installDomains: held }),
    );
    expect([error.code, error.message]).toEqual([
      "KNOWLEDGE_DOMAINS_ADD_REFUSED",
      `refused to add to the knowledge domains of ${HOME} — domain "acme" is already configured; alias "acme-e2e" is already configured`,
    ]);
  });

  it("refuses a slug the committed vocabulary already holds", () => {
    const error = unwrapErr(
      addInstallKnowledgeDomain({
        aliases: {},
        entry: { holds: "x", slug: "ci" },
        installDomains: noInstallDomains({ home: HOME }),
      }),
    );
    expect(error.problems).toEqual(['domain "ci" is already a committed domain']);
  });

  it("refuses a domain whose slug is already one of the install's own aliases", () => {
    const held: InstallKnowledgeDomains = { aliases: { "acme-e2e": "acme" }, domains: [ACME_ENTRY], home: HOME };
    const error = unwrapErr(
      addInstallKnowledgeDomain({ aliases: {}, entry: { holds: "x", slug: "acme-e2e" }, installDomains: held }),
    );
    expect(error.problems).toEqual(['alias "acme-e2e" is itself a domain']);
  });
});

describe("installDomainsOrExit", () => {
  it("hands a verb the vocabulary of the home it names, read through the port", async () => {
    const fake = knowledgeDomainFake({
      legacy: ok({
        records: [
          { holds: "the synthetic team monorepo", kind: "domain", slug: "acme" },
          { foldsInto: "acme", kind: "alias", slug: "acme-e2e" },
        ],
        state: "present",
      }),
    });
    expect(await installDomainsOrExit({ domains: fake.port, home: HOME, verb: "knowledge record" })).toEqual({
      aliases: { "acme-e2e": "acme" },
      domains: [ACME_ENTRY],
      home: HOME,
    });
  });

  it("reads a home with nothing stored as no install domains", async () => {
    const fake = knowledgeDomainFake();
    expect(await installDomainsOrExit({ domains: fake.port, home: HOME, verb: "knowledge record" })).toEqual(
      noInstallDomains({ home: HOME }),
    );
  });

  it("exits with an error, rather than an empty vocabulary, when the store cannot answer", async () => {
    const fake = knowledgeDomainFake({ connection: "unavailable" });
    expect(await installDomainsOrExit({ domains: fake.port, home: HOME, verb: "knowledge record" })).toBe(EXIT_ERROR);
    expect(fake.state.legacyReads).toBe(0);
  });
});
