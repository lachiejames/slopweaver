import { describe, expect, it } from "vitest";
import { parseProviderReadArgs } from "../../../../cli/commands/providerRead/core.js";
import { ProviderReadArgsErrors } from "../../../../cli/commands/providerRead/errors.js";
import { type ProviderReadDeps, runProviderRead } from "../../../../cli/commands/providerRead/run.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { ProviderReadDocument } from "../../../../live/providerRead.js";

const document: ProviderReadDocument = {
  coverage: { detail: "one object", kind: "bounded", residue: [] },
  data: { title: "Current" },
  readAtIso: "2026-08-09T12:00:00.000Z",
  source: "linear",
  target: { address: "AIL-1", identity: "AIL-1", kind: "issue" },
};

function depsFor({ out, diagnostic }: { out: string[]; diagnostic: string[] }): ProviderReadDeps {
  return {
    github: () => Promise.resolve(ok({ ...document, source: "github" })),
    linear: () => Promise.resolve(ok(document)),
    notion: () => Promise.resolve(ok({ ...document, source: "notion" })),
    writeDiagnostic: (line) => diagnostic.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("parseProviderReadArgs", () => {
  it("accepts free-text routed input and defaults Notion to a bounded page", () => {
    expect(
      unwrap(
        parseProviderReadArgs({
          provider: "notion",
          rest: ["read", "this", "page", "--json", "--home", "/h", "--limit", "12"],
        }),
      ),
    ).toEqual({
      address: "read this page",
      // GitHub pull requests' alone, and off unless asked for: a patch per file is a second provider call.
      files: false,
      home: "/h",
      // Nothing was asked for, so nothing will be read beyond the object itself.
      include: {},
      json: true,
      limit: 12,
      // GitHub's alone, and off unless asked for: nothing is written to disk by a plain read.
      mediaOut: undefined,
      // A page read expands its nested blocks under the corpus's measured per-item request bound.
      nestedCalls: 400,
      notionKind: "page",
      // Off unless asked for, on every provider that has it: opening files costs a round trip each.
      pdf: false,
    });
  });

  it("defaults each activity slice to 25 and refuses a limit above the provider cap", () => {
    expect(unwrap(parseProviderReadArgs({ provider: "linear", rest: ["AIL-1"] })).limit).toBe(25);
    expect(unwrapErr(parseProviderReadArgs({ provider: "linear", rest: ["AIL-1", "--limit", "101"] }))).toEqual(
      ProviderReadArgsErrors.limitOutOfRange({ got: "101", max: 100 }),
    );
  });

  it("reports the first refusal in flag order: kind, then limit, then the cursor and the nested ceiling", () => {
    const rest = ["db-id", "--limit", "0", "--after", "c1", "--nested-calls", "10"];
    expect(unwrapErr(parseProviderReadArgs({ provider: "notion", rest: [...rest, "--kind", "table"] }))).toEqual(
      ProviderReadArgsErrors.kindUnknown({ got: "table" }),
    );
    expect(unwrapErr(parseProviderReadArgs({ provider: "notion", rest: [...rest, "--kind", "database"] }))).toEqual(
      ProviderReadArgsErrors.limitOutOfRange({ got: "0", max: 100 }),
    );
  });

  it("refuses a Notion-only flag on another provider", () => {
    expect(unwrapErr(parseProviderReadArgs({ provider: "github", rest: ["a-url", "--kind", "page"] }))).toEqual(
      ProviderReadArgsErrors.flagsInvalid({ reasons: ["unknown flag: --kind"] }),
    );
  });
});

describe("runProviderRead", () => {
  it("emits exactly one JSON document from the selected reader", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const code = await runProviderRead({
      deps: depsFor({ diagnostic, out }),
      provider: "linear",
      rest: ["AIL-1", "--json"],
    });

    expect(code).toBe(0);
    expect(diagnostic).toEqual([]);
    expect(out).toEqual([JSON.stringify(document, undefined, 2)]);
  });

  it("refuses a missing address before a provider edge is called", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    const code = await runProviderRead({ deps: depsFor({ diagnostic, out }), provider: "github", rest: [] });

    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(diagnostic[0]).toBe("a github object address is required");
  });
});

