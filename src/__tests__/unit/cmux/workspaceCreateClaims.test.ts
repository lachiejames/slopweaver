/**
 * The create claims a lost `workspace.create` reply must never adopt: absent is none, unreadable is a refusal, and a
 * recorded claim reads back newest last within its bound. Round-trips a throwaway home made with `mkdtempSync`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_WORKSPACE_CREATE_CLAIMS,
  parseWorkspaceCreateClaims,
  readWorkspaceCreateClaims,
  recordWorkspaceCreateClaim,
  WorkspaceCreateClaimsErrors,
  withWorkspaceCreateClaim,
  workspaceCreateClaimsPath,
} from "../../../cmux/workspaceCreateClaims.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const KEY = "cmux-create:/repo/a-doc\u0000+spawned session";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-create-claims-"));
  homes.push(home);
  return home;
}

describe("workspace create claims", () => {
  it("reads no claims from a home where no create under the key has answered", () => {
    expect(unwrap(readWorkspaceCreateClaims({ home: freshHome(), key: KEY }))).toEqual([]);
  });

  it("reads back a recorded claim, appended after the ones already there", () => {
    const home = freshHome();

    unwrap(recordWorkspaceCreateClaim({ claims: ["A"], home, key: KEY, workspaceId: "B" }));

    expect(unwrap(readWorkspaceCreateClaims({ home, key: KEY }))).toEqual(["A", "B"]);
  });

  it("keeps each key's claims apart", () => {
    const home = freshHome();

    unwrap(recordWorkspaceCreateClaim({ claims: [], home, key: KEY, workspaceId: "A" }));

    expect(unwrap(readWorkspaceCreateClaims({ home, key: `${KEY}-other` }))).toEqual([]);
  });

  it("refuses a claims file that is not one, rather than reading it as no claims", () => {
    const home = freshHome();
    const path = workspaceCreateClaimsPath({ home, key: KEY });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");

    const failure = unwrapErr(readWorkspaceCreateClaims({ home, key: KEY }));
    expect(failure.code).toBe("CLAIMS_MALFORMED");
    expect(failure.message).toContain(`${path} is not a create-claims file: not JSON`);
  });

  it("refuses a claims object whose ids are not all strings", () => {
    const failure = parseWorkspaceCreateClaims({ path: "/c.json", text: '{"workspaceIds":["A",4]}' });

    expect(unwrapErr(failure)).toEqual(
      WorkspaceCreateClaimsErrors.malformed({
        path: "/c.json",
        why: "its workspaceIds is not a list of workspace ids",
      }),
    );
  });

  it("refuses a claims path that is a directory as unreadable, never as no claims", () => {
    const home = freshHome();
    mkdirSync(workspaceCreateClaimsPath({ home, key: KEY }), { recursive: true });

    expect(unwrapErr(readWorkspaceCreateClaims({ home, key: KEY })).code).toBe("CLAIMS_UNREADABLE");
  });

  it("moves a re-claimed id to the end and keeps only the newest within the bound", () => {
    const full = Array.from({ length: MAX_WORKSPACE_CREATE_CLAIMS }, (_, index) => `W${String(index)}`);

    const claims = withWorkspaceCreateClaim({ claims: full, workspaceId: "W0" });
    const grown = withWorkspaceCreateClaim({ claims: full, workspaceId: "NEW" });

    expect(claims.length).toBe(MAX_WORKSPACE_CREATE_CLAIMS);
    expect(claims.at(-1)).toBe("W0");
    expect(grown.length).toBe(MAX_WORKSPACE_CREATE_CLAIMS);
    expect([grown[0], grown.at(-1)]).toEqual(["W1", "NEW"]);
  });
});
