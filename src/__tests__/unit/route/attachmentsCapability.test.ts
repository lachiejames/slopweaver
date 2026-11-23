/**
 * The DOCUMENT-WORDS leg — `attachments`, and the two rows whose class it had to be cut away from.
 *
 * MEASURED before this row existed: the word `pdf` appeared in no row's `terms` anywhere on the table, so
 * a question naming one routed nowhere at all, while four doors had been carrying extracted text for a
 * week. The cases below are that finding rather than a sweep of the table — a leg that HOLDS a document's
 * words, the three places it cannot reach, and the `gmail` row it must not collide with.
 *
 * Every assertion is on text a reader actually sees. `../../../live/turn/briefCapabilityContracts.ts`'s
 * `renderCapabilityContracts` prints `what`, `freshness` and `coverage` and never prints
 * `availability.reason`, so a claim written only into the latter would pass a table test and change
 * nothing in the brief.
 */
import { describe, expect, it } from "vitest";

import { EXISTENCE_ESTABLISHING_SOURCE_CLASSES } from "../../../live/turn/proposalAsk.js";
import { ATTACHMENTS_CAPABILITY } from "../../../route/attachmentsCapability.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/sourcePlan.js";

const DOCS = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "attachments")!;
const GMAIL = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "gmail")!;
const DRIVE = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "drive")!;

