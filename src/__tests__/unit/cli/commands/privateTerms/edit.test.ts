/**
 * The hands-free list's verbs over a throwaway home: `add` proposes and writes nothing, its read-back names no
 * pattern, `confirm` lands the file at 0600, `list` never prints a pattern, and a confirm over a file that moved, or
 * under a lock a live process holds, writes nothing. Stale marks on `list` are `./list.test.ts`, `retire`
 * `./retire.test.ts`. Every term here is synthetic.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type PrivateTermsEditDeps,
  runPrivateTermsAdd,
  runPrivateTermsConfirm,
  runPrivateTermsNarrow,
  runPrivateTermsRemove,
} from "../../../../../cli/commands/privateTerms/edit.js";
import { runPrivateTermsList } from "../../../../../cli/commands/privateTerms/list.js";
import { PRIVATE_TERMS_HEADER_V2, WITHHELD_REFUSAL_LINE } from "../../../../../hygiene/privateTerms.js";
import { confirmPrivateTermsProposal } from "../../../../../hygiene/privateTermsStore.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "private-terms-edit-"));
  homes.push(home);
  return home;
}

/** Deps writing to two line lists, minting the given ids in order, reading pattern files from `files`. */
function depsOf({
  termIds = ["pt-00000000000a", "pt-00000000000b", "pt-00000000000c"],
  proposalIds = ["pp-00000000000a", "pp-00000000000b", "pp-00000000000c"],
  files = {},
}: {
  termIds?: readonly string[];
  proposalIds?: readonly string[];
  files?: Readonly<Record<string, string>>;
} = {}): { deps: PrivateTermsEditDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const terms = [...termIds];
  const proposals = [...proposalIds];
  return {
    deps: {
      mintProposalId: () => proposals.shift()!,
      mintTermId: () => terms.shift()!,
      nowIso: () => "2026-11-22T00:00:00.000Z",
      out: ({ line }) => {
        out.push(line);
      },
      readPatternFile: ({ path }) => {
        const text = files[path];
        return text === undefined ? err(`--pattern-file ${path} could not be read`) : ok(text);
      },
      writeDiagnostic: ({ line }) => {
        diagnostics.push(line);
      },
    },
    diagnostics,
    out,
  };
}

const argvOf = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "private-terms",
  verb,
  ...rest,
];

/** A complete `add`, the pattern from a file so it is never on the argv. */
const ADD_REST = [
  "--class",
  "person",
  "--case",
  "insensitive",
  "--pattern-file",
  "/fixture/term.txt",
  "--meaning",
  "a colleague at acme",
  "--allowed-where",
  "the acme workspace",
  "--source",
  "relay:acme-row",
  "--matches",
  "lunch with Quillfeather",
  "--misses",
  "lunch with acme",
] as const;

const FILES = { "/fixture/term.txt": "quillfeather\n" } as const;

