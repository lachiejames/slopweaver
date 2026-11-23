/**
 * An install's proposal destination: the strict schema it is read with, and the store that holds it.
 *
 * The property that matters is that nothing ever reads as a destination the install did not choose — an
 * absent file is UNSET (never a default), and a present-but-wrong one is INVALID or UNREADABLE (never unset).
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { unwrap } from "../../../../lib/result.js";
import {
  describeProposalDestination,
  PROPOSAL_DESTINATION_SCHEMA_VERSION,
  type ProposalDestination,
  parseProposalDestination,
} from "../../../../outbound/proposal/destination.js";
import { ProposalDestinationErrors } from "../../../../outbound/proposal/destinationErrors.js";
import {
  proposalDestinationPath,
  readProposalDestination,
  writeProposalDestination,
} from "../../../../outbound/proposal/destinationStore.js";

const PARENT = "00000000-0000-0000-0000-00000000a001";
const NOTION: ProposalDestination = {
  kind: "notion-page",
  parent: PARENT,
  schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION,
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-destination-"));
  dirs.push(dir);
  return dir;
}

describe("parseProposalDestination", () => {
  it("reads a notion-page destination exactly", () => {
    const parsed = parseProposalDestination({ path: "/x", raw: { ...NOTION } });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual(NOTION);
  });

  it("refuses a misspelt key rather than reading a destination with no parent", () => {
    const parsed = parseProposalDestination({
      path: "/x/destination.json",
      raw: { kind: "notion-page", parnet: PARENT, schemaVersion: 1 },
    });
    expect(parsed._unsafeUnwrapErr().code).toBe("DESTINATION_INVALID");
    expect(parsed._unsafeUnwrapErr().message).toContain('unknown field "parnet"');
  });

  it("refuses a kind this build does not know", () => {
    const parsed = parseProposalDestination({ path: "/x", raw: { kind: "somewhere-else", schemaVersion: 1 } });
    expect(parsed._unsafeUnwrapErr().code).toBe("DESTINATION_INVALID");
  });

  it("refuses a schema version written by a later build", () => {
    const parsed = parseProposalDestination({ path: "/x", raw: { ...NOTION, schemaVersion: 2 } });
    expect(parsed._unsafeUnwrapErr().code).toBe("DESTINATION_INVALID");
  });

  it("refuses a parent carrying whitespace, naming the key it sits on", () => {
    const parsed = parseProposalDestination({ path: "/x", raw: { ...NOTION, parent: "a page" } });
    expect(parsed._unsafeUnwrapErr()).toEqual(
      ProposalDestinationErrors.invalid({ issues: ["parent: must not contain whitespace"], path: "/x" }),
    );
  });

  it("refuses a parent of Unicode whitespace that `\\s` does not match (U+0085)", () => {
    const parsed = parseProposalDestination({ path: "/x", raw: { ...NOTION, parent: "\u0085" } });
    expect(parsed._unsafeUnwrapErr()).toEqual(
      ProposalDestinationErrors.invalid({ issues: ["parent: must not contain whitespace"], path: "/x" }),
    );
  });

  it("refuses a parent the Notion door could not create under, rather than storing it for a publish to fail on", () => {
    const parsed = parseProposalDestination({ path: "/x", raw: { ...NOTION, parent: "x" } });
    expect(parsed._unsafeUnwrapErr()).toEqual(
      ProposalDestinationErrors.invalid({
        issues: [
          "parent: must be a Notion page UUID or a https://*.notion.so/... or https://app.notion.com/... URL ending in its 32-hex id",
        ],
        path: "/x",
      }),
    );
  });

  it("accepts a Notion page URL as the parent, exactly as written", () => {
    const parent = "https://app.notion.com/p/Proposals-0000000000000000000000000000a001";
    const parsed = parseProposalDestination({ path: "/x", raw: { ...NOTION, parent } });
    expect(unwrap(parsed)).toEqual({ ...NOTION, parent });
  });
});

describe("describeProposalDestination", () => {
  it("names the kind and the parent", () => {
    expect(describeProposalDestination({ destination: NOTION })).toBe(`notion-page under ${PARENT}`);
  });
});

describe("the destination store", () => {
  it("reports an install with nothing set as UNSET, naming the file and the command that sets one", () => {
    const at = home();
    const read = readProposalDestination({ home: at });
    expect(read._unsafeUnwrapErr()).toEqual(
      ProposalDestinationErrors.unset({
        hint:
          "slopweaver proposal destination set notion-page --parent <page-id-or-url> | local-page " +
          "| linear-document --target-kind <project|initiative|issue|team> --target-id <id>",
        path: proposalDestinationPath({ home: at }),
      }),
    );
  });

  it("round-trips what it writes, under proposals/config", () => {
    const at = home();
    const written = writeProposalDestination({ destination: NOTION, home: at });
    expect(unwrap(written)).toBe(join(at, "proposals", "config", "destination.json"));
    expect(unwrap(readProposalDestination({ home: at }))).toEqual(NOTION);
  });

  it("writes the file owner read-write exactly, so a restrictive umask cannot leave it unreadable", () => {
    const at = home();
    const path = unwrap(writeProposalDestination({ destination: NOTION, home: at }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reports a write it cannot read back as failed, so set never succeeds on a file show would refuse", () => {
    const at = home();
    const written = writeProposalDestination({ destination: { ...NOTION, parent: "x" }, home: at });
    expect(written._unsafeUnwrapErr().code).toBe("DESTINATION_WRITE_FAILED");
    expect(written._unsafeUnwrapErr().message).toContain("written, but reading it back failed");
  });

  it("reports a file that is not JSON as UNREADABLE, never as unset", () => {
    const at = home();
    writeFileAtomic({ contents: "{", path: proposalDestinationPath({ home: at }) });
    expect(readProposalDestination({ home: at })._unsafeUnwrapErr().code).toBe("DESTINATION_UNREADABLE");
  });

  it("reports a JSON file that is not a destination as INVALID", () => {
    const at = home();
    writeFileAtomic({ contents: "[]", path: proposalDestinationPath({ home: at }) });
    expect(readProposalDestination({ home: at })._unsafeUnwrapErr().code).toBe("DESTINATION_INVALID");
  });
});
