/**
 * The publication audit store writes one owner-only run directory and `latest.json`, and reads the latest back
 * validated: absent, malformed and a good report are three different answers. A throwaway home only.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  PUBLICATION_AUDIT_FINDINGS_FILE,
  PUBLICATION_AUDIT_LATEST_FILE,
  PUBLICATION_AUDIT_SUMMARY_FILE,
  type PublicationAuditReport,
  publicationAuditRunDirectory,
  readLatestPublicationAudit,
  writePublicationAudit,
} from "../../../../live/publicationAudit/store.js";

const READ_AT = "2026-11-20T02:00:00.000Z";
const LINK = "https://github.com/acme/widgets/pull/46";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pubaudit-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A synthetic report with one finding, written under `run`. */
function report({ run }: { run: string }): PublicationAuditReport {
  return {
    counts: { github: { "private-term/money": 1 } },
    coverage: [{ attachmentsNotSwept: 2, door: "github", gaps: [], objects: 3, state: "complete", texts: 5 }],
    findings: [
      { className: "private-term/money", door: "github", fields: ["body"], findingId: "0123456789abcdef", link: LINK },
    ],
    readAtIso: READ_AT,
    run,
    schemaVersion: 1,
    withheldLinks: 0,
  };
}

/** The permission bits of a path. */
function mode({ path }: { path: string }): number {
  return statSync(path).mode & 0o777;
}

describe("publicationAuditRunDirectory", () => {
  it("names the run by its instant and nonce, under the evidence area, relative to the home for printing", () => {
    expect(publicationAuditRunDirectory({ home: "/tmp/sw-home", nonce: "abcd1234", readAtIso: READ_AT })).toEqual({
      absolute: "/tmp/sw-home/evidence/publication-audit/20261120T020000000Z-abcd1234",
      homeRelative: "evidence/publication-audit/20261120T020000000Z-abcd1234",
    });
  });
});

describe("writePublicationAudit and readLatestPublicationAudit", () => {
  it("writes the findings, the summary and the latest report owner-only, and reads the same report back", () => {
    const directory = publicationAuditRunDirectory({ home, nonce: "abcd1234", readAtIso: READ_AT });
    const written = report({ run: directory.homeRelative });
    expect(writePublicationAudit({ directory: directory.absolute, home, report: written }).isOk()).toBe(true);

    const findingsPath = join(directory.absolute, PUBLICATION_AUDIT_FINDINGS_FILE);
    const summaryPath = join(directory.absolute, PUBLICATION_AUDIT_SUMMARY_FILE);
    const latestPath = join(home, "evidence", "publication-audit", PUBLICATION_AUDIT_LATEST_FILE);
    expect(readFileSync(findingsPath, "utf8")).toBe(`${JSON.stringify(written.findings[0])}\n`);
    expect(JSON.parse(readFileSync(summaryPath, "utf8"))).toEqual({ ...written, findings: 1 });
    expect([mode({ path: findingsPath }), mode({ path: summaryPath }), mode({ path: latestPath })]).toEqual([
      0o600, 0o600, 0o600,
    ]);
    expect(mode({ path: directory.absolute })).toBe(0o700);
    expect(unwrap(readLatestPublicationAudit({ home }))).toEqual(written);
  });

  it("answers absent before any run, naming the verb that runs one", () => {
    const failure = unwrapErr(readLatestPublicationAudit({ home }));
    expect([failure.code, failure.message]).toEqual([
      "REPORT_ABSENT",
      "no publication audit has run here — run `slopweaver audit publications`",
    ]);
  });

  it("answers malformed for a report that is not JSON, and for one carrying a field outside the shape", () => {
    const area = join(home, "evidence", "publication-audit");
    mkdirSync(area, { recursive: true });
    writeFileSync(join(area, PUBLICATION_AUDIT_LATEST_FILE), "{ torn", "utf8");
    expect(unwrapErr(readLatestPublicationAudit({ home })).message).toBe(
      "the last publication audit report is not the expected shape: not JSON",
    );
    const withText = { ...report({ run: "r" }), findings: [{ ...report({ run: "r" }).findings[0], text: "x" }] };
    writeFileSync(join(area, PUBLICATION_AUDIT_LATEST_FILE), JSON.stringify(withText), "utf8");
    const failure = unwrapErr(readLatestPublicationAudit({ home }));
    expect([failure.code, failure.message]).toEqual([
      "REPORT_MALFORMED",
      "the last publication audit report is not the expected shape: fields findings.0",
    ]);
  });
});
