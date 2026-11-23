/**
 * The outbound privacy check: one rule-based judgement of a text, for any destination. Synthetic rules and the
 * synthetic organisation throughout — every forbidden value is invented and hashed here.
 */
import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest } from "../../../hygiene/identifierScan.js";
import { installationIdentifiersOf } from "../../../hygiene/installationIdentifiers.js";
import { parsePrivateTerms } from "../../../hygiene/privateTerms.js";
import { unwrap } from "../../../lib/result.js";
import {
  checkPrivacy,
  type PersonalMaterialAssessment,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../../../outbound/privacyCheck.js";

const d = ({ text }: { text: string }): string => identifierDigest({ text });

/** Team key ZZT and the word `zorblatt` are forbidden; the `linear.app` location rule allows no label. */
const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [d({ text: "ZZT" })],
    wordCi: [d({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [{ allowed: [], marker: "linear.app", provider: "linear", re: /linear\.app\/([a-z0-9-]+)/gi }],
};

const POLICY: PrivacyPolicy = { denylist: [], identifierRules: RULES, privateTerms: [] };

/** The label, kind or class a finding carries, whichever its code has. */
function detailOf({ finding }: { finding: PrivacyFinding }): string {
  if (finding.code === "HYGIENE") return finding.label;
  if (finding.code === "PRIVATE_TERM") return finding.className;
  return finding.kind;
}

/** A destination with no facts: the strictest, and what an audit of posted text passes. */
const STRICT: PrivacyDestination = {
  identifierAudience: "strict",
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

const SESSION = "0123abcd-4567-89ab-cdef-0123456789ab";

/** Code, kind or label, and line of every finding, which is what most cases pin. */
function shapes({
  text,
  destination = STRICT,
  policy = POLICY,
}: {
  text: string;
  destination?: PrivacyDestination;
  policy?: PrivacyPolicy;
}): readonly (string | number)[][] {
  return checkPrivacy({
    content: { locus: "pr/57/comment/9", text },
    destination,
    personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
    policy,
  }).findings.map((finding) => [finding.code, detailOf({ finding }), finding.line]);
}

describe("checkPrivacy — installation state", () => {
  it("refuses a session id under a non-file locus, naming the locus and never the id", () => {
    const verdict = checkPrivacy({
      content: { locus: "pr/57/comment/9", text: `the session ${SESSION} saw it` },
      destination: STRICT,
      personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
      policy: POLICY,
    });
    expect(verdict.findings).toEqual([
      {
        code: "INSTALLATION_STATE",
        kind: "session-id",
        line: 1,
        locus: "pr/57/comment/9",
        message:
          "pr/57/comment/9 line 1: a session or thread id (redacted here) — drop the id; no published surface points back into an installation",
      },
    ]);
    expect(verdict.findings[0]!.message.includes(SESSION)).toBe(false);
  });

  it("reports a pointer and its embedded session id as one finding, the pointer named", () => {
    expect(shapes({ text: `see transcript:${SESSION} for the session ${SESSION}` })).toEqual([
      ["INSTALLATION_STATE", "transcript-pointer", 1],
    ]);
  });

  it("counts lines across CRLF line endings", () => {
    expect(shapes({ text: "fine\r\nfine\r\nread /Users/somebody/x.ts" })).toEqual([
      ["INSTALLATION_STATE", "home-path", 3],
    ]);
  });

  it("lets the generic state-home spelling through", () => {
    expect(shapes({ text: "a 0600 file in `$SLOPWEAVER_HOME/secrets/`" })).toEqual([]);
  });
});

describe("checkPrivacy — hygiene", () => {
  it("refuses a credential shape and a denylisted term, each on its own line", () => {
    const token = `ghp_${"a".repeat(30)}`;
    expect(
      shapes({
        policy: { ...POLICY, denylist: ["hunter2-legacy-passphrase"] },
        text: `${token}\nhunter2-legacy-passphrase`,
      }),
    ).toEqual([
      ["HYGIENE", "github-oauth-token", 1],
      ["HYGIENE", "denylist", 2],
    ]);
  });

  it("refuses a forbidden identifier at the strict destination, with the synthetic stand-in fix", () => {
    const verdict = checkPrivacy({
      content: { locus: "slack/acme/C0FIXTURE01/1", text: "ask zorblatt about it" },
      destination: STRICT,
      personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
      policy: POLICY,
    });
    expect(verdict.findings.map((finding) => finding.message)).toEqual([
      "slack/acme/C0FIXTURE01/1 line 1: a forbidden-word-ci identifier (redacted here) — replace it with a synthetic stand-in",
    ]);
  });
});

describe("checkPrivacy — private terms", () => {
  /** A case-insensitive person and a case-sensitive place, both invented. */
  const TERMS = unwrap(
    parsePrivateTerms({
      text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\nplace\t-\tZorvane\tsynthetic\n",
    }),
  );
  const WITH_TERMS: PrivacyPolicy = { ...POLICY, privateTerms: TERMS };

  it("refuses each line a term matches, naming the locus, line and class and never the term", () => {
    const verdict = checkPrivacy({
      content: { locus: "pr/57/comment/9", text: "fine\nask QuillFeather\nfine" },
      destination: STRICT,
      personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
      policy: WITH_TERMS,
    });
    expect(verdict.findings).toEqual([
      {
        className: "person",
        code: "PRIVATE_TERM",
        line: 2,
        locus: "pr/57/comment/9",
        message:
          "pr/57/comment/9 line 2: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row",
      },
    ]);
    expect(verdict.findings[0]!.message.toLowerCase().includes("quillfeather")).toBe(false);
  });

  it("honours each row's case flag", () => {
    expect(shapes({ policy: WITH_TERMS, text: "zorvane\nZorvane" })).toEqual([["PRIVATE_TERM", "place", 2]]);
  });

  it("reports a line once per class however often the class matches it", () => {
    expect(shapes({ policy: WITH_TERMS, text: "quillfeather met Quillfeather in Zorvane" })).toEqual([
      ["PRIVATE_TERM", "person", 1],
      ["PRIVATE_TERM", "place", 1],
    ]);
  });

  it("is not forgiven by a destination whose own address it does not sit inside", () => {
    const own: PrivacyDestination = {
      identifierAudience: "strict",
      installationIdentifiers: undefined,
      ownRepository: "acme/widgets",
    };
    expect(shapes({ destination: own, policy: WITH_TERMS, text: "quillfeather" })).toEqual([
      ["PRIVATE_TERM", "person", 1],
    ]);
  });

  describe("the destination's own repository address", () => {
    const OWN: PrivacyDestination = {
      identifierAudience: "strict",
      installationIdentifiers: undefined,
      ownRepository: "quillfeather/widgets",
    };

    it("forgives a term wholly inside the exact address, bare or as a link", () => {
      const text = "see quillfeather/widgets#7\nhttps://github.com/quillfeather/widgets/pull/7";
      expect(shapes({ destination: OWN, policy: WITH_TERMS, text })).toEqual([]);
    });

    it("still refuses the bare handle outside the address span, on the same line as one", () => {
      const text = "quillfeather/widgets#7 by quillfeather";
      expect(shapes({ destination: OWN, policy: WITH_TERMS, text })).toEqual([["PRIVATE_TERM", "person", 1]]);
    });

    it("still refuses a look-alike address: the same owner and another repository", () => {
      const text = "https://github.com/quillfeather/notes";
      expect(shapes({ destination: OWN, policy: WITH_TERMS, text })).toEqual([["PRIVATE_TERM", "person", 1]]);
    });

    it("forgives nothing on a destination with no repository", () => {
      expect(shapes({ policy: WITH_TERMS, text: "quillfeather/widgets" })).toEqual([["PRIVATE_TERM", "person", 1]]);
    });
  });

  it("finds nothing when the file declares no term", () => {
    expect(shapes({ text: "quillfeather in Zorvane" })).toEqual([]);
  });
});

describe("checkPrivacy — one forgiveness rule, read from the destination's facts", () => {
  const OWN_DESTINATION: PrivacyDestination = {
    identifierAudience: "strict",
    installationIdentifiers: installationIdentifiersOf({
      linearTeamKeys: ["zzt"],
      personNames: [],
      providerLocationLabels: [],
    }),
    ownRepository: "acme/widgets",
  };

  it("forgives the installation's own team key only where the destination holds it", () => {
    expect(shapes({ text: "fixes ZZT-12" })).toEqual([["HYGIENE", "forbidden-team-key", 1]]);
    expect(shapes({ destination: OWN_DESTINATION, text: "fixes ZZT-12" })).toEqual([]);
  });

  it("never forgives a credential, whatever the destination holds", () => {
    expect(shapes({ destination: OWN_DESTINATION, text: `ghp_${"b".repeat(30)}` })).toEqual([
      ["HYGIENE", "github-oauth-token", 1],
    ]);
  });

  it("keeps a line refused when a foreign span shares it with an own one", () => {
    expect(shapes({ destination: OWN_DESTINATION, text: "fixes ZZT-12 and zorblatt" })).toEqual([
      ["HYGIENE", "forbidden-word-ci", 1],
    ]);
  });
});

describe("checkPrivacy — the installation's own workspace forgives forbidden identifiers and nothing else", () => {
  const WORKSPACE: PrivacyDestination = {
    identifierAudience: "installation-workspace",
    installationIdentifiers: undefined,
    ownRepository: undefined,
  };
  const TERMS: PrivacyPolicy = {
    ...POLICY,
    denylist: ["fixture-secret-word"],
    privateTerms: unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
    ),
  };

  it("forgives a forbidden identifier and a team key", () => {
    expect(shapes({ text: "zorblatt fixes ZZT-12" })).toEqual([
      ["HYGIENE", "forbidden-word-ci", 1],
      ["HYGIENE", "forbidden-team-key", 1],
    ]);
    expect(shapes({ destination: WORKSPACE, text: "zorblatt fixes ZZT-12" })).toEqual([]);
  });

  it("still refuses a credential, a denylisted term, installation state and a private term", () => {
    const text = `ghp_${"b".repeat(30)}\nfixture-secret-word\n/Users/fixture-person/notes\nquillfeather`;
    expect(shapes({ destination: WORKSPACE, policy: TERMS, text })).toEqual([
      ["HYGIENE", "github-oauth-token", 1],
      ["HYGIENE", "denylist", 2],
      ["INSTALLATION_STATE", "home-path", 3],
      ["PRIVATE_TERM", "person", 4],
    ]);
  });
});

describe("checkPrivacy — the personal-material assessment it carries", () => {
  it("carries unassessed through a clean verdict, so clean never reads as paraphrases checked", () => {
    const verdict = checkPrivacy({
      content: { locus: "commit/abc123/message", text: "fix: the parser handles an empty line" },
      destination: STRICT,
      personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
      policy: POLICY,
    });
    expect(verdict).toEqual({ findings: [], personalMaterial: { kind: "unassessed" } });
  });

  it("carries a visible session's assessment exactly as given, beside the rule findings", () => {
    const refused: PersonalMaterialAssessment = {
      kind: "refused",
      reasons: ["a paraphrase of a private call"],
      receiptId: "receipt-1",
    };
    const verdict = checkPrivacy({
      content: { locus: "pr/57/body", text: "read /home/someone/notes" },
      destination: STRICT,
      personalMaterial: refused,
      policy: POLICY,
    });
    expect(verdict.personalMaterial).toEqual(refused);
    expect(verdict.findings.map((finding) => finding.code)).toEqual(["INSTALLATION_STATE"]);
  });

  it("answers no findings for an empty text", () => {
    expect(shapes({ text: "" })).toEqual([]);
  });
});