describe("the `attachments` row", () => {
  // The row lives in its own module and is spliced in by REFERENCE, which is what keeps every case below
  // about the row a reader actually gets: a second copy authored inline would satisfy the `find` above and
  // leave the module itself untested.
  it("is the exact object the table carries, not a second copy that happens to share the id", () => {
    expect(DOCS).toBe(ATTACHMENTS_CAPABILITY);
  });

  it("is a reachable, current-truth read leg", () => {
    expect(DOCS.availability).toEqual({ kind: "available" });
    expect(DOCS.truthMode).toBe("current");
    expect(DOCS.effect).toBe("read");
  });

  it("runs a cheap SCOPE command, because reading a document needs an address and not a question", () => {
    expect(DOCS.command).toEqual(["slopweaver", "pdf", "check"]);
  });

  // The correction the plan pass caught. `artifact` is excluded from the existence-establishing set on the
  // line `proposalAsk.ts` draws — whether a leg reads the world OUTSIDE this process — and it is reserved
  // for this installation describing itself (`catalog`, `audit`, `identity-directory`). A colleague's
  // policy and a vendor's contract are external truth, so `artifact` here would have told
  // `classifyProposalAsk` that the one leg able to establish a document's contents cannot.
  it("is `provider`, so a proposal ask can use it to establish that something exists", () => {
    expect(DOCS.sourceClass).toBe("provider");
    expect(EXISTENCE_ESTABLISHING_SOURCE_CLASSES.has(DOCS.sourceClass)).toBe(true);
  });

  it("names every verb that reaches a document's words, one per door", () => {
    expect(DOCS.coverage.detail).toContain("slopweaver slack read-file <F…>");
    expect(DOCS.coverage.detail).toContain("slopweaver linear read <id> --pdf");
    expect(DOCS.coverage.detail).toContain("slopweaver notion read <url> --pdf");
    expect(DOCS.coverage.detail).toContain("atlas vanta read --kind policy-document");
    expect(DOCS.coverage.detail).toContain("slopweaver pdf read <path>");
  });

  // The half an added leg cannot do by itself, and the reason each is named: a leg that comes back empty is
  // exactly when a worker substitutes a guess. All three were verified by running the verb's own usage —
  // repro: `slopweaver drive read`, whose help states a binary file's bytes are never downloaded.
  it("names the three things it CANNOT do, so a guess cannot be substituted for one", () => {
    expect(DOCS.coverage.detail).toContain("there is no OCR anywhere");
    expect(DOCS.coverage.detail).toContain("a PDF held in Google Drive is unreachable");
    expect(DOCS.coverage.detail).toContain("GitHub serves no document read");
  });

  it("says a scan's words are unavailable rather than merely unread, which is the honest distinction", () => {
    expect(DOCS.coverage.detail).toContain("genuinely unavailable rather than merely unread");
  });

  // Vanta is the one door whose bodies are a stored generation rather than a live fetch, and a row claiming
  // one freshness for five doors would be false about it. `freshness.kind` is a single enum, so the
  // exception has to be in the prose the brief prints.
  it("names the one door whose text is a stored generation, since `kind` can only say `live` once", () => {
    expect(DOCS.freshness.kind).toBe("live");
    expect(DOCS.freshness.detail).toContain("The Vanta policy bodies are the exception");
    expect(DOCS.freshness.detail).toContain("atlas vanta sync");
  });

  // The table declares no `effect: "write"` row at all, and `sourcePlan.ts` ranks READING legs, so a write
  // row would be offered as somewhere to go and look. The attaching verbs are a hand-off in the coverage
  // text instead — which is what the brief prints, so both halves still reach a session.
  it("names the attaching verbs as the other direction, without claiming a write effect", () => {
    expect(DOCS.coverage.detail).toContain("ATTACHING a document is the other direction");
    expect(DOCS.coverage.detail).toContain("slopweaver linear attach upload --file <path>");
    expect(DOCS.coverage.detail).toContain("slopweaver write vanta upload-evidence");
    expect(GENERIC_SOURCE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(GENERIC_SOURCE_CAPABILITIES.filter((capability) => capability.effect === "write")).toEqual([]);
  });

  it("carries the document-content vocabulary `route plan`'s keyword match needs", () => {
    expect(DOCS.terms).toContain("pdf");
    expect(DOCS.terms).toContain("scanned document");
    expect(DOCS.terms).toContain("attached document");
    expect(DOCS.terms).toContain("what does the document say");
    expect(DOCS.terms).toContain("policy document");
  });

  // MEASURED: the bare words displaced `corpus` outright on
  // `route plan --question "what did the latest vulnerability scan find"` — required went from [corpus]
  // to [attachments] alone. In this build `scan` is `atlas vanta vulnerabilities`, `github vuln` and the
  // hygiene gate far more often than a photocopier, so the document sense has to be the whole phrase.
  it("takes the SCAN word only as a phrase, so a vulnerability question keeps its own leg", () => {
    expect(DOCS.terms).not.toContain("scan");
    expect(DOCS.terms).not.toContain("scanned");
    expect(DOCS.terms.filter((term) => term.includes("scan"))).toEqual(["scanned document"]);
  });
});

// One class of word, one row. The cut is WHICH document (a provider's own index) versus WHAT IT SAYS
// (this row), and `gmail` is where it binds: it is the only leg that can search mail and the only one of
// the five doors whose words are two hops, because `gmail read` lists an attachment's filename and
// nothing else. Repro: `slopweaver gmail read` and `slopweaver gmail attachment`, whose help states it
// saves bytes; `grep -rn 'pdf' src/live/gmail/attachment.ts` returns nothing.
describe("the cut between WHICH document and WHAT IT SAYS", () => {
  it("leaves the bare attachment words on `gmail`, the one leg that can search mail", () => {
    expect(GMAIL.terms).toContain("attachment");
    expect(GMAIL.terms).toContain("attachments");
    expect(DOCS.terms).not.toContain("attachment");
    expect(DOCS.terms).not.toContain("attachments");
  });

  it("makes `gmail` say its own words are two hops, naming both of them", () => {
    expect(GMAIL.coverage.detail).toContain("two hops and are not this leg");
    expect(GMAIL.coverage.detail).toContain("slopweaver gmail attachment <message-id> --name <file>");
    expect(GMAIL.coverage.detail).toContain("the `attachments` row is what reads them");
  });

  it("makes `attachments` say finding WHICH object holds a file is not its job", () => {
    expect(DOCS.what).toContain("never which message carried it");
    expect(DOCS.coverage.detail).toContain(
      "Finding WHICH message, issue or page holds a file is the provider's own row",
    );
  });

  it("leaves exactly one row on the table claiming a document's extracted words", () => {
    const claimsText = GENERIC_SOURCE_CAPABILITIES.filter((capability) => /\bSAYS\b/.test(capability.what));
    expect(claimsText.map((capability) => capability.id)).toEqual(["attachments"]);
  });

  // `drive`'s own inability is that row's honest statement and stays there. This row names it too, because
  // a session asking about a Drive PDF lands on the document-words row and has to learn it from there.
  it("keeps `drive`'s own binary limit on `drive`, while `attachments` also names it", () => {
    expect(DRIVE.what).toContain("Google Drive");
    expect(DOCS.coverage.detail).toContain("never downloads a binary file's bytes at all");
  });
});
