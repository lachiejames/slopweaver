/**
 * `audit references`'s parser and its human report, both pure, and the page publish's self-scan over a recording
 * store write — a publish writes nothing on disk.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { AuditArgsErrors, auditArgsErrorLines } from "../../../../../cli/commands/audit/errors.js";
import {
  parseAuditReferencesArgs,
  publishProofPage,
  referenceReportLines,
  runAuditReferences,
} from "../../../../../cli/commands/audit/referencesRun.js";
import { AUDIT_REFERENCES_USAGE } from "../../../../../cli/commands/audit/referencesUsage.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { ReferenceProof } from "../../../../../hygiene/referenceExport.js";
import { parseReferenceMap } from "../../../../../hygiene/referenceMap.js";
import { ZERO_REFERENCES_PAGE_SLUG } from "../../../../../hygiene/referencePage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { localPagePublisher, publisherWith, recordingWriter } from "../../../../pagePublisherFake.js";

/** The lines a refused tail prints, usage last. */
const refusalLines = ({ rest }: { rest: readonly string[] }): readonly string[] =>
  auditArgsErrorLines({ error: unwrapErr(parseAuditReferencesArgs({ rest })) });

describe("parseAuditReferencesArgs", () => {
  it("defaults to main, the home's map, the page and the summary", () => {
    expect(unwrap(parseAuditReferencesArgs({ rest: [] }))).toEqual({
      home: undefined,
      indirect: false,
      json: false,
      list: false,
      map: undefined,
      page: true,
      ref: "main",
    });
  });

  it("reads every flag", () => {
    const rest = ["--ref", "origin/main", "--map", "/m.tsv", "--home", "/h", "--list", "--no-page", "--json"];
    expect(unwrap(parseAuditReferencesArgs({ rest }))).toEqual({
      home: "/h",
      indirect: false,
      json: true,
      list: true,
      map: "/m.tsv",
      page: false,
      ref: "origin/main",
    });
  });

  it("reads --indirect with the flags it shares", () => {
    const rest = ["--indirect", "--ref", "origin/main", "--no-page", "--home", "/h"];
    expect(unwrap(parseAuditReferencesArgs({ rest }))).toEqual({
      home: "/h",
      indirect: true,
      json: false,
      list: false,
      map: undefined,
      page: false,
      ref: "origin/main",
    });
  });

  it("refuses --indirect beside a direct-only flag, naming each", () => {
    const rest = ["--indirect", "--map", "/m.tsv", "--json"];
    expect(refusalLines({ rest })[0]).toBe(
      "--indirect reads the home's candidate map and writes its report there, so it refuses the direct-only --map, --json",
    );
    expect(unwrapErr(parseAuditReferencesArgs({ rest }))).toEqual(
      AuditArgsErrors.directFlagsConflict({ flags: ["map", "json"], usage: AUDIT_REFERENCES_USAGE }),
    );
  });

  it("refuses an unknown flag and an empty ref, with the usage", () => {
    expect(refusalLines({ rest: ["--fetch"] }).at(-1)).toBe(AUDIT_REFERENCES_USAGE);
    expect(refusalLines({ rest: ["--ref", " "] })).toEqual(["--ref needs a commit-ish", AUDIT_REFERENCES_USAGE]);
    expect(unwrapErr(parseAuditReferencesArgs({ rest: ["--ref", " "] })).code).toBe("REF_MISSING");
  });

  it("exits with the usage code before doing anything on a bad argv", async () => {
    const said: string[] = [];
    const code = await runAuditReferences({
      publish: localPagePublisher,
      rest: ["--bogus"],
      writeDiagnostic: (line) => said.push(line),
      writeOut: () => undefined,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(said.at(-1)).toContain("usage: slopweaver audit references");
  });
});

describe("referenceReportLines", () => {
  const proof: ReferenceProof = {
    committedIso: "2026-10-30T09:00:00Z",
    ref: "main",
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    summary: {
      acceptance: { codeFiles: 1, docsFiles: 0, files: 1, hits: 2 },
      binaryFiles: 1,
      classes: [
        {
          className: "map:people",
          codeFiles: 1,
          docsFiles: 0,
          files: 1,
          hits: 2,
          section: "acceptance",
          source: "map",
        },
        { className: "map:owner", codeFiles: 1, docsFiles: 0, files: 1, hits: 1, section: "own-name", source: "map" },
      ],
      codeFiles: 2,
      docsFiles: 0,
      filesScanned: 10,
      ownName: { codeFiles: 1, docsFiles: 0, files: 1, hits: 1 },
      residue: [
        { area: "code", classes: ["map:owner"], path: "src/a.ts", pathCarriesReference: false },
        { area: "code", classes: ["map:people"], path: "src/b.ts", pathCarriesReference: false },
      ],
      totalHits: 3,
    },
    zipBytes: 100,
    zipPath: "/z/slopweaver-abcdef012345.zip",
  };

  it("prints the commit, the organisation total and its classes, the owner's own name apart, and the residue only under --list", () => {
    const lines = referenceReportLines({ list: false, proof });
    expect(lines[0]).toBe(
      "audit references: main at abcdef012345 exported as a zip with no .git — 10 files (1 binary), every byte and every path scanned",
    );
    expect(lines[2]).toBe("  2 reference(s) to the organisation in 1 file(s) — code 1, docs 0");
    expect(lines[3]).toContain("map:people");
    expect(lines[4]).toBe(
      "  the owner's own name, outside the acceptance and retired by the stateless series: 1 place(s) in 1 file(s)",
    );
    expect(lines[5]).toContain("map:owner");
    expect(lines.length).toBe(6);
    expect(referenceReportLines({ list: true, proof }).at(-1)).toBe("  src/b.ts\tcode\tmap:people");
  });
});

describe("publishProofPage", () => {
  /** A clean proof whose one class is the map's own class. */
  const cleanProof = ({ className }: { className: string }): ReferenceProof => ({
    committedIso: "2026-10-30T09:00:00Z",
    ref: "main",
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    summary: {
      acceptance: { codeFiles: 0, docsFiles: 0, files: 0, hits: 0 },
      binaryFiles: 0,
      classes: [{ className, codeFiles: 0, docsFiles: 0, files: 0, hits: 0, section: "acceptance", source: "map" }],
      codeFiles: 0,
      docsFiles: 0,
      filesScanned: 3,
      ownName: { codeFiles: 0, docsFiles: 0, files: 0, hits: 0 },
      residue: [],
      totalHits: 0,
    },
    zipBytes: 100,
    zipPath: "/z/slopweaver-abcdef012345.zip",
  });

  /** Publish one proof under a one-row map, returning the result, the page's identity path and what the store got. */
  const publish = async ({ mapClass, pattern = "\\bzorblatt\\b" }: { mapClass: string; pattern?: string }) => {
    const home = "/home/acme/.slopweaver";
    const map = unwrap(parseReferenceMap({ text: `class\tflags\tpattern\n${mapClass}\ti\t${pattern}` }));
    const { writer, written } = recordingWriter();
    const result = await publishProofPage({
      home,
      inputs: { denylist: [], map },
      now: new Date("2026-10-30T10:00:00Z"),
      proof: cleanProof({ className: `map:${mapClass}` }),
      publish: publisherWith({ writer }),
    });
    const page = join(home, "pages", ZERO_REFERENCES_PAGE_SLUG, "index.html");
    return { page, result, written };
  };

  it("publishes a page that carries no reference", async () => {
    const { page, result, written } = await publish({ mapClass: "people" });
    expect(unwrap(result)).toBe(pathToFileURL(page).href);
    expect(written.map((one) => one.slug)).toStrictEqual([ZERO_REFERENCES_PAGE_SLUG]);
  });

  it("refuses a page a class name would make carry a reference, without naming the class", async () => {
    const { result, written } = await publish({ mapClass: "zorblatt" });
    const message = unwrapErr(result)[0]!;
    expect(message).toContain("the proof page would itself carry 1 reference(s), so it was not published");
    expect(message).not.toContain("zorblatt");
    expect(written).toStrictEqual([]);
  });

  it("scans the shell-wrapped document, so a word only the page shell carries still refuses the publish", async () => {
    const { result, written } = await publish({ mapClass: "products", pattern: "\\bMenlo\\b" });
    expect(unwrapErr(result)[0]).toContain("the proof page would itself carry");
    expect(written).toStrictEqual([]);
  });
});
