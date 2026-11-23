/**
 * Synthetic wire rows for the Vendors tag's four DTO kinds (assessment, security review, vendor document, finding),
 * two per kind, plus the three page infos every page test pairs them with. Pure data, each value `as const`.
 */

export const PAGE_INFO_MORE_AHEAD = {
  endCursor: "vendors-page-ahead-end-cursor",
  hasNextPage: true,
  hasPreviousPage: false,
  startCursor: "vendors-page-ahead-start-cursor",
} as const;

export const PAGE_INFO_MORE_BEHIND = {
  endCursor: null,
  hasNextPage: false,
  hasPreviousPage: true,
  startCursor: "vendors-page-behind-start-cursor",
} as const;

/* The third page info: with only the two above, the two cursors are never null in opposite places and the two
   page flags are each other's negation. Here the start cursor is the null one and both flags are set. */
export const PAGE_INFO_MIDDLE = {
  endCursor: "vendors-page-middle-end-cursor",
  hasNextPage: true,
  hasPreviousPage: true,
  startCursor: null,
} as const;

// --- assessments ---------------------------------------------------------------------------------------

export const ASSESSMENT_DECIDED = {
  assessmentType: {
    description: "Assessment decided type description",
    id: "assessment-decided-type-id",
    name: "Assessment decided type name",
  },
  completedByUserId: "assessment-decided-completer-id",
  completionDate: "2101-01-01T01:01:01.001Z",
  createdDate: "2102-02-02T02:02:02.002Z",
  decision: {
    comments: "Assessment decided decision comments",
    lastUpdatedAt: "2103-03-03T03:03:03.003Z",
    status: "APPROVED",
  },
  dueDate: "2104-04-04T04:04:04.004Z",
  id: "assessment-decided-id",
  overrideDueDate: "2105-05-05T05:05:05.005Z",
  owner: {
    displayName: "Assessment Decided Owner",
    email: "assessment.decided.owner@example.test",
    id: "assessment-decided-owner-id",
    type: "USER",
  },
  startDate: "2106-06-06T06:06:06.006Z",
  status: "COMPLETED",
  vendorId: "assessment-decided-vendor-id",
} as const;

export const ASSESSMENT_PENDING = {
  assessmentType: { description: null, id: "assessment-pending-type-id", name: "Assessment pending type name" },
  completedByUserId: null,
  completionDate: null,
  createdDate: "2107-07-07T07:07:07.007Z",
  decision: null,
  dueDate: "2108-08-08T08:08:08.008Z",
  id: "assessment-pending-id",
  overrideDueDate: null,
  owner: null,
  startDate: null,
  status: "IN_PROGRESS",
  vendorId: "assessment-pending-vendor-id",
} as const;

// --- security reviews ----------------------------------------------------------------------------------

export const REVIEW_TEAM_OWNED = {
  assessmentType: {
    description: "Review team type description",
    id: "review-team-type-id",
    name: "Review team type name",
  },
  comments: "Review team free-form comments",
  completedByUserId: "review-team-completer-id",
  completionDate: "2111-01-11T11:11:11.011Z",
  decision: { lastUpdatedAt: "2112-02-12T12:12:12.012Z", status: "CONDITIONALLY_APPROVED" },
  decisionNotes: "Review team decision notes",
  dueDate: "2113-03-13T13:13:13.013Z",
  id: "review-team-id",
  overrideDueDate: "2114-04-14T14:14:14.014Z",
  owner: {
    displayName: "Review Team Owner",
    email: "review.team.owner@example.test",
    id: "review-team-owner-id",
    type: "TEAM",
  },
  startDate: "2115-05-15T15:15:15.015Z",
  vendorId: "review-team-vendor-id",
} as const;

export const REVIEW_UNDECIDED = {
  assessmentType: { description: null, id: "review-undecided-type-id", name: "Review undecided type name" },
  comments: null,
  completedByUserId: null,
  completionDate: null,
  decision: null,
  decisionNotes: null,
  dueDate: null,
  id: "review-undecided-id",
  overrideDueDate: null,
  owner: { displayName: null, email: null, id: "review-undecided-owner-id", type: "USER" },
  startDate: "2116-06-16T16:16:16.016Z",
  vendorId: "review-undecided-vendor-id",
} as const;

// --- vendor documents ----------------------------------------------------------------------------------

export const VENDOR_DOCUMENT_BY_USER = {
  creationDate: "2121-01-21T21:21:21.021Z",
  deletionDate: "2122-02-22T22:22:22.022Z",
  description: "Vendor document by user description",
  fileName: "vendor-document-by-user.pdf",
  id: "vendor-document-by-user-id",
  mimeType: "application/pdf",
  title: "Vendor document by user title",
  type: "vendor-document-by-user-type",
  updatedDate: "2123-03-23T23:23:23.023Z",
  uploadedBy: { id: "vendor-document-user-actor-id", type: "USER" },
  url: "https://vendor-documents.example.test/by-user",
} as const;

export const VENDOR_DOCUMENT_BY_APPLICATION = {
  creationDate: "2124-04-24T20:20:20.024Z",
  deletionDate: null,
  description: null,
  fileName: null,
  id: "vendor-document-by-application-id",
  mimeType: "text/csv",
  title: "Vendor document by application title",
  type: "vendor-document-by-application-type",
  updatedDate: "2125-05-25T19:19:19.025Z",
  uploadedBy: { id: "vendor-document-application-actor-id", type: "APPLICATION" },
  url: "https://vendor-documents.example.test/by-application",
} as const;

// --- findings ------------------------------------------------------------------------------------------

export const FINDING_OPEN = {
  content: "Finding open content text",
  documentId: "finding-open-document-id",
  id: "finding-open-id",
  remediation: { requirementNotes: "Rotate the shared credential after the audit", state: "OPEN" },
  riskStatus: "REMEDIATE",
  securityReviewId: "finding-open-review-id",
  vendorId: "finding-open-vendor-id",
} as const;

export const FINDING_ACCEPTED = {
  content: "Finding accepted content text",
  documentId: null,
  id: "finding-accepted-id",
  remediation: null,
  riskStatus: "ACCEPT",
  securityReviewId: null,
  vendorId: "finding-accepted-vendor-id",
} as const;
