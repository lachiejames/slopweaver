/**
 * `proposal destination set|show` — the parser and the shell, each edge a plain injected function.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { parseProposalDestinationArgs } from "../../../../../cli/commands/proposal/destinationCore.js";
import { runProposalDestination } from "../../../../../cli/commands/proposal/destinationRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import { proposalDestinationPath, readProposalDestination } from "../../../../../outbound/proposal/destinationStore.js";

const PARENT = "39100000-0000-8102-a2f7-d1d8ef1fe6b0";
const PROJECT = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-destination-run-"));
  dirs.push(dir);
  return dir;
}

function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "proposal", "destination", ...rest];
}

function harness(): {
  deps: { out: (line: string) => void; err: (line: string) => void };
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return { deps: { err: (line) => err.push(line), out: (line) => out.push(line) }, err, out };
}

describe("parseProposalDestinationArgs", () => {
  it("parses set notion-page into the stored shape", () => {
    const parsed = parseProposalDestinationArgs({ rest: ["set", "notion-page", "--parent", PARENT] });
    expect(unwrap(parsed)).toEqual({
      action: "set",
      destination: { kind: "notion-page", parent: PARENT, schemaVersion: 1 },
      home: undefined,
      json: false,
    });
  });

  it("parses show", () => {
    expect(unwrap(parseProposalDestinationArgs({ rest: ["show", "--json"] }))).toEqual({
      action: "show",
      home: undefined,
      json: true,
    });
  });

  it("refuses a missing action with the usage line", () => {
    expect(parseProposalDestinationArgs({ rest: [] })._unsafeUnwrapErr().code).toBe("USAGE");
  });

  it("refuses set with no kind", () => {
    expect(parseProposalDestinationArgs({ rest: ["set", "--parent", PARENT] })._unsafeUnwrapErr().code).toBe("USAGE");
  });

  it("refuses a kind this build cannot publish to, listing the ones it can", () => {
    const error = parseProposalDestinationArgs({ rest: ["set", "a-wiki"] })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_KIND_UNKNOWN");
    expect(error.message).toBe(
      '"a-wiki" is not a proposal destination this build can publish to — it is one of notion-page, local-page, linear-document',
    );
  });

  it("parses set local-page, which takes no field of its own", () => {
    expect(unwrap(parseProposalDestinationArgs({ rest: ["set", "local-page", "--json"] }))).toEqual({
      action: "set",
      destination: { kind: "local-page", schemaVersion: 1 },
      home: undefined,
      json: true,
    });
  });

  it("refuses --parent on local-page rather than silently dropping it", () => {
    const error = parseProposalDestinationArgs({ rest: ["set", "local-page", "--parent", PARENT] })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_FIELD_INVALID");
    expect(error.message).toBe("--parent is a notion-page flag; a local page has none");
  });

  it("refuses notion-page with no parent", () => {
    const error = parseProposalDestinationArgs({ rest: ["set", "notion-page"] })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_FIELD_INVALID");
    expect(error.message).toContain("--parent <page-id-or-url> is required");
  });

  it("refuses a parent the stored schema would refuse", () => {
    const error = parseProposalDestinationArgs({
      rest: ["set", "notion-page", "--parent", "a page"],
    })._unsafeUnwrapErr();
    expect(error.message).toBe("--parent must not contain whitespace");
  });

  it("refuses a parent that is no Notion page address, so set never stores one publish would fail on", () => {
    const error = parseProposalDestinationArgs({ rest: ["set", "notion-page", "--parent", "x"] })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_FIELD_INVALID");
    expect(error.message).toContain("must be a Notion page UUID");
  });

  it("refuses --parent on show, which only reads", () => {
    const error = parseProposalDestinationArgs({ rest: ["show", "--parent", PARENT] })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_FIELD_INVALID");
  });

  it("parses set linear-document into the stored shape", () => {
    const parsed = parseProposalDestinationArgs({
      rest: ["set", "linear-document", "--target-kind", "project", "--target-id", PROJECT],
    });
    expect(unwrap(parsed)).toEqual({
      action: "set",
      destination: { kind: "linear-document", schemaVersion: 1, target: { id: PROJECT, kind: "project" } },
      home: undefined,
      json: false,
    });
  });

  it("refuses linear-document with no --target-id, naming the flag", () => {
    const error = parseProposalDestinationArgs({
      rest: ["set", "linear-document", "--target-kind", "team"],
    })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_FIELD_INVALID");
    expect(error.message).toContain("--target-id is required");
  });

  it("refuses a target kind a Linear document cannot belong to, naming --target-kind", () => {
    const error = parseProposalDestinationArgs({
      rest: ["set", "linear-document", "--target-kind", "cycle", "--target-id", PROJECT],
    })._unsafeUnwrapErr();
    expect(error.code).toBe("DESTINATION_FIELD_INVALID");
    expect(error.message).toContain("--target-kind");
  });

  it("refuses --parent on linear-document, and a Linear flag on notion-page", () => {
    const parent = parseProposalDestinationArgs({
      rest: ["set", "linear-document", "--target-kind", "team", "--target-id", PROJECT, "--parent", PARENT],
    })._unsafeUnwrapErr();
    expect(parent.message).toBe("--parent is a notion-page flag; a Linear document has none");
    const target = parseProposalDestinationArgs({
      rest: ["set", "notion-page", "--parent", PARENT, "--target-id", PROJECT],
    })._unsafeUnwrapErr();
    expect(target.message).toBe("--target-id is a linear-document flag; a Notion page has none");
  });

  it("refuses a Linear flag on show", () => {
    const error = parseProposalDestinationArgs({ rest: ["show", "--target-kind", "team"] })._unsafeUnwrapErr();
    expect(error.message).toBe("--target-kind is a `set` flag; `show` only reads");
  });
});

describe("runProposalDestination", () => {
  it("shows nothing set as a status, naming the command that sets one", () => {
    const h = harness();
    const at = home();
    const code = runProposalDestination({ argv: argv({ rest: ["show", "--home", at] }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.err[0]).toContain("slopweaver proposal destination set notion-page --parent <page-id-or-url>");
  });

  it("sets, then shows, the same destination", () => {
    const at = home();
    const set = harness();
    expect(
      runProposalDestination({
        argv: argv({ rest: ["set", "notion-page", "--parent", PARENT, "--home", at] }),
        deps: set.deps,
      }),
    ).toBe(EXIT_OK);
    expect(set.out).toEqual([`proposals now publish to notion-page under ${PARENT}`]);
    expect(set.err).toEqual([`wrote ${proposalDestinationPath({ home: at })}`]);
    expect(unwrap(readProposalDestination({ home: at })).kind).toBe("notion-page");

    const show = harness();
    expect(runProposalDestination({ argv: argv({ rest: ["show", "--home", at] }), deps: show.deps })).toBe(EXIT_OK);
    expect(show.out).toEqual([`notion-page under ${PARENT}`]);
  });

  it("sets, then shows, a local-page destination", () => {
    const at = home();
    const set = harness();
    expect(runProposalDestination({ argv: argv({ rest: ["set", "local-page", "--home", at] }), deps: set.deps })).toBe(
      EXIT_OK,
    );
    expect(set.out).toEqual(["proposals now publish to local-page under the state home's pages/"]);
    const show = harness();
    expect(runProposalDestination({ argv: argv({ rest: ["show", "--home", at] }), deps: show.deps })).toBe(EXIT_OK);
    expect(show.out).toEqual(["local-page under the state home's pages/"]);
  });

  it("sets, then shows, a linear-document destination", () => {
    const at = home();
    const set = harness();
    expect(
      runProposalDestination({
        argv: argv({
          rest: ["set", "linear-document", "--target-kind", "project", "--target-id", PROJECT, "--home", at],
        }),
        deps: set.deps,
      }),
    ).toBe(EXIT_OK);
    expect(set.out).toEqual([`proposals now publish to linear-document under Linear project ${PROJECT}`]);
    const show = harness();
    expect(runProposalDestination({ argv: argv({ rest: ["show", "--home", at] }), deps: show.deps })).toBe(EXIT_OK);
    expect(show.out).toEqual([`linear-document under Linear project ${PROJECT}`]);
  });

  it("reports an invalid file as an error, never as unset", () => {
    const at = home();
    writeFileAtomic({ contents: '{"kind":"notion-page"}', path: proposalDestinationPath({ home: at }) });
    const h = harness();
    expect(runProposalDestination({ argv: argv({ rest: ["show", "--home", at] }), deps: h.deps })).toBe(EXIT_ERROR);
  });

  it("refuses a malformed invocation before touching the home", () => {
    const at = home();
    const h = harness();
    expect(runProposalDestination({ argv: argv({ rest: ["set", "a-wiki", "--home", at] }), deps: h.deps })).toBe(
      EXIT_USAGE,
    );
    expect(readProposalDestination({ home: at })._unsafeUnwrapErr().code).toBe("DESTINATION_UNSET");
  });
});
