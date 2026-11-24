/*
 * The console's read of the private-word proposals a card names, over a throwaway home written the way
 * `slopweaver private-terms add` writes one. Every word here is synthetic. What is pinned: an add, a narrow and a
 * remove each draw their row without its source cell; a remove over a file that moved since is not drawn; a missing,
 * malformed or linked file is one closed reason and no text; and the owner's recorded answer rides along.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { consoleHomePaths } from "../../lib/consoleHome";
import { readPrivateTermProposals } from "../../lib/privateTermProposalRead";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const HEADER_V2 = "id\tclass\tflags\tpattern\tmeaning\tallowed-where\tsource";
/** The source cell every synthetic row carries; no answer may hold it. */
const SOURCE = "relay:acme-row-FIXTURE";
const ROW_A = `pt-00000000000a\tperson\ti\tquillfeather\ta colleague at acme\t\t${SOURCE}`;
const ROW_B = `pt-00000000000b\tplace\t-\tInkwell Lane\t\tthe acme workspace\t${SOURCE}`;
/** Row B before a narrow gave it a where-fine. */
const ROW_B_BEFORE = `pt-00000000000b\tplace\t-\tInkwell Lane\t\t\t${SOURCE}`;
const HEADER_V1 = "class\tflags\tpattern\tsource";

/** A fresh home with the proposals directory made. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ptp-read-"));
  homes.push(home);
  mkdirSync(consoleHomePaths({ home }).privateTermProposals, { recursive: true });
  return home;
}

/** Write one proposal file as the CLI would. */
function propose({
  home,
  proposalId,
  action,
  termId,
  text,
  baseSha256 = null,
}: {
  home: string;
  proposalId: string;
  action: "add" | "narrow" | "remove";
  termId: string;
  text: string;
  baseSha256?: string | null;
}): void {
  const record = {
    action,
    baseSha256,
    createdAtIso: "2026-11-23T00:00:00.000Z",
    proposalId,
    schemaVersion: 1,
    termId,
    text,
  };
  writeFileSync(join(consoleHomePaths({ home }).privateTermProposals, `${proposalId}.json`), JSON.stringify(record));
}