describe("private-terms add, then confirm", () => {
  it("proposes without writing, reads back without the pattern, and lands at 0600 on confirm", () => {
    const home = freshHome();
    const added = depsOf({ files: FILES });
    expect(
      runPrivateTermsAdd({ argv: argvOf({ rest: [...ADD_REST, "--home", home], verb: "add" }), deps: added.deps }),
    ).toBe(0);
    expect(existsSync(stateHomePaths({ home }).privateTerms)).toBe(false);
    expect(added.out).toStrictEqual([
      "proposal pp-00000000000a: add pt-00000000000a (person, case-insensitive)",
      "  means: a colleague at acme",
      "  fine where: the acme workspace",
      "  probes: 1 of 1 matched as they should, 1 of 1 missed as they should",
      "  rows: 0 before, 1 after",
      `  Nothing is written yet. Read this back to the owner; on the owner's yes: slopweaver private-terms confirm pp-00000000000a --home ${home}`,
    ]);
    expect(added.out.join("\n").toLowerCase()).not.toContain("quillfeather");

    const confirmed = depsOf();
    expect(
      runPrivateTermsConfirm({
        argv: argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" }),
        deps: confirmed.deps,
      }),
    ).toBe(0);
    const path = stateHomePaths({ home }).privateTerms;
    expect(readFileSync(path, "utf8")).toBe(
      `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tquillfeather\ta colleague at acme\tthe acme workspace\trelay:acme-row\n`,
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(confirmed.out).toStrictEqual([`landed: add pt-00000000000a; ${path} holds 1 row(s), mode 0600`]);
  });

  it("refuses a proposal whose probe came out the other way, keeping nothing", () => {
    const home = freshHome();
    const run = depsOf({ files: FILES });
    const rest = [...ADD_REST.slice(0, -2), "--misses", "QUILLFEATHER", "--home", home];
    expect(runPrivateTermsAdd({ argv: argvOf({ rest, verb: "add" }), deps: run.deps })).toBe(1);
    expect(run.diagnostics.at(-1)).toBe(
      "  a probe came out the other way, so the row does not mean what it was said to; nothing was proposed",
    );
    expect(existsSync(stateHomePaths({ home }).privateTermProposals)).toBe(false);
  });

  it("withholds a meaning that itself carries a term already on the list", () => {
    const home = freshHome();
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const run = depsOf({ files: { "/fixture/other.txt": "inkwell" } });
    const rest = [
      "--class",
      "person",
      "--case",
      "sensitive",
      "--pattern-file",
      "/fixture/other.txt",
      "--meaning",
      "Quillfeather's manager",
      "--allowed-where",
      "nowhere",
      "--source",
      "relay:acme-row",
      "--home",
      home,
    ];
    expect(runPrivateTermsAdd({ argv: argvOf({ rest, verb: "add" }), deps: run.deps })).toBe(0);
    expect(run.out[1]).toBe("  means: (withheld here: it carries a private term)");
    expect(run.out[4]).toBe(
      "  rows: 1 before, 2 after; this edit also moves the file to the seven-cell form, every row kept",
    );
  });

  it("refuses a usage problem with the usage line", () => {
    const run = depsOf();
    expect(runPrivateTermsAdd({ argv: argvOf({ rest: ["--class", "person"], verb: "add" }), deps: run.deps })).toBe(2);
    expect(run.diagnostics).toContain("--meaning is required: a term lands with what the owner said it means");
  });

  it("refuses a confirm over a file that changed after the proposal, writing nothing", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    const added = depsOf({ files: FILES });
    expect(
      runPrivateTermsAdd({ argv: argvOf({ rest: [...ADD_REST, "--home", home], verb: "add" }), deps: added.deps }),
    ).toBe(0);
    writePrivateTerms({ home, rows: ["person\ti\tinkwell\tsynthetic"] });
    const confirmed = depsOf();
    expect(
      runPrivateTermsConfirm({
        argv: argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" }),
        deps: confirmed.deps,
      }),
    ).toBe(1);
    expect(confirmed.diagnostics).toStrictEqual([
      "proposal pp-00000000000a cannot land: the private terms file changed after it was proposed; nothing was written, propose the edit again",
      `  retire it: slopweaver private-terms retire pp-00000000000a --home ${home}`,
    ]);
  });

  it("refuses a confirm over a change of one invalid byte for another, which decodes the same", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).privateTerms;
    const fileWith = ({ byte }: { byte: number }): Buffer =>
      Buffer.concat([
        Buffer.from(`${PRIVATE_TERMS_HEADER_V2}\npt-00000000000b\tperson\ti\tinkwell\tsynthetic `),
        Buffer.from([byte]),
        Buffer.from("\t\trelay:acme-row\n"),
      ]);
    writePrivateTerms({ home });
    writeFileSync(path, fileWith({ byte: 0x80 }), { mode: 0o600 });
    const added = depsOf({ files: FILES });
    expect(
      runPrivateTermsAdd({ argv: argvOf({ rest: [...ADD_REST, "--home", home], verb: "add" }), deps: added.deps }),
    ).toBe(0);
    writeFileSync(path, fileWith({ byte: 0x81 }), { mode: 0o600 });
    expect(fileWith({ byte: 0x81 }).toString("utf8")).toBe(fileWith({ byte: 0x80 }).toString("utf8"));
    const confirmed = depsOf();
    expect(
      runPrivateTermsConfirm({
        argv: argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" }),
        deps: confirmed.deps,
      }),
    ).toBe(1);
    expect(readFileSync(path)).toStrictEqual(fileWith({ byte: 0x81 }));
  });

  it("withholds a line carrying the home path when a term on the list matches it", () => {
    const home = mkdtempSync(join(tmpdir(), "zephyrine-home-"));
    homes.push(home);
    writePrivateTerms({ home, rows: ["person\ti\tzephyrine\tsynthetic"] });
    const added = depsOf({ files: FILES });
    expect(
      runPrivateTermsAdd({ argv: argvOf({ rest: [...ADD_REST, "--home", home], verb: "add" }), deps: added.deps }),
    ).toBe(0);
    expect(added.out[0]).toBe("proposal pp-00000000000a: add pt-00000000000b (person, case-insensitive)");
    expect(added.out.at(-1)).toBe(WITHHELD_REFUSAL_LINE);
    expect(added.out.join("\n").toLowerCase()).not.toContain("zephyrine");
  });
});