describe("parseProviderReadArgs --after", () => {
  it("defaults the cursor to undefined so an opening read asks Notion for no start_cursor", () => {
    expect(unwrap(parseProviderReadArgs({ provider: "notion", rest: ["page-id"] })).after).toBeUndefined();
  });

  it("forwards an opaque cursor byte for byte rather than parsing it as a block id", () => {
    const cursor = "not-a-uuid|38e5f00d~opaque";
    expect(unwrap(parseProviderReadArgs({ provider: "notion", rest: ["page-id", "--after", cursor] })).after).toBe(
      cursor,
    );
  });

  it("refuses an empty cursor, which would silently restart the page from its beginning", () => {
    const error = unwrapErr(parseProviderReadArgs({ provider: "notion", rest: ["page-id", "--after", ""] }));
    expect(error).toEqual(ProviderReadArgsErrors.afterEmpty({ got: "" }));
    expect(error.message).toBe("--after must be the non-empty nextCursor from a previous read");
  });

  it("refuses a cursor on a database read, which never lists block children", () => {
    const error = unwrapErr(
      parseProviderReadArgs({ provider: "notion", rest: ["db-id", "--kind", "database", "--after", "c1"] }),
    );
    expect(error.code).toBe("AFTER_ON_DATABASE");
    expect(error.message).toBe(
      "--after applies to a page's top-level blocks; a database read does not list block children",
    );
  });

  it("refuses the flag on github, whose named object has no single continuable connection", () => {
    const error = unwrapErr(parseProviderReadArgs({ provider: "github", rest: ["url", "--after", "c1"] }));
    expect(error.code).toBe("FLAGS_INVALID");
    expect(error.message).toBe("unknown flag: --after");
  });
});

describe("parseProviderReadArgs --nested-calls", () => {
  it("raises the nested expansion's call ceiling up to its maximum", () => {
    expect(
      unwrap(parseProviderReadArgs({ provider: "notion", rest: ["page-id", "--nested-calls", "2000"] })).nestedCalls,
    ).toBe(2000);
  });

  it("refuses a ceiling past the maximum, or not a whole number", () => {
    expect(unwrapErr(parseProviderReadArgs({ provider: "notion", rest: ["p", "--nested-calls", "2001"] }))).toEqual(
      ProviderReadArgsErrors.nestedCallsOutOfRange({ got: "2001", max: 2000 }),
    );
    expect(unwrapErr(parseProviderReadArgs({ provider: "notion", rest: ["p", "--nested-calls", "1.5"] })).message).toBe(
      "--nested-calls must be an integer from 1 to 2000",
    );
  });

  it("refuses it on a database read, which lists no blocks to expand", () => {
    expect(
      unwrapErr(
        parseProviderReadArgs({ provider: "notion", rest: ["db", "--kind", "database", "--nested-calls", "10"] }),
      ).message,
    ).toBe("--nested-calls bounds a page's nested blocks; a database read does not list block children");
  });

  it("is refused as unknown on GitHub and Linear", () => {
    expect(unwrapErr(parseProviderReadArgs({ provider: "linear", rest: ["AIL-1", "--nested-calls", "5"] }))).toEqual(
      ProviderReadArgsErrors.flagsInvalid({ reasons: ["unknown flag: --nested-calls"] }),
    );
  });
});

describe("--include, the option the owner ruled for", () => {
  it("defaults to nothing, so a read that says nothing asks for nothing", () => {
    const parsed = parseProviderReadArgs({ rest: ["AIL-9"], provider: "linear" });

    expect(unwrap(parsed).include).toEqual({});
  });

  it("takes a comma-separated list", () => {
    const parsed = parseProviderReadArgs({ rest: ["AIL-9", "--include", "comments,history"], provider: "linear" });

    expect(unwrap(parsed).include).toEqual({ attachments: false, comments: true, history: true });
  });

  it("REFUSES an unknown name rather than silently dropping it", () => {
    const parsed = parseProviderReadArgs({ rest: ["AIL-9", "--include", "commnets"], provider: "linear" });

    expect(unwrapErr(parsed).code).toBe("INCLUDE_INVALID");
    expect(unwrapErr(parsed).message).toContain("does not know commnets");
  });

  it("names the connections it accepts, so the refusal is actionable", () => {
    const parsed = parseProviderReadArgs({ rest: ["AIL-9", "--include", "everything"], provider: "linear" });

    expect(unwrapErr(parsed).code).toBe("INCLUDE_INVALID");
    expect(unwrapErr(parsed).message).toContain("comments, attachments, history");
  });
});

