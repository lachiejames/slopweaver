/**
 * `knowledge domains` and `knowledge domains add` over an in-memory store: what an add writes, what it refuses,
 * the listing that marks an install's own domains, and the `--alias` pairs the verb accepts.
 */
import { describe, expect, it } from "vitest";

import {
  runKnowledgeDomainsWithDeps,
  vocabularyDocument,
  vocabularyLines,
} from "../../../cli/commands/knowledge/domains.js";
import { parseAliasPairs } from "../../../cli/commands/knowledge/registerArgs.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { KnowledgeDomainStoreErrors } from "../../../knowledge/domainStoreErrors.js";
import { type InstallKnowledgeDomains, noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import { type KnowledgeDomainFake, knowledgeDomainFake } from "../../knowledgeDomainFixture.js";

/** The home every invocation names; the fake never touches it. */
const HOME = "/tmp/sw-home";

/**
 * Run the verb over one fake.
 *
 * @param fake the store the verb reads and writes
 * @param args the verb's own arguments, after `knowledge domains`
 * @returns the exit code
 */
function run({ fake, args }: { fake: KnowledgeDomainFake; args: readonly string[] }): Promise<number> {
  return runKnowledgeDomainsWithDeps({
    argv: ["node", "index.js", "knowledge", "domains", ...args, "--home", HOME],
    deps: { domains: fake.port },
  });
}

const ACME: InstallKnowledgeDomains = {
  aliases: { "acme-e2e": "acme" },
  domains: [{ holds: "the synthetic team monorepo", slug: "acme" }],
  home: HOME,
};

describe("knowledge domains add", () => {
  it("writes the domain and its aliases to the store", async () => {
    const fake = knowledgeDomainFake();
    const code = await run({
      args: [
        "add",
        "--slug",
        "acme",
        "--holds",
        "the synthetic team monorepo",
        "--alias",
        "acme-e2e=acme",
        "--alias",
        "acme-gates=ci",
      ],
      fake,
    });
    expect(code).toBe(EXIT_OK);
    expect(fake.state.rows).toEqual([
      { foldsInto: null, holds: "the synthetic team monorepo", kind: "domain", slug: "acme" },
      { foldsInto: "acme", holds: null, kind: "alias", slug: "acme-e2e" },
      { foldsInto: "ci", holds: null, kind: "alias", slug: "acme-gates" },
    ]);
  });

  it("adds a second domain beside the first, and refuses the first again as a usage error", async () => {
    const fake = knowledgeDomainFake();
    const add = ({ slug }: { slug: string }): Promise<number> =>
      run({ args: ["add", "--slug", slug, "--holds", `what ${slug} holds`], fake });
    expect([await add({ slug: "acme" }), await add({ slug: "acme-ops" }), await add({ slug: "acme" })]).toEqual([
      EXIT_OK,
      EXIT_OK,
      EXIT_USAGE,
    ]);
    expect(fake.state.rows.map((row) => row.slug)).toEqual(["acme", "acme-ops"]);
  });

  it("refuses a committed domain and writes nothing", async () => {
    const fake = knowledgeDomainFake();
    expect(await run({ args: ["add", "--slug", "ci", "--holds", "x"], fake })).toBe(EXIT_USAGE);
    expect(fake.state.rows).toEqual([]);
  });

  it("refuses an add with no --holds, a malformed --alias, and an add mixed with --migrate", async () => {
    const fake = knowledgeDomainFake();
    expect([
      await run({ args: ["add", "--slug", "acme"], fake }),
      await run({ args: ["add", "--slug", "acme", "--holds", "x", "--alias", "acme"], fake }),
      await run({ args: ["add", "--slug", "acme", "--holds", "x", "--migrate"], fake }),
    ]).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect(fake.state.rows).toEqual([]);
  });

  it("refuses an add's flags without add, and any other subcommand", async () => {
    const fake = knowledgeDomainFake();
    expect([await run({ args: ["--slug", "acme"], fake }), await run({ args: ["remove"], fake })]).toEqual([
      EXIT_USAGE,
      EXIT_USAGE,
    ]);
  });

  it("refuses to add while the retired file cannot be imported, and writes nothing", async () => {
    const fake = knowledgeDomainFake({
      legacy: err(
        KnowledgeDomainStoreErrors.importProblem({ problem: { kind: "invalid", path: "/x", problems: ["not json"] } }),
      ),
    });
    expect(await run({ args: ["add", "--slug", "acme", "--holds", "x"], fake })).toBe(EXIT_ERROR);
    expect([fake.state.rows, fake.state.marker]).toEqual([[], undefined]);
  });

  it("refuses an add another writer raced, with nothing of its own written", async () => {
    const fake = knowledgeDomainFake();
    fake.state.raceBeforeInsert = [{ foldsInto: "ci", holds: null, kind: "alias", slug: "acme-e2e" }];
    expect(await run({ args: ["add", "--slug", "acme", "--holds", "x", "--alias", "acme-e2e=acme"], fake })).toBe(
      EXIT_ERROR,
    );
    expect(fake.state.rows).toEqual([{ foldsInto: "ci", holds: null, kind: "alias", slug: "acme-e2e" }]);
  });

  it("refuses an add against a store it cannot open", async () => {
    expect(
      await run({
        args: ["add", "--slug", "acme", "--holds", "x"],
        fake: knowledgeDomainFake({ connection: "unavailable" }),
      }),
    ).toBe(EXIT_ERROR);
  });
});

describe("knowledge domains", () => {
  it("lists against a store with no install domains", async () => {
    expect(await run({ args: [], fake: knowledgeDomainFake() })).toBe(EXIT_OK);
  });

  it("refuses to list when the store cannot say which domains it holds", async () => {
    const fake = knowledgeDomainFake();
    fake.state.readFailure = "connection reset";
    expect(await run({ args: [], fake })).toBe(EXIT_ERROR);
  });

  it("marks an install's own domain, and adds exactly one line for it", () => {
    const without = vocabularyLines({ installDomains: noInstallDomains({ home: HOME }) });
    const withAcme = vocabularyLines({ installDomains: ACME });
    expect(withAcme.filter((line) => !without.includes(line))).toEqual([
      "acme  the synthetic team monorepo  (install)",
    ]);
  });

  it("names the install's own domains apart in the JSON listing", () => {
    const document = vocabularyDocument({ installDomains: ACME });
    expect(document.install).toEqual(["acme"]);
    expect(document.domains.filter((slug) => slug === "acme")).toEqual(["acme"]);
  });
});

describe("parseAliasPairs", () => {
  it("reads each pair, trimmed", () => {
    expect(unwrap(parseAliasPairs({ pairs: ["acme-e2e=acme", " acme-gates = ci "] }))).toEqual({
      "acme-e2e": "acme",
      "acme-gates": "ci",
    });
  });

  it("reads no pairs as no aliases", () => {
    expect(unwrap(parseAliasPairs({ pairs: [] }))).toEqual({});
  });

  it("refuses every value that is not a pair, and a spelling given twice", () => {
    expect(unwrapErr(parseAliasPairs({ pairs: ["acme", "=acme", "acme-e2e=", "acme-x=a", "acme-x=b"] }))).toEqual([
      "--alias acme is not <from>=<to>",
      "--alias =acme is not <from>=<to>",
      "--alias acme-e2e= is not <from>=<to>",
      "--alias acme-x was given twice",
    ]);
  });
});
