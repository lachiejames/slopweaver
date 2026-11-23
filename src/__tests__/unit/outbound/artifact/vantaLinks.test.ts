import { describe, expect, it } from "vitest";

import { noFoldArtifactSchema } from "../../../../outbound/artifact/noFoldSchema.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import {
  isVantaPolicyDocumentUrl,
  VANTA_SECURITY_TASKS_URL,
  vantaPolicyDocumentRefusal,
} from "../../../../outbound/artifact/vantaLinks.js";

/** The exact address shape of a policy document, tenant segments replaced with a synthetic slug. */
const DOCUMENT_URL = "https://app.vanta.com/c/acme/acme/doc/Secure%20Development%20Policy-38f1y7fpgbhao5wvpu0cdv";

describe("isVantaPolicyDocumentUrl", () => {
  it("matches the policy-document render that downloaded a PDF", () => {
    expect(isVantaPolicyDocumentUrl({ url: DOCUMENT_URL })).toBe(true);
  });

  it("does not match the security-tasks address that carries the Accept action", () => {
    expect(isVantaPolicyDocumentUrl({ url: VANTA_SECURITY_TASKS_URL })).toBe(false);
  });

  it("does not match the tenant's own security-tasks copy", () => {
    expect(isVantaPolicyDocumentUrl({ url: "https://app.vanta.com/c/acme/employee/onboarding" })).toBe(false);
  });

  it("does not match /documents, which is a different route", () => {
    expect(isVantaPolicyDocumentUrl({ url: "https://app.vanta.com/c/acme/documents" })).toBe(false);
  });

  it("judges a path SEGMENT, not a substring, so a tenant containing the letters is untouched", () => {
    expect(isVantaPolicyDocumentUrl({ url: "https://app.vanta.com/c/doctorco/policies" })).toBe(false);
  });

  it("does not match another host serving the same path shape", () => {
    expect(isVantaPolicyDocumentUrl({ url: "https://example.invalid/c/acme/acme/doc/Code%20of%20Conduct-abc" })).toBe(
      false,
    );
  });

  it("answers false for a string that is not a URL at all", () => {
    expect(isVantaPolicyDocumentUrl({ url: "not a url" })).toBe(false);
  });
});

describe("vantaPolicyDocumentRefusal", () => {
  it("names the replacement address rather than only refusing", () => {
    expect(vantaPolicyDocumentRefusal()).toContain(VANTA_SECURITY_TASKS_URL);
  });

  it("says what it matched on, so an author can see why", () => {
    expect(vantaPolicyDocumentRefusal()).toContain("/doc/");
  });
});

/** The no-fold DM the incident was posted through, as the form receives it. */
function noFoldForm({ url }: { url: string }): Record<string, unknown> {
  return {
    bullets: [[{ text: "Secure Development Policy", type: "text" }]],
    kind: "no-fold",
    lead: [
      { person: "ada", type: "mention" },
      { text: " ", type: "text" },
      { label: "Open your Vanta security tasks", type: "link", url },
      { text: " and press accept.", type: "text" },
    ],
    trailing: [],
  };
}

describe("the no-fold form refuses the link that downloads a PDF", () => {
  it("refuses a lead link carrying the policy-document URL", () => {
    const parsed = noFoldArtifactSchema.safeParse(noFoldForm({ url: DOCUMENT_URL }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join(" ")).toContain(VANTA_SECURITY_TASKS_URL);
  });

  it("accepts the same message pointed at the security-tasks address", () => {
    const parsed = noFoldArtifactSchema.safeParse(noFoldForm({ url: VANTA_SECURITY_TASKS_URL }));

    expect(parsed.success).toBe(true);
  });
});

/** The card form, proving the refusal reaches a form that does not know the no-fold form exists. */
function updateForm({ url }: { url: string }): Record<string, unknown> {
  return {
    detail: [{ runs: [{ label: "Secure Development Policy", type: "link", url }], type: "paragraph" }],
    kind: "update",
    tldr: "Two policies are still outstanding.",
  };
}

describe("the update card form refuses the same link", () => {
  it("refuses a detail link carrying the policy-document URL", () => {
    const parsed = updateArtifactSchema.safeParse(updateForm({ url: DOCUMENT_URL }));

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join(" ")).toContain(VANTA_SECURITY_TASKS_URL);
  });

  it("refuses a primaryLink carrying it, which is the one clickable URL that is not a run", () => {
    const form = {
      ...updateForm({ url: VANTA_SECURITY_TASKS_URL }),
      primaryLink: { label: "Accept", url: DOCUMENT_URL },
    };
    const parsed = updateArtifactSchema.safeParse(form);

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join(" ")).toContain(VANTA_SECURITY_TASKS_URL);
  });

  it("accepts the card pointed at the security-tasks address", () => {
    const parsed = updateArtifactSchema.safeParse(updateForm({ url: VANTA_SECURITY_TASKS_URL }));

    expect(parsed.success).toBe(true);
  });
});

describe("the refusal survives the markup conversion, not just the field check", () => {
  it("refuses a bare policy-document URL pasted into a plain text run", () => {
    const form = {
      detail: [{ runs: [{ text: `read it here ${DOCUMENT_URL}`, type: "text" }], type: "paragraph" }],
      kind: "update",
      tldr: "Two policies are still outstanding.",
    };

    const parsed = updateArtifactSchema.safeParse(form);

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join(" ")).toContain(VANTA_SECURITY_TASKS_URL);
  });

  it("refuses the same paste in a no-fold lead, which is the form the incident was posted through", () => {
    const form = {
      kind: "no-fold",
      lead: [{ text: `open ${DOCUMENT_URL} and press accept`, type: "text" }],
    };

    const parsed = noFoldArtifactSchema.safeParse(form);

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join(" ")).toContain(VANTA_SECURITY_TASKS_URL);
  });

  it("leaves a pasted security-tasks URL alone", () => {
    const form = {
      kind: "no-fold",
      lead: [{ text: `open ${VANTA_SECURITY_TASKS_URL} and press accept`, type: "text" }],
    };

    expect(noFoldArtifactSchema.safeParse(form).success).toBe(true);
  });
});
