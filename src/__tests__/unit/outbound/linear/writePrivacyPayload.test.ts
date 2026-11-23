/**
 * What the Linear write guard judges, as pure functions over a declared policy: which documents are writes, which
 * leaves are judged and under which locus, the audience, and the upload's name and text-like bytes.
 */
import { LinearDocument } from "@linear/sdk";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../../../hygiene/forbiddenIdentifiers.js";
import { unwrap } from "../../../../lib/result.js";
import {
  LINEAR_IDENTIFIER_AUDIENCE,
  LINEAR_WORKSPACE_DESTINATION,
  linearGraphqlLeaves,
  linearUploadLeaves,
  linearWriteFindings,
} from "../../../../outbound/linear/writePrivacyPayload.js";
import type { PrivacyPolicy } from "../../../../outbound/privacyCheck.js";

const NO_TERMS: PrivacyPolicy = { denylist: [], identifierRules: FORBIDDEN_IDENTIFIER_RULES, privateTerms: [] };

const PERSON: PrivacyPolicy = {
  ...NO_TERMS,
  privateTerms: [
    {
      allowedWhere: undefined,
      className: "person",
      meaning: undefined,
      re: /quillfeather/giu,
      rowDigest: "0".repeat(64),
      termId: "pt-0000000000a1",
    },
  ],
};

/** Every mutation document a Linear write factory sends today, from the pinned SDK. */
const SDK_MUTATIONS: readonly string[] = [
  LinearDocument.CreateIssueDocument,
  LinearDocument.UpdateIssueDocument,
  LinearDocument.DeleteIssueDocument,
  LinearDocument.CreateProjectDocument,
  LinearDocument.UpdateProjectDocument,
  LinearDocument.DeleteProjectDocument,
  LinearDocument.CreateProjectMilestoneDocument,
  LinearDocument.DeleteProjectMilestoneDocument,
  LinearDocument.CreateCommentDocument,
  LinearDocument.DeleteCommentDocument,
  LinearDocument.CreateProjectUpdateDocument,
  LinearDocument.DeleteProjectUpdateDocument,
  LinearDocument.CreateIssueRelationDocument,
  LinearDocument.DeleteIssueRelationDocument,
  LinearDocument.CreateInitiativeDocument,
  LinearDocument.UpdateInitiativeDocument,
  LinearDocument.DeleteInitiativeDocument,
  LinearDocument.CreateInitiativeUpdateDocument,
  LinearDocument.ArchiveInitiativeUpdateDocument,
  LinearDocument.CreateInitiativeToProjectDocument,
  LinearDocument.DeleteInitiativeToProjectDocument,
  LinearDocument.CreateIssueLabelDocument,
  LinearDocument.DeleteIssueLabelDocument,
  LinearDocument.CreateProjectLabelDocument,
  LinearDocument.DeleteProjectLabelDocument,
  LinearDocument.CreateDocumentDocument,
  LinearDocument.UpdateDocumentDocument,
  LinearDocument.DeleteDocumentDocument,
  LinearDocument.CreateTeamMembershipDocument,
  LinearDocument.DeleteTeamMembershipDocument,
  LinearDocument.FileUploadDocument,
].map((document) => String(document));

describe("linearGraphqlLeaves", () => {
  it("reads every SDK mutation document as a write that passes a policy declaring no terms", () => {
    expect(SDK_MUTATIONS.length).toBe(31);
    const findings = SDK_MUTATIONS.flatMap((query) =>
      linearWriteFindings({
        leaves: linearGraphqlLeaves({ operation: "linear.op", query, variables: {} }),
        policy: NO_TERMS,
      }),
    );
    expect(
      SDK_MUTATIONS.map((query) => linearGraphqlLeaves({ operation: "linear.op", query, variables: {} }).length),
    ).toEqual(SDK_MUTATIONS.map(() => 1));
    expect(findings).toEqual([]);
  });

  it("judges nothing for a query, so a read never loads the policy", () => {
    const leaves = linearGraphqlLeaves({
      operation: "linear.issue",
      query: String(LinearDocument.IssueDocument),
      variables: { id: "quillfeather" },
    });
    expect(leaves).toEqual([]);
  });

  it("judges an argument written inline in a mutation document, not only its variables", () => {
    const leaves = linearGraphqlLeaves({
      operation: "linear.issueCreate",
      query: 'mutation { issueCreate(input: { title: "for quillfeather" }) { success } }',
      variables: {},
    });
    const findings = linearWriteFindings({ leaves, policy: PERSON });
    expect(findings.map((finding) => finding.message)).toEqual([
      "linear linear.issueCreate document line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
    ]);
  });

  it("judges every nested variable leaf with no key skipped, under its path", () => {
    const leaves = linearGraphqlLeaves({
      operation: "linear.issueCreate",
      query: String(LinearDocument.CreateIssueDocument),
      variables: { input: { id: "quillfeather", labels: ["ok", "Quillfeather"], title: "fine" } },
    });
    expect(leaves.map((leaf) => leaf.locus)).toEqual([
      "linear linear.issueCreate document",
      "linear linear.issueCreate input.id",
      "linear linear.issueCreate input.labels[0]",
      "linear linear.issueCreate input.labels[1]",
      "linear linear.issueCreate input.title",
    ]);
    expect(linearWriteFindings({ leaves, policy: PERSON }).length).toBe(2);
  });

  it("treats a document that does not parse as a write", () => {
    const leaves = linearGraphqlLeaves({ operation: "linear.op", query: "mutation {", variables: {} });
    expect(leaves.length).toBe(1);
  });
});

describe("the Linear audience", () => {
  it("is the installation's own workspace, which forgives forbidden identifiers only", () => {
    expect(LINEAR_IDENTIFIER_AUDIENCE).toBe("installation-workspace");
    expect(LINEAR_WORKSPACE_DESTINATION).toEqual({
      identifierAudience: "installation-workspace",
      installationIdentifiers: undefined,
      ownRepository: undefined,
    });
  });
});

describe("linearUploadLeaves", () => {
  it("judges only the name of an image, its bytes unread", () => {
    const leaves = unwrap(linearUploadLeaves({ bytes: new Uint8Array([0x89, 0x50]), fileName: "shot.png" }));
    expect(leaves).toEqual([{ locus: "linear attach upload fileName", text: "shot.png" }]);
  });

  it("judges a text-like file's bytes as UTF-8", () => {
    const leaves = unwrap(
      linearUploadLeaves({ bytes: new TextEncoder().encode("notes for quillfeather"), fileName: "notes.MD" }),
    );
    expect(leaves).toEqual([
      { locus: "linear attach upload fileName", text: "notes.MD" },
      { locus: "linear attach upload file", text: "notes for quillfeather" },
    ]);
    expect(linearWriteFindings({ leaves, policy: PERSON }).length).toBe(1);
  });

  it("refuses a text-like file that is not valid UTF-8 rather than passing it unjudged", () => {
    const leaves = linearUploadLeaves({ bytes: new Uint8Array([0xff, 0xfe, 0x00]), fileName: "notes.txt" });
    expect(leaves.isErr()).toBe(true);
    expect(leaves._unsafeUnwrapErr()).toBe(
      "linear attach upload file: a text-like file that is not valid UTF-8, so it cannot be judged",
    );
  });
});
