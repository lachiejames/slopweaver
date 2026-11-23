/**
 * The write policy every transport guard reads from one explicit home: fail-closed on the private terms and on an
 * unreadable denylist, an absent denylist normal. Synthetic terms only.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import { WITHHELD_REFUSAL_LINE } from "../../../hygiene/privateTerms.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { loadWritePrivacyPolicy } from "../../../outbound/writePrivacyPolicy.js";
import { stateHomePaths } from "../../../stateHome.js";
import { writePrivateTerms } from "../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { force: true, recursive: true });
});

/** A throwaway home holding `rows` as its private terms, or no terms file when `rows` is undefined. */
function freshHome({ rows }: { rows: readonly string[] | undefined }): string {
  const dir = mkdtempSync(join(tmpdir(), "write-privacy-policy-"));
  homes.push(dir);
  if (rows !== undefined) writePrivateTerms({ home: dir, rows });
  return dir;
}

describe("loadWritePrivacyPolicy", () => {
  it("loads the terms, an absent denylist as empty, and the committed identifier rules", () => {
    const policy = unwrap(
      loadWritePrivacyPolicy({ home: freshHome({ rows: ["person\ti\tquillfeather\tsynthetic"] }) }),
    );
    expect(policy.privateTerms.map((term) => term.className)).toEqual(["person"]);
    expect(policy.denylist).toEqual([]);
    expect(policy.identifierRules).toBe(FORBIDDEN_IDENTIFIER_RULES);
  });

  it("reads a present denylist line by line", () => {
    const home = freshHome({ rows: [] });
    writeFileSync(stateHomePaths({ home }).hygieneDenylist, "zorvane\nacme-internal\n");
    expect(unwrap(loadWritePrivacyPolicy({ home })).denylist).toEqual(["zorvane", "acme-internal"]);
  });

  it("refuses when the private-terms file is absent", () => {
    expect(unwrapErr(loadWritePrivacyPolicy({ home: freshHome({ rows: undefined }) }))).toContain(
      "does not exist, so no outbound write is checked for them",
    );
  });

  it("refuses when the denylist exists and cannot be read", () => {
    const home = freshHome({ rows: [] });
    mkdirSync(stateHomePaths({ home }).hygieneDenylist);
    expect(unwrapErr(loadWritePrivacyPolicy({ home }))).toContain("hygiene-denylist.txt");
  });

  it("withholds that refusal when a term that DID load matches the denylist path it names", () => {
    const home = mkdtempSync(join(tmpdir(), "quillfeather-"));
    homes.push(home);
    writePrivateTerms({ home, rows: ["person\ti\tquillfeather\tsynthetic"] });
    mkdirSync(stateHomePaths({ home }).hygieneDenylist);
    expect(stateHomePaths({ home }).hygieneDenylist).toContain("quillfeather");
    expect(unwrapErr(loadWritePrivacyPolicy({ home }))).toBe(WITHHELD_REFUSAL_LINE);
  });
});
