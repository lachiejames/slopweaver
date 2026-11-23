/**
 * `linear search` — the arg parser and the command shell together, since both are small and share one
 * concern. Every edge is a plain injected function. No mocks.
 */
import { describe, expect, it } from "vitest";
import { linearVerbErrorLines } from "../../../../../cli/commands/linear/errors.js";
import { parseLinearSearchArgs } from "../../../../../cli/commands/linear/searchCore.js";
import { type LinearSearchDeps, runLinearSearch } from "../../../../../cli/commands/linear/searchRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";
import type { LinearSearchDocument } from "../../../../../live/linear/search.js";

const document: LinearSearchDocument = {
  readAtIso: "2026-08-10T12:00:00.000Z",
  results: [
    { id: "i1", identifier: "AIL-9", kind: "issue", title: "Fix the pool", url: "https://linear.app/acme/issue/AIL-9" },
  ],
  source: "linear",
  term: "pool",
};

function depsFor({ out, diagnostic }: { out: string[]; diagnostic: string[] }): LinearSearchDeps {
  return {
    search: () => Promise.resolve(ok(document)),
    writeDiagnostic: (line) => diagnostic.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("parseLinearSearchArgs", () => {
  it("joins free-text positionals into one term and defaults the limit to 10", () => {
    expect(unwrap(parseLinearSearchArgs({ rest: ["source", "routing", "--json", "--home", "/h"] }))).toEqual({
      home: "/h",
      json: true,
      limit: 10,
      term: "source routing",
    });
  });

  it("refuses a missing term before any flag is even read", () => {
    expect(linearVerbErrorLines({ error: unwrapErr(parseLinearSearchArgs({ rest: ["--json"] })) })).toEqual([
      "a search term is required",
    ]);
  });

  it("refuses a limit above the cap", () => {
    expect(
      linearVerbErrorLines({ error: unwrapErr(parseLinearSearchArgs({ rest: ["pool", "--limit", "51"] })) }),
    ).toEqual(["--limit must be an integer from 1 to 50"]);
  });
});

describe("runLinearSearch", () => {
  it("emits exactly one JSON document from the injected search", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const code = await runLinearSearch({ deps: depsFor({ diagnostic, out }), rest: ["pool", "--json"] });

    expect(code).toBe(0);
    expect(diagnostic).toEqual([]);
    expect(out).toEqual([JSON.stringify(document, undefined, 2)]);
  });

  it("refuses a missing term before the search edge is called", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const code = await runLinearSearch({ deps: depsFor({ diagnostic, out }), rest: [] });

    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(diagnostic[0]).toBe("a search term is required");
  });

  it("reports a failed search as an error exit, not a thrown exception", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const deps: LinearSearchDeps = {
      search: () => Promise.resolve(err(LinearLiveErrors.searchFailed({ message: "no Linear token configured" }))),
      writeDiagnostic: (line) => diagnostic.push(line),
      writeOut: (line) => out.push(line),
    };
    const code = await runLinearSearch({ deps, rest: ["pool"] });

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(diagnostic).toEqual(["no Linear token configured"]);
  });
});
