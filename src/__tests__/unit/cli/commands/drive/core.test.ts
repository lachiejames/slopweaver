/** Unit: the pure `drive` argument parsers — every refusal here happens before a credential is read. */
import { describe, expect, it } from "vitest";
import {
  parseDriveConnectArgs,
  parseDriveDrivesArgs,
  parseDriveListArgs,
  parseDriveReadArgs,
} from "../../../../../cli/commands/drive/core.js";
import { driveErrorLines } from "../../../../../cli/commands/drive/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { DEFAULT_LIST_LIMIT } from "../../../../../live/drive/read.js";

describe("parseDriveConnectArgs", () => {
  it("defaults to the NARROW grant, which cannot read a file's content", () => {
    expect(unwrap(parseDriveConnectArgs({ rest: [] })).capabilities).toStrictEqual(["metadata"]);
  });

  it("asks for both capabilities on --grant read", () => {
    expect(unwrap(parseDriveConnectArgs({ rest: ["--grant", "read"] })).capabilities).toStrictEqual([
      "metadata",
      "content",
    ]);
  });

  it("asks --grant write for the per-file and Docs write scopes on top of everything read holds", () => {
    // The owner's ruling as a grant. `drive.file` creates and reaches only what this application made;
    // `documents` edits the Docs the owner already owns. Full `/auth/drive` — the one that can wipe a shared
    // drive — is absent, and `actsOnlyAsTheBoundAccount.test.ts` is what keeps it absent.
    const parsed = parseDriveConnectArgs({ rest: ["--grant", "write"] });
    expect(unwrap(parsed).capabilities).toStrictEqual(["metadata", "content", "write", "docs"]);
  });

  it("asks for no write scope on the default grant, so reading never widens by accident", () => {
    expect(unwrap(parseDriveConnectArgs({ rest: [] })).capabilities).toStrictEqual(["metadata"]);
  });

  it("carries --revoke through to the shell as a request to withdraw, not to consent", () => {
    const parsed = parseDriveConnectArgs({ rest: ["--revoke"] });
    expect(unwrap(parsed).revoke).toBe(true);
    expect(unwrap(parsed).statusOnly).toBe(false);
  });

  it("leaves revoke false when the flag is absent", () => {
    expect(unwrap(parseDriveConnectArgs({ rest: [] })).revoke).toBe(false);
  });

  it("refuses an unknown grant name and names the accepted ones", () => {
    const refusal = unwrapErr(parseDriveConnectArgs({ rest: ["--grant", "everything"] }));
    expect([refusal.code, refusal.message]).toEqual([
      "INVALID_FLAG_VALUE",
      "unknown --grant: everything (expected metadata | read | write)",
    ]);
    expect(driveErrorLines({ error: refusal }).at(-1)).toContain("usage: slopweaver drive connect");
  });

  it("carries --status and --home through", () => {
    const args = unwrap(parseDriveConnectArgs({ rest: ["--status", "--home", "/tmp/h"] }));
    expect(args.statusOnly).toBe(true);
    expect(args.home).toBe("/tmp/h");
  });
});

describe("parseDriveListArgs", () => {
  it("defaults the limit and leaves every restriction absent", () => {
    const args = unwrap(parseDriveListArgs({ rest: [] }));
    expect(args.limit).toBe(DEFAULT_LIST_LIMIT);
    expect(args.query).toBe(undefined);
    expect(args.folderId).toBe(undefined);
    expect(args.driveId).toBe(undefined);
    expect(args.includeTrashed).toBe(false);
  });

  it("carries the query, the folder, the shared drive and --trashed", () => {
    const args = unwrap(
      parseDriveListArgs({
        rest: ["--query", "name contains 'x'", "--folder", "1F", "--drive", "0AD", "--trashed", "--limit", "50"],
      }),
    );
    expect(args.query).toBe("name contains 'x'");
    expect(args.folderId).toBe("1F");
    expect(args.driveId).toBe("0AD");
    expect(args.includeTrashed).toBe(true);
    expect(args.limit).toBe(50);
  });

  it("refuses a limit past Drive's own maximum rather than silently clamping it", () => {
    const result = parseDriveListArgs({ rest: ["--limit", "500"] });
    expect(unwrapErr(result).code).toBe("INVALID_FLAG_VALUE");
    expect(driveErrorLines({ error: unwrapErr(result) })[0]).toBe("--limit must be an integer between 1 and 100");
  });

  it("refuses a non-integer limit", () => {
    const result = parseDriveListArgs({ rest: ["--limit", "twenty"] });
    expect(unwrapErr(result).code).toBe("INVALID_FLAG_VALUE");
    expect(driveErrorLines({ error: unwrapErr(result) })[0]).toBe("--limit must be an integer between 1 and 100");
  });

  it("refuses a zero limit, which would read nothing while looking like a successful call", () => {
    const result = parseDriveListArgs({ rest: ["--limit", "0"] });
    expect(driveErrorLines({ error: unwrapErr(result) })[0]).toBe("--limit must be an integer between 1 and 100");
  });
});

describe("parseDriveReadArgs", () => {
  it("takes the address positionally and exports text by default", () => {
    const args = unwrap(parseDriveReadArgs({ rest: ["1AbCdEfGhIjK"] }));
    expect(args.address).toBe("1AbCdEfGhIjK");
    expect(args.withText).toBe(true);
  });

  it("turns text off for --metadata-only", () => {
    expect(unwrap(parseDriveReadArgs({ rest: ["1AbCdEfGhIjK", "--metadata-only"] })).withText).toBe(false);
  });

  it("refuses a missing address, having read nothing", () => {
    const result = parseDriveReadArgs({ rest: [] });
    expect(unwrapErr(result).code).toBe("ARGUMENT_MISSING");
    expect(driveErrorLines({ error: unwrapErr(result) })[0]).toBe("missing <file-id-or-url>");
  });

  it("refuses a leading flag where the address belongs, rather than treating it as an id", () => {
    const result = parseDriveReadArgs({ rest: ["--json"] });
    expect(driveErrorLines({ error: unwrapErr(result) })[0]).toBe("missing <file-id-or-url>");
  });

  it("does NOT validate the address itself — that is the Drive domain's own typed refusal", () => {
    expect(unwrap(parseDriveReadArgs({ rest: ["not-an-id"] })).address).toBe("not-an-id");
  });
});

describe("parseDriveDrivesArgs", () => {
  it("takes --json and --home and nothing else", () => {
    const args = unwrap(parseDriveDrivesArgs({ rest: ["--json", "--home", "/tmp/h"] }));
    expect(args.json).toBe(true);
    expect(args.home).toBe("/tmp/h");
  });

  it("refuses an unknown flag", () => {
    const result = parseDriveDrivesArgs({ rest: ["--all"] });
    const lines = driveErrorLines({ error: unwrapErr(result) });
    expect(lines[0]).toBe("unknown flag: --all");
    expect(lines.at(-1)).toContain("usage: slopweaver drive drives");
  });
});