describe("--media-out, GitHub's body media download", () => {
  it("forwards the directory byte for byte to the GitHub reader", async () => {
    const seen: (string | undefined)[] = [];
    const out: string[] = [];
    const deps: ProviderReadDeps = {
      ...depsFor({ diagnostic: [], out }),
      github: ({ mediaOut }) => {
        seen.push(mediaOut);
        return Promise.resolve(ok({ ...document, source: "github" }));
      },
    };

    const code = await runProviderRead({
      deps,
      provider: "github",
      rest: ["https://github.com/o/r/pull/7", "--media-out", "/tmp/a dir"],
    });

    expect(code).toBe(0);
    expect(seen).toEqual(["/tmp/a dir"]);
  });

  it("is refused as unknown on Linear and Notion before their reader is called", () => {
    expect(unwrapErr(parseProviderReadArgs({ provider: "linear", rest: ["AIL-1", "--media-out", "/d"] }))).toEqual(
      ProviderReadArgsErrors.flagsInvalid({ reasons: ["unknown flag: --media-out"] }),
    );
    expect(unwrapErr(parseProviderReadArgs({ provider: "notion", rest: ["p", "--media-out", "/d"] }))).toEqual(
      ProviderReadArgsErrors.flagsInvalid({ reasons: ["unknown flag: --media-out"] }),
    );
  });

  it("refuses an address in place of a directory, without echoing it", () => {
    const signed = "https://private-user-images.githubusercontent.com/1/a.png?jwt=SECRET-WITNESS";

    const refused = unwrapErr(
      parseProviderReadArgs({ provider: "github", rest: ["https://github.com/o/r/pull/7", "--media-out", signed] }),
    );

    expect(refused).toEqual(ProviderReadArgsErrors.mediaOutAddress());
    expect(JSON.stringify(refused)).not.toContain("SECRET-WITNESS");
    expect(signed).toContain("SECRET-WITNESS");
  });

  it("refuses a blank directory", () => {
    expect(
      unwrapErr(
        parseProviderReadArgs({ provider: "github", rest: ["https://github.com/o/r/pull/7", "--media-out", " "] }),
      ),
    ).toEqual(ProviderReadArgsErrors.mediaOutEmpty({ got: " " }));
  });
});

describe("--files, a pull request's changed files and patches", () => {
  it("forwards the ask to the GitHub reader for a pull request", async () => {
    const seen: boolean[] = [];
    const deps: ProviderReadDeps = {
      ...depsFor({ diagnostic: [], out: [] }),
      github: ({ files }) => {
        seen.push(files);
        return Promise.resolve(ok({ ...document, source: "github" }));
      },
    };

    const code = await runProviderRead({
      deps,
      provider: "github",
      rest: ["https://github.com/o/r/pull/7", "--files"],
    });

    expect(code).toBe(0);
    expect(seen).toEqual([true]);
  });

  it("refuses an issue or a discussion before any reader is called, since neither changes a file", async () => {
    const called: string[] = [];
    const diagnostic: string[] = [];
    const deps: ProviderReadDeps = {
      ...depsFor({ diagnostic, out: [] }),
      github: ({ address }) => {
        called.push(address);
        return Promise.resolve(ok({ ...document, source: "github" }));
      },
    };

    const code = await runProviderRead({
      deps,
      provider: "github",
      rest: ["https://github.com/o/r/issues/7", "--files"],
    });

    expect(code).toBe(2);
    expect(called).toEqual([]);
    expect(diagnostic[0]).toBe(ProviderReadArgsErrors.filesNotPullRequest().message);
    expect(
      unwrapErr(
        parseProviderReadArgs({ provider: "github", rest: ["https://github.com/o/r/discussions/7", "--files"] }),
      ),
    ).toEqual(ProviderReadArgsErrors.filesNotPullRequest());
  });

  it("accepts a pull request named inside routed text, and refuses a repository's list of them", () => {
    expect(
      unwrap(parseProviderReadArgs({ provider: "github", rest: ["see", "https://github.com/o/r/pull/7", "--files"] }))
        .files,
    ).toBe(true);
    expect(
      unwrapErr(parseProviderReadArgs({ provider: "github", rest: ["https://github.com/o/r/pulls", "--files"] })),
    ).toEqual(ProviderReadArgsErrors.filesNotPullRequest());
  });

  it("is refused as unknown on Linear and Notion", () => {
    expect(unwrapErr(parseProviderReadArgs({ provider: "linear", rest: ["AIL-1", "--files"] }))).toEqual(
      ProviderReadArgsErrors.flagsInvalid({ reasons: ["unknown flag: --files"] }),
    );
  });
});