/** The sha256 of a text, as the store records a base. */
function sha({ text }: { text: string }): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("readPrivateTermProposals", () => {
  it("draws an add's row from its new file, without the source, unanswered", () => {
    const home = freshHome();
    propose({
      action: "add",
      home,
      proposalId: "pp-00000000000a",
      termId: "pt-00000000000a",
      text: `${HEADER_V2}\n${ROW_A}\n`,
    });
    const items = readPrivateTermProposals({ home, proposalIds: ["pp-00000000000a"] });
    expect(items).toStrictEqual([
      {
        action: "add",
        allowedWhere: null,
        answer: null,
        caseInsensitive: true,
        className: "person",
        kind: "shown",
        meaning: "a colleague at acme",
        pattern: "quillfeather",
        proposalId: "pp-00000000000a",
        termId: "pt-00000000000a",
      },
    ]);
    expect(JSON.stringify(items)).not.toContain(SOURCE);
  });

  it("draws a narrow's changed row and the owner's recorded answer", () => {
    const home = freshHome();
    const current = `${HEADER_V2}\n${ROW_A}\n${ROW_B_BEFORE}\n`;
    writeFileSync(consoleHomePaths({ home }).privateTerms, current);
    propose({
      action: "narrow",
      baseSha256: sha({ text: current }),
      home,
      proposalId: "pp-00000000000b",
      termId: "pt-00000000000b",
      text: `${HEADER_V2}\n${ROW_A}\n${ROW_B}\n`,
    });
    const answer = {
      answer: "no",
      answeredAtIso: "2026-11-23T00:00:00.000Z",
      bySession: "work-console",
      proposalId: "pp-00000000000b",
      schemaVersion: 1,
      via: "console",
    };
    writeFileSync(
      join(consoleHomePaths({ home }).privateTermProposals, "pp-00000000000b.answer"),
      JSON.stringify(answer),
    );
    const [item] = readPrivateTermProposals({ home, proposalIds: ["pp-00000000000b"] });
    expect(item).toStrictEqual({
      action: "narrow",
      allowedWhere: "the acme workspace",
      answer: "no",
      caseInsensitive: false,
      className: "place",
      kind: "shown",
      meaning: null,
      pattern: "Inkwell Lane",
      proposalId: "pp-00000000000b",
      termId: "pt-00000000000b",
    });
  });

  it("draws a remove's row from the current file while it is the file the proposal was decided over", () => {
    const home = freshHome();
    const current = `${HEADER_V2}\n${ROW_A}\n${ROW_B}\n`;
    writeFileSync(consoleHomePaths({ home }).privateTerms, current);
    const after = `${HEADER_V2}\n${ROW_B}\n`;
    propose({
      action: "remove",
      baseSha256: sha({ text: current }),
      home,
      proposalId: "pp-00000000000c",
      termId: "pt-00000000000a",
      text: after,
    });
    const [item] = readPrivateTermProposals({ home, proposalIds: ["pp-00000000000c"] });
    expect(item).toStrictEqual({
      action: "remove",
      allowedWhere: null,
      answer: null,
      caseInsensitive: true,
      className: "person",
      kind: "shown",
      meaning: "a colleague at acme",
      pattern: "quillfeather",
      proposalId: "pp-00000000000c",
      termId: "pt-00000000000a",
    });
  });

  it("does not draw a remove once the current file moved", () => {
    const home = freshHome();
    const decidedOver = `${HEADER_V2}\n${ROW_A}\n`;
    writeFileSync(consoleHomePaths({ home }).privateTerms, `${HEADER_V2}\n${ROW_A}\n${ROW_B}\n`);
    propose({
      action: "remove",
      baseSha256: sha({ text: decidedOver }),
      home,
      proposalId: "pp-00000000000c",
      termId: "pt-00000000000a",
      text: `${HEADER_V2}\n`,
    });
    expect(readPrivateTermProposals({ home, proposalIds: ["pp-00000000000c"] })).toStrictEqual([
      { kind: "unavailable", proposalId: "pp-00000000000c", reason: "current-changed" },
    ]);
  });

  it("draws an edit over the four-cell format, whose migration gave every row a fresh id", () => {
    const home = freshHome();
    const firstFormat = `${HEADER_V1}\nperson\ti\tquillfeather\t${SOURCE}\nplace\t-\tInkwell Lane\t${SOURCE}\n`;
    writeFileSync(consoleHomePaths({ home }).privateTerms, firstFormat);
    const migratedB = `pt-0000000000bb\tplace\t-\tInkwell Lane\t\t\t${SOURCE}`;
    propose({
      action: "remove",
      baseSha256: sha({ text: firstFormat }),
      home,
      proposalId: "pp-00000000000d",
      termId: "pt-0000000000aa",
      text: `${HEADER_V2}\n${migratedB}\n`,
    });
    const added = `pt-0000000000cc\ttopic\ti\tbrasslantern\ta side project\t\t${SOURCE}`;
    propose({
      action: "add",
      baseSha256: sha({ text: firstFormat }),
      home,
      proposalId: "pp-00000000000e",
      termId: "pt-0000000000cc",
      text: `${HEADER_V2}\npt-0000000000aa\tperson\ti\tquillfeather\t\t\t${SOURCE}\n${migratedB}\n${added}\n`,
    });
    expect(readPrivateTermProposals({ home, proposalIds: ["pp-00000000000d", "pp-00000000000e"] })).toStrictEqual([
      {
        action: "remove",
        allowedWhere: null,
        answer: null,
        caseInsensitive: true,
        className: "person",
        kind: "shown",
        meaning: null,
        pattern: "quillfeather",
        proposalId: "pp-00000000000d",
        termId: "pt-0000000000aa",
      },
      {
        action: "add",
        allowedWhere: null,
        answer: null,
        caseInsensitive: true,
        className: "topic",
        kind: "shown",
        meaning: "a side project",
        pattern: "brasslantern",
        proposalId: "pp-00000000000e",
        termId: "pt-0000000000cc",
      },
    ]);
  });

  it("does not draw a proposal whose new file changes a row other than the one it names", () => {
    const home = freshHome();
    const current = `${HEADER_V2}\n${ROW_A}\n${ROW_B}\n`;
    writeFileSync(consoleHomePaths({ home }).privateTerms, current);
    // Claims to remove A, but its new file keeps A and drops B: the card would show A while the yes removed B.
    propose({
      action: "remove",
      baseSha256: sha({ text: current }),
      home,
      proposalId: "pp-00000000000a",
      termId: "pt-00000000000a",
      text: `${HEADER_V2}\n${ROW_A}\n`,
    });
    // Adds C, and silently drops B with it.
    const rowC = `pt-00000000000c\ttopic\ti\tbrasslantern\ta side project\t\t${SOURCE}`;
    propose({
      action: "add",
      baseSha256: sha({ text: current }),
      home,
      proposalId: "pp-00000000000b",
      termId: "pt-00000000000c",
      text: `${HEADER_V2}\n${ROW_A}\n${rowC}\n`,
    });
    // Narrows B, and also rewrites A's pattern.
    propose({
      action: "narrow",
      baseSha256: sha({ text: current }),
      home,
      proposalId: "pp-00000000000c",
      termId: "pt-00000000000b",
      text: `${HEADER_V2}\n${ROW_A.replace("quillfeather", "quill")}\n${ROW_B_BEFORE}\n`,
    });
    expect(
      readPrivateTermProposals({ home, proposalIds: ["pp-00000000000a", "pp-00000000000b", "pp-00000000000c"] }),
    ).toStrictEqual([
      { kind: "unavailable", proposalId: "pp-00000000000a", reason: "not-one-row" },
      { kind: "unavailable", proposalId: "pp-00000000000b", reason: "not-one-row" },
      { kind: "unavailable", proposalId: "pp-00000000000c", reason: "not-one-row" },
    ]);
  });

  it("answers a closed reason, never text, for a missing, malformed or mismatched proposal", () => {
    const home = freshHome();
    const dir = consoleHomePaths({ home }).privateTermProposals;
    writeFileSync(join(dir, "pp-00000000000b.json"), `{"not json ${SOURCE}`);
    propose({
      action: "add",
      home,
      proposalId: "pp-0000000000ff",
      termId: "pt-00000000000a",
      text: `${HEADER_V2}\n${ROW_A}\n`,
    });
    writeFileSync(
      join(dir, "pp-00000000000c.json"),
      JSON.stringify({ proposalId: "pp-0000000000ff", schemaVersion: 1 }),
    );
    propose({
      action: "add",
      home,
      proposalId: "pp-00000000000e",
      termId: "pt-00000000000f",
      text: `${HEADER_V2}\n${ROW_A}\n`,
    });
    const items = readPrivateTermProposals({
      home,
      proposalIds: ["pp-00000000000a", "pp-00000000000b", "pp-00000000000c", "pp-00000000000e"],
    });
    expect(items).toStrictEqual([
      { kind: "unavailable", proposalId: "pp-00000000000a", reason: "not-waiting" },
      { kind: "unavailable", proposalId: "pp-00000000000b", reason: "malformed" },
      { kind: "unavailable", proposalId: "pp-00000000000c", reason: "malformed" },
      { kind: "unavailable", proposalId: "pp-00000000000e", reason: "not-one-row" },
    ]);
    expect(JSON.stringify(items)).not.toContain(SOURCE);
  });

  it("follows no link: a linked proposal file, a linked directory on the way, or a linked home, is not read", () => {
    const home = freshHome();
    const elsewhere = freshHome();
    propose({
      action: "add",
      home: elsewhere,
      proposalId: "pp-00000000000a",
      termId: "pt-00000000000a",
      text: `${HEADER_V2}\n${ROW_A}\n`,
    });
    const theirs = join(consoleHomePaths({ home: elsewhere }).privateTermProposals, "pp-00000000000a.json");
    symlinkSync(theirs, join(consoleHomePaths({ home }).privateTermProposals, "pp-00000000000a.json"));
    const linkedDir = freshHome();
    rmSync(join(linkedDir, "hygiene"), { force: true, recursive: true });
    symlinkSync(join(elsewhere, "hygiene"), join(linkedDir, "hygiene"));
    const linkedHome = join(mkdtempSync(join(tmpdir(), "ptp-link-")), "home");
    homes.push(dirname(linkedHome));
    symlinkSync(elsewhere, linkedHome);
    expect([
      readPrivateTermProposals({ home, proposalIds: ["pp-00000000000a"] }),
      readPrivateTermProposals({ home: linkedDir, proposalIds: ["pp-00000000000a"] }),
      readPrivateTermProposals({ home: linkedHome, proposalIds: ["pp-00000000000a"] }),
      readPrivateTermProposals({ home: elsewhere, proposalIds: ["pp-00000000000a"] })[0].kind,
    ]).toStrictEqual([
      [{ kind: "unavailable", proposalId: "pp-00000000000a", reason: "linked" }],
      [{ kind: "unavailable", proposalId: "pp-00000000000a", reason: "linked" }],
      [{ kind: "unavailable", proposalId: "pp-00000000000a", reason: "linked" }],
      "shown",
    ]);
  });
});
