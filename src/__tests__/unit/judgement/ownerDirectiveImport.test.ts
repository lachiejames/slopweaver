/** The legacy `judgement/owner-directives.json` decoder the owner-judgement store imports once. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { decodeHomeFileOwnerJudgement, readHomeFileOwnerJudgement } from "../../../judgement/ownerDirectiveImport.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const PATH = "/acme/home/judgement/owner-directives.json";

const DIRECTIVE = {
  id: "acme-response-policy",
  source: { contentHash: `sha256:${"a".repeat(64)}`, file: "acme-response-policy.md", modified: null },
  text: "answer acme tickets from the runbook first",
};

const CORRECTION = {
  id: "acme-ticket-correction",
  source: { contentHash: `sha256:${"b".repeat(64)}`, file: "acme-ticket-correction.md", modified: null },
  subject: { container: "C0ACME", source: "slack", sourceId: "1700000000.000100" },
  text: "the ABC-1 outage was the queue, not the database",
};

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("decodeHomeFileOwnerJudgement", () => {
  it("decodes a v2 file into its directives, then its corrections", () => {
    const text = JSON.stringify({ corrections: [CORRECTION], directives: [DIRECTIVE], schemaVersion: 2 });

    expect(unwrap(decodeHomeFileOwnerJudgement({ path: PATH, text }))).toEqual({
      records: [
        { directive: DIRECTIVE, kind: "directive" },
        { correction: CORRECTION, kind: "correction" },
      ],
      state: "present",
    });
  });

  it("refuses bytes that are not JSON as unreadable", () => {
    expect(unwrapErr(decodeHomeFileOwnerJudgement({ path: PATH, text: "{ not json" })).message).toBe(
      `${PATH} could not be imported into the store and was left untouched: it is not valid JSON`,
    );
  });

  it("refuses a well-formed file at another version as OUTDATED, apart from corrupt bytes", () => {
    const text = JSON.stringify({ directives: [DIRECTIVE], schemaVersion: 1 });

    expect(unwrapErr(decodeHomeFileOwnerJudgement({ path: PATH, text })).code).toBe(
      "OWNER_DIRECTIVE_HOME_FILE_OUTDATED",
    );
  });

  it("refuses a v2 file whose directive fails the schema as unreadable", () => {
    const text = JSON.stringify({
      corrections: [],
      directives: [{ ...DIRECTIVE, source: { ...DIRECTIVE.source, contentHash: "sha256:short" } }],
      schemaVersion: 2,
    });

    expect(unwrapErr(decodeHomeFileOwnerJudgement({ path: PATH, text })).code).toBe(
      "OWNER_DIRECTIVE_HOME_FILE_UNREADABLE",
    );
  });
});

describe("readHomeFileOwnerJudgement", () => {
  it("answers absent for a home that never held the file", () => {
    const home = mkdtempSync(`${tmpdir()}/sw-owner-legacy-`);
    homes.push(home);

    expect(unwrap(readHomeFileOwnerJudgement({ home }))).toEqual({ state: "absent" });
  });

  it("refuses a path that is not a regular file as unreadable", () => {
    const home = mkdtempSync(`${tmpdir()}/sw-owner-legacy-`);
    homes.push(home);
    mkdirSync(stateHomePaths({ home }).judgement.ownerDirectivesJson, { recursive: true });

    expect(unwrapErr(readHomeFileOwnerJudgement({ home })).code).toBe("OWNER_DIRECTIVE_HOME_FILE_UNREADABLE");
  });

  it("reads the file a home holds", () => {
    const home = mkdtempSync(`${tmpdir()}/sw-owner-legacy-`);
    homes.push(home);
    const paths = stateHomePaths({ home });
    mkdirSync(paths.judgement.root, { recursive: true });
    writeFileSync(
      paths.judgement.ownerDirectivesJson,
      JSON.stringify({ corrections: [], directives: [DIRECTIVE], schemaVersion: 2 }),
    );

    expect(unwrap(readHomeFileOwnerJudgement({ home }))).toEqual({
      records: [{ directive: DIRECTIVE, kind: "directive" }],
      state: "present",
    });
  });
});