describe("the confirm lock", () => {
  it("refuses while a live process holds it, and clears one whose holder is gone", () => {
    const home = freshHome();
    const added = depsOf({ files: FILES });
    expect(
      runPrivateTermsAdd({ argv: argvOf({ rest: [...ADD_REST, "--home", home], verb: "add" }), deps: added.deps }),
    ).toBe(0);
    const lock = `${stateHomePaths({ home }).privateTerms}.lock`;
    writeFileSync(lock, "4242\n");
    const held = confirmPrivateTermsProposal({ home, pidAlive: () => true, proposalId: "pp-00000000000a" });
    expect(unwrapErr(held).code).toBe("LOCK_HELD");
    const cleared = confirmPrivateTermsProposal({ home, pidAlive: () => false, proposalId: "pp-00000000000a" });
    expect(unwrap(cleared).rows).toBe(1);
    expect(existsSync(lock)).toBe(false);
  });
});

describe("private-terms narrow and remove", () => {
  it("narrows a four-cell row by its line alias and removes it by its new id", () => {
    const home = freshHome();
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const narrowed = depsOf();
    expect(
      runPrivateTermsNarrow({
        argv: argvOf({ rest: ["line-2", "--meaning", "a colleague at acme", "--home", home], verb: "narrow" }),
        deps: narrowed.deps,
      }),
    ).toBe(0);
    expect(narrowed.out[0]).toBe("proposal pp-00000000000a: narrow pt-00000000000a (person, case-insensitive)");
    expect(
      runPrivateTermsConfirm({
        argv: argvOf({ rest: ["pp-00000000000a", "--home", home], verb: "confirm" }),
        deps: depsOf().deps,
      }),
    ).toBe(0);

    const removed = depsOf({ proposalIds: ["pp-00000000000b"] });
    expect(
      runPrivateTermsRemove({
        argv: argvOf({ rest: ["pt-00000000000a", "--home", home], verb: "remove" }),
        deps: removed.deps,
      }),
    ).toBe(0);
    expect(removed.out[0]).toBe("proposal pp-00000000000b: remove pt-00000000000a");
  });

  it("answers usage for a row that is not there", () => {
    const home = freshHome();
    writePrivateTerms({ home });
    const run = depsOf();
    expect(
      runPrivateTermsRemove({
        argv: argvOf({ rest: ["pt-0000000000ff", "--home", home], verb: "remove" }),
        deps: run.deps,
      }),
    ).toBe(2);
  });
});

describe("private-terms list", () => {
  it("names each row by id, class and case, and every waiting proposal, never a pattern", () => {
    const home = freshHome();
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    const added = depsOf({
      files: { "/fixture/other.txt": "inkwell" },
      termIds: ["pt-00000000000b", "pt-00000000000c"],
    });
    const rest = [
      "--class",
      "person",
      "--case",
      "sensitive",
      "--pattern-file",
      "/fixture/other.txt",
      "--meaning",
      "a colleague at acme",
      "--allowed-where",
      "nowhere",
      "--source",
      "relay:acme-row",
      "--home",
      home,
    ];
    expect(runPrivateTermsAdd({ argv: argvOf({ rest, verb: "add" }), deps: added.deps })).toBe(0);
    const listed = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", home], verb: "list" }), deps: listed.deps })).toBe(0);
    expect(listed.out).toStrictEqual([
      "line-2  person  case-insensitive  refuses on a match (no meaning), names nowhere it is fine",
      "1 row(s)",
      "waiting: proposal pp-00000000000a to add pt-00000000000c, owner unanswered (current)",
    ]);
  });

  it("refuses when there is no terms file", () => {
    const run = depsOf();
    expect(runPrivateTermsList({ argv: argvOf({ rest: ["--home", freshHome()], verb: "list" }), deps: run.deps })).toBe(
      1,
    );
  });
});
