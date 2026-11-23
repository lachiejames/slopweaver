/**
 * The publication audit's pure core: published text judged through the outbound privacy check, every hit reduced to a
 * class, a door, a link and a coordinate-only id. Synthetic organisation, synthetic UUID, synthetic terms throughout.
 */
import { describe, expect, it } from "vitest";

import type { ForbiddenIdentifierRules } from "../../../../hygiene/identifierScan.js";
import { parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { unwrap } from "../../../../lib/result.js";
import {
  auditPublishedTexts,
  countPublicationFindings,
  type PublicationAuditPolicy,
  publicationFindingId,
} from "../../../../live/publicationAudit/core.js";
import type { PublishedText } from "../../../../live/publicationAudit/types.js";

/** No forbidden identifiers: these cases are about installation state and private terms. */
const NO_IDENTIFIERS: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [],
    wordCs: [],
  },
  providerLocations: [],
};

/** A synthetic money term and a synthetic owner handle, the handle also the own repository's owner. */
const TERMS = unwrap(
  parsePrivateTerms({
    text: "class\tflags\tpattern\tsource\nmoney\ti\tglimmerfund\tsynthetic\nowner-handle\ti\tacmeowner\tsynthetic\n",
  }),
);

const POLICY: PublicationAuditPolicy = {
  denylist: [],
  identifierRules: NO_IDENTIFIERS,
  ownRepository: "acmeowner/widgets",
  privateTerms: TERMS,
};

const SESSION = "0123abcd-4567-89ab-cdef-0123456789ab";
const PULL_46 = "https://github.com/acmeowner/widgets/pull/46";
const PULL_57 = "https://github.com/acmeowner/widgets/pull/57";

/** One GitHub text on one object. */
function text({
  objectKey,
  link,
  body,
  field = "body",
  linkCarriesNoText = false,
}: {
  objectKey: string;
  link: string;
  body: string;
  field?: string;
  linkCarriesNoText?: boolean;
}): PublishedText {
  return { door: "github", field, link, linkCarriesNoText, objectKey, text: body };
}

