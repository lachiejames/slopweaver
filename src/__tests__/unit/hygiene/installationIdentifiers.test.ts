/**
 * The installation's own identifiers, forgiven only when every span of a hit's kind on its line is one of them.
 * Synthetic rules throughout: every value is invented and hashed here, so no real identifier is needed to plant a hit.
 */
import { describe, expect, it } from "vitest";

import {
  type ForbiddenIdentifierRules,
  identifierDigest,
  scanForbiddenIdentifiers,
} from "../../../hygiene/identifierScan.js";
import {
  type InstallationIdentifiers,
  identifierHitsBesideInstallationIdentifiers,
  installationIdentifiersOf,
  pullRequestIdentifierHits,
} from "../../../hygiene/installationIdentifiers.js";
import { ownAddressRanges } from "../../../hygiene/ownRepository.js";

const d = ({ text }: { text: string }): string => identifierDigest({ text });

const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [d({ text: "ZZT" }), d({ text: "QQA" })],
    wordCi: [d({ text: "zorblatt" })],
    wordCs: [d({ text: "Fizz Wobble" })],
  },
  providerLocations: [{ allowed: [], marker: "linear.app", provider: "linear", re: /linear\.app\/([a-z0-9-]+)/gi }],
};

/** The installation owning team ZZT, workspace `wobble` and the person Fizz Wobble. */
const OWN: InstallationIdentifiers = installationIdentifiersOf({
  linearTeamKeys: ["zzt"],
  personNames: ["Fizz Wobble"],
  providerLocationLabels: ["Wobble"],
});

/** The hits left in `content` once `identifiers` is forgiven. */
function left({
  content,
  identifiers,
}: {
  content: string;
  identifiers: InstallationIdentifiers | undefined;
}): readonly { kind: string; line: number }[] {
  const hits = scanForbiddenIdentifiers({ content, path: "title", rules: RULES });
  return identifierHitsBesideInstallationIdentifiers({
    content,
    hits,
    identifiers,
    ownRepository: undefined,
    rules: RULES,
  }).map(({ kind, line }) => ({ kind, line }));
}

/** The hits a pull request on `ownRepository` still refuses in `content`, the installation's identifiers forgiven. */
function leftOnRepository({
  content,
  ownRepository,
}: {
  content: string;
  ownRepository: string;
}): readonly { kind: string; line: number }[] {
  return pullRequestIdentifierHits({ content, identifiers: OWN, ownRepository, path: "body", rules: RULES }).map(
    ({ kind, line }) => ({ kind, line }),
  );
}

describe("installationIdentifiersOf", () => {
  it("trims, drops empties, case-normalises each list, dedupes and sorts", () => {
    expect(
      installationIdentifiersOf({
        linearTeamKeys: [" zzt ", "QQA", "ZZT", ""],
        personNames: ["Fizz Wobble", "", "fizz wobble ", "Ada"],
        providerLocationLabels: ["Wobble", "  "],
      }),
    ).toStrictEqual({
      linearTeamKeys: ["QQA", "ZZT"],
      personNames: ["ada", "fizz wobble"],
      providerLocationLabels: ["wobble"],
    });
  });
});

describe("identifierHitsBesideInstallationIdentifiers", () => {
  it("forgives nothing when no identifiers are handed in", () => {
    expect(left({ content: "feat(ZZT-12): ship it", identifiers: undefined })).toStrictEqual([
      { kind: "forbidden-team-key", line: 1 },
    ]);
  });

  it("forgives the installation's own team key in a title", () => {
    expect(left({ content: "feat(ZZT-12): ship it", identifiers: OWN })).toStrictEqual([]);
  });

  it("keeps a team key the installation does not own", () => {
    expect(left({ content: "feat(QQA-3): ship it", identifiers: OWN })).toStrictEqual([
      { kind: "forbidden-team-key", line: 1 },
    ]);
  });

  it("keeps every team-key hit on a line that also holds a foreign one, and only that line", () => {
    expect(left({ content: "ZZT-12 and QQA-3\nZZT-13", identifiers: OWN })).toStrictEqual([
      { kind: "forbidden-team-key", line: 1 },
      { kind: "forbidden-team-key", line: 1 },
    ]);
  });

  it("forgives the installation's own workspace label and keeps another", () => {
    // Assembled at runtime, so this file never carries the hit it plants into the repository's own scan.
    expect(left({ content: `https://linear.app/${"wobble"}/issue/x`, identifiers: OWN })).toStrictEqual([]);
    expect(left({ content: "https://linear.app/other/issue/x", identifiers: OWN })).toStrictEqual([
      { kind: "forbidden-provider-location", line: 1 },
    ]);
  });

  it("forgives a person named exactly, and keeps a word that names nobody the install declares", () => {
    expect(left({ content: "thanks Fizz Wobble", identifiers: OWN })).toStrictEqual([]);
    expect(left({ content: "the zorblatt plan", identifiers: OWN })).toStrictEqual([
      { kind: "forbidden-word-ci", line: 1 },
    ]);
  });

  it("judges each kind on a line apart, so an own key beside a foreign word keeps only the word", () => {
    expect(left({ content: "ZZT-12 zorblatt", identifiers: OWN })).toStrictEqual([
      { kind: "forbidden-word-ci", line: 1 },
    ]);
  });
});

describe("pullRequestIdentifierHits", () => {
  // Counterexample: a team key inside the target's own address is the address, never a foreign span.
  it("forgives an own key beside the target's own address, whose name happens to read as a foreign key", () => {
    expect(
      leftOnRepository({ content: "https://github.com/acme/QQA-3 ZZT-12", ownRepository: "acme/QQA-3" }),
    ).toStrictEqual([]);
  });

  it("still refuses a foreign key beside the own address, and a recased address forgives no more than before", () => {
    expect(
      leftOnRepository({ content: "https://github.com/acme/QQA-3 QQA-4", ownRepository: "acme/QQA-3" }),
    ).toStrictEqual([{ kind: "forbidden-team-key", line: 1 }]);
    expect(
      leftOnRepository({ content: "https://github.com/ACME/QQA-3 ZZT-12", ownRepository: "acme/QQA-3" }),
    ).toStrictEqual([{ kind: "forbidden-team-key", line: 1 }]);
  });
});

describe("ownAddressRanges", () => {
  it("spans each exact-case occurrence with the pull-request edges, and nothing for a recased one or no slug", () => {
    const content = "see acme/web and ACME/web, not xacme/web";
    expect(ownAddressRanges({ content, ownRepository: "acme/web" })).toStrictEqual([{ end: 12, start: 4 }]);
    expect(ownAddressRanges({ content, ownRepository: undefined })).toStrictEqual([]);
  });
});