describe("auditPublishedTexts", () => {
  it("names a session id as installation state and a money term as its class, with the link and nothing found", () => {
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [
        text({ body: `observed in session ${SESSION} overnight`, link: PULL_46, objectKey: "pull 46" }),
        text({ body: "the glimmerfund line moved", link: PULL_57, objectKey: "pull 57" }),
      ],
    });
    expect(audit.findings).toEqual([
      {
        className: "installation-state/session-id",
        door: "github",
        fields: ["body"],
        findingId: publicationFindingId({
          className: "installation-state/session-id",
          door: "github",
          objectKey: "pull 46",
        }),
        link: PULL_46,
      },
      {
        className: "private-term/money",
        door: "github",
        fields: ["body"],
        findingId: publicationFindingId({ className: "private-term/money", door: "github", objectKey: "pull 57" }),
        link: PULL_57,
      },
    ]);
    expect(audit.withheldLinks).toBe(0);
  });

  it("carries neither the matched text nor the session id anywhere in its output", () => {
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [
        text({ body: `session ${SESSION}`, link: PULL_46, objectKey: "pull 46" }),
        text({ body: "Glimmerfund", link: PULL_57, objectKey: "pull 57" }),
      ],
    });
    const serialised = JSON.stringify(audit);
    expect(audit.findings.length).toBe(2);
    expect(serialised.toLowerCase()).not.toContain("glimmerfund");
    expect(serialised).not.toContain(SESSION);
  });

  it("forgives the owner handle inside the own repository's address and refuses it bare", () => {
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [
        text({ body: `see ${PULL_46} for the change`, link: PULL_46, objectKey: "pull 46" }),
        text({ body: "ask acmeowner first", link: PULL_57, objectKey: "pull 57" }),
      ],
    });
    expect(audit.findings.map((finding) => [finding.className, finding.link])).toEqual([
      ["private-term/owner-handle", PULL_57],
    ]);
  });

  it("does not read an unlabelled UUID in an ordinary address as a session id", () => {
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [
        text({
          body: `![shot](https://github.com/user-attachments/assets/${SESSION})`,
          link: PULL_46,
          objectKey: "pull 46",
        }),
      ],
    });
    expect(audit.findings).toEqual([]);
  });

  it("reports one finding per object per class, however many fields or lines repeat it, naming every field", () => {
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [
        text({ body: "glimmerfund\nglimmerfund", field: "title", link: PULL_57, objectKey: "pull 57" }),
        text({ body: "the glimmerfund line", field: "diff_hunk", link: PULL_57, objectKey: "pull 57" }),
        text({ body: "glimmerfund again", field: "title", link: PULL_57, objectKey: "pull 57" }),
      ],
    });
    expect(audit.findings.map((finding) => [finding.className, finding.fields])).toEqual([
      ["private-term/money", ["diff_hunk", "title"]],
    ]);
  });

  it("withholds a link a rule matches rather than carrying it", () => {
    const leakyLink = "https://example.test/glimmerfund/1";
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [text({ body: "glimmerfund", link: leakyLink, objectKey: "page 1" })],
    });
    expect(audit.findings.map((finding) => finding.link)).toEqual([null]);
    expect(audit.withheldLinks).toBe(1);
  });

  it("keeps a link whose only free text is the own address, even when a pattern matches one of its path words", () => {
    const pullTerm = unwrap(parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nmoney\ti\tpull\tsynthetic\n" }));
    const policy = { ...POLICY, privateTerms: pullTerm };
    const judged = auditPublishedTexts({
      policy,
      texts: [text({ body: "the pull budget", link: PULL_46, linkCarriesNoText: true, objectKey: "pull 46" })],
    });
    expect(judged.findings.map((finding) => [finding.className, finding.link])).toEqual([
      ["private-term/money", PULL_46],
    ]);
    expect(judged.withheldLinks).toBe(0);
    const unmarked = auditPublishedTexts({
      policy,
      texts: [text({ body: "the pull budget", link: PULL_46, objectKey: "pull 46" })],
    });
    expect(unmarked.findings.map((finding) => finding.link)).toEqual([null]);
  });

  it("finds nothing in clean text", () => {
    expect(
      auditPublishedTexts({
        policy: POLICY,
        texts: [text({ body: "a tidy description", link: PULL_46, objectKey: "pull 46" })],
      }),
    ).toEqual({ findings: [], withheldLinks: 0 });
  });
});

describe("publicationFindingId", () => {
  it("is stable for one coordinate and differs by class", () => {
    const money = publicationFindingId({ className: "private-term/money", door: "github", objectKey: "pull 57" });
    expect(money).toBe(publicationFindingId({ className: "private-term/money", door: "github", objectKey: "pull 57" }));
    expect(money).toMatch(/^[0-9a-f]{16}$/u);
    expect(money).not.toBe(
      publicationFindingId({ className: "private-term/person", door: "github", objectKey: "pull 57" }),
    );
  });
});

describe("countPublicationFindings", () => {
  it("counts by door then class, in sorted order", () => {
    const audit = auditPublishedTexts({
      policy: POLICY,
      texts: [
        text({ body: "glimmerfund", link: PULL_57, objectKey: "pull 57" }),
        text({ body: `session ${SESSION}`, link: PULL_46, objectKey: "pull 46" }),
        text({ body: `session ${SESSION}`, link: PULL_46, objectKey: "pull 52" }),
      ],
    });
    expect(countPublicationFindings({ findings: audit.findings })).toEqual({
      github: { "installation-state/session-id": 2, "private-term/money": 1 },
    });
  });

  it("is empty for no findings", () => {
    expect(countPublicationFindings({ findings: [] })).toEqual({});
  });
});
