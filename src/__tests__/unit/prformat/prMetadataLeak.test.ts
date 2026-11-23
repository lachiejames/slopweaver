import { describe, expect, it } from "vitest";
import { prFormatResult } from "../../../devGate/devGate.js";
import {
  type ForbiddenIdentifierRules,
  IDENTIFIER_KINDS,
  type IdentifierKind,
  identifierDigest,
} from "../../../hygiene/identifierScan.js";
import { unwrap } from "../../../lib/result.js";
import { dependencyBotActors } from "../../../organisation/dependencyBots.js";
import { renderPrBody } from "../../../outbound/github/render.js";
import { prMetadataLeakErrors, scanPrMetadataLeaks } from "../../../prformat/checkCore.js";
import { FIX_BODY, formOf } from "../outbound/github/fixtures.js";

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/**
 * The private denylist as the policy defines it: a literal SECRET string no pattern in
 * `scan.ts` can express. It used to hold org identifiers, which is why these tests used to call it an "org
 * term" — that half of the mandate is retired.
 */
const DENYLIST = ["hunter2-legacy-passphrase"];

/** A C3 body the real renderer wrote, so the format gate itself passes. */
const CONFORMING_BODY = unwrap(renderPrBody({ form: formOf({ body: FIX_BODY }) }));

describe("prMetadataLeakErrors", () => {
  it("flags a denylisted secret in the PR body without echoing the term", () => {
    const errors = prMetadataLeakErrors({
      body: "We shipped this with hunter2-legacy-passphrase today.",
      denylist: DENYLIST,
      title: "",
    });
    expect(errors).toStrictEqual([
      "PR body contains a denylisted term at line 1 — remove it (the matched text is redacted from this log).",
    ]);
    expect(errors[0]!.includes("hunter2")).toBe(false);
  });

  it("flags a denylisted secret in the PR title", () => {
    const errors = prMetadataLeakErrors({
      body: "clean body",
      denylist: DENYLIST,
      title: "hunter2-legacy-passphrase rotation",
    });
    expect(errors).toStrictEqual([
      "PR title contains a denylisted term at line 1 — remove it (the matched text is redacted from this log).",
    ]);
  });

  it("flags a credential shape, which is the one class that still fails a description", () => {
    const errors = prMetadataLeakErrors({ body: `token=ghp_${"a".repeat(30)}`, denylist: DENYLIST, title: "t" });
    expect(errors).toStrictEqual([
      "PR body contains a github-oauth-token shape at line 1 — remove it (the matched text is redacted from this log).",
    ]);
  });

  it("refuses a real-shaped workspace id in the title and the body, without echoing it", () => {
    // Assembled at runtime so this source never carries a refusable literal of its own.
    const real = "C0123" + "ABCDEF";
    const errors = prMetadataLeakErrors({ body: `ok\nthe thread is in ${real}.`, denylist: DENYLIST, title: real });
    expect(errors).toStrictEqual([
      "PR title contains a raw-workspace-id shape at line 1 — remove it (the matched text is redacted from this log).",
      "PR body contains a raw-workspace-id shape at line 2 — remove it (the matched text is redacted from this log).",
    ]);
    expect(errors.some((error) => error.includes(real))).toBe(false);
  });

  it("lets a synthetic workspace id through, which is the stand-in the refusal asks for", () => {
    expect(
      prMetadataLeakErrors({ body: `the thread is in C0${"SYN"}123ABCDEF.`, denylist: DENYLIST, title: "thread" }),
    ).toStrictEqual([]);
  });

  it("lets an absolute home path through, an identifier class no gate refuses", () => {
    expect(
      prMetadataLeakErrors({ body: "built under /Users/someone/dev/app.", denylist: DENYLIST, title: "build" }),
    ).toStrictEqual([]);
  });

  it("passes clean text", () => {
    expect(
      prMetadataLeakErrors({ body: "We shipped audit for demo.example.com.", denylist: DENYLIST, title: "audit" }),
    ).toStrictEqual([]);
  });
});

/**
 * Synthetic rules, one per identifier kind, so no real token is needed to plant a hit: every value is invented
 * and hashed here, the same set `../hygiene/identifierScan.test.ts` proves the scanner over.
 */
const PLANTED_WORD = "zorblatt";
const d = ({ text }: { text: string }): string => identifierDigest({ text });
const SYNTHETIC_RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [d({ text: "QZV" })],
    exactIds: [d({ text: "XK42PLM" })],
    exemptTicketReferences: [d({ text: "ZZT-7" })],
    spanHeads: [d({ text: "fizz" })],
    substringCi: [{ hash: d({ text: "quuxcorp" }), length: 8 }],
    substringCs: [{ hash: d({ text: "Blorpo" }), length: 6 }],
    teamKeys: [d({ text: "ZZT" })],
    wordCi: [d({ text: PLANTED_WORD })],
    wordCs: [d({ text: "Fizz Wobble" })],
  },
  providerLocations: [
    {
      allowed: ["acme"],
      marker: "slack.com",
      provider: "slack",
      re: /(?<![a-z0-9%\\-])([a-z0-9-]+)\.slack\.com/gi,
    },
  ],
};

/** One planted hit and one near miss per kind; the provider location is assembled so this file plants nothing. */
const KIND_CASES: readonly { kind: IdentifierKind; planted: string; nearMiss: string }[] = [
  { kind: "forbidden-substring-ci", nearMiss: "quux corp", planted: "the MyQuuxCorpTeam board" },
  { kind: "forbidden-substring-cs", nearMiss: "theblorpoapp", planted: "theBlorpoApp" },
  { kind: "forbidden-word-ci", nearMiss: "the zorblatts", planted: "ZORBLATT said" },
  { kind: "forbidden-word-cs", nearMiss: "fizz wobble", planted: "met Fizz Wobble today" },
  { kind: "forbidden-embedded-upper", nearMiss: "U0QZVX12", planted: "U0QZV12" },
  { kind: "forbidden-exact-id", nearMiss: "XK42PLM9", planted: "in XK42PLM here" },
  { kind: "forbidden-team-key", nearMiss: "ZZT-7", planted: "see ZZT-12" },
  {
    kind: "forbidden-provider-location",
    nearMiss: "https://acme.slack.com",
    planted: `https://${"wobble"}.slack.com/archives`,
  },
];

/** The redacted refusal the gate prints for one identifier hit. */
const refusal = ({ kind, line, path }: { kind: string; line: number; path: string }): string =>
  `PR ${path} contains a ${kind} identifier at line ${String(line)} — replace it with a synthetic stand-in (the matched text is redacted from this log).`;

describe("scanPrMetadataLeaks", () => {
  it("refuses a planted hit of every identifier kind, and passes the near miss beside it", () => {
    expect(KIND_CASES.map(({ kind }) => kind)).toEqual([...IDENTIFIER_KINDS]);
    expect(
      KIND_CASES.map(({ planted }) =>
        scanPrMetadataLeaks({ body: planted, denylist: DENYLIST, identifierRules: SYNTHETIC_RULES }),
      ),
    ).toStrictEqual(
      KIND_CASES.map(({ kind }) => ({ errors: [refusal({ kind, line: 1, path: "body" })], identifierReports: [] })),
    );
    expect(
      KIND_CASES.map(({ nearMiss }) =>
        scanPrMetadataLeaks({ body: nearMiss, denylist: DENYLIST, identifierRules: SYNTHETIC_RULES }),
      ),
    ).toStrictEqual(KIND_CASES.map(() => ({ errors: [], identifierReports: [] })));
  });

  it("refuses forbidden identifiers in title and body one redacted error each, with no report note", () => {
    const result = scanPrMetadataLeaks({
      body: `see the Zorblatt plan\nin https://${"wobble"}.slack.com/archives`,
      denylist: DENYLIST,
      identifierRules: SYNTHETIC_RULES,
      title: "zorblatt rollout",
    });
    expect(result).toStrictEqual({
      errors: [
        refusal({ kind: "forbidden-word-ci", line: 1, path: "title" }),
        refusal({ kind: "forbidden-word-ci", line: 1, path: "body" }),
        refusal({ kind: "forbidden-provider-location", line: 2, path: "body" }),
      ],
      identifierReports: [],
    });
    expect(result.errors.some((error) => error.toLowerCase().includes(PLANTED_WORD))).toBe(false);
    expect(result.errors.some((error) => error.includes(d({ text: PLANTED_WORD })))).toBe(false);
  });

  it("refuses a credential and an identifier side by side, the credential first", () => {
    expect(
      scanPrMetadataLeaks({
        body: `zorblatt token=ghp_${"a".repeat(30)}`,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
      }),
    ).toStrictEqual({
      errors: [
        "PR body contains a github-oauth-token shape at line 1 — remove it (the matched text is redacted from this log).",
        refusal({ kind: "forbidden-word-ci", line: 1, path: "body" }),
      ],
      identifierReports: [],
    });
  });
});

/** A synthetic repository whose owner is the planted forbidden word, the shape the policy exempts. */
const OWN_REPOSITORY = `${PLANTED_WORD}/widgets`;

describe("the pull request's own repository slug", () => {
  const ownSlugBody = [
    `Bumps https://github.com/${OWN_REPOSITORY}/pull/12 and ${OWN_REPOSITORY}#12.`,
    `proof at ${OWN_REPOSITORY.toUpperCase()}@abc123, in (${OWN_REPOSITORY})`,
  ].join("\n");

  it("is refused with no own repository, and not counted with it", () => {
    expect(
      scanPrMetadataLeaks({ body: ownSlugBody, denylist: DENYLIST, identifierRules: SYNTHETIC_RULES }).errors,
    ).toStrictEqual([
      refusal({ kind: "forbidden-word-ci", line: 1, path: "body" }),
      refusal({ kind: "forbidden-word-ci", line: 1, path: "body" }),
      refusal({ kind: "forbidden-word-ci", line: 2, path: "body" }),
      refusal({ kind: "forbidden-word-ci", line: 2, path: "body" }),
    ]);
    expect(
      scanPrMetadataLeaks({
        body: ownSlugBody,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        ownRepository: OWN_REPOSITORY,
        title: `chore: bump ${OWN_REPOSITORY}`,
      }),
    ).toStrictEqual({ errors: [], identifierReports: [] });
  });

  it("still refuses the owner alone, a sibling repository and a longer name under the same owner", () => {
    const body = [
      `the ${PLANTED_WORD} org`,
      `see ${PLANTED_WORD}/gadgets`,
      `see ${OWN_REPOSITORY}-extra`,
      `see ${OWN_REPOSITORY}.v2`,
      `see ${OWN_REPOSITORY}..extra`,
      `see ${OWN_REPOSITORY}.`,
      `see https://github.com/other/${OWN_REPOSITORY}`,
    ].join("\n");
    expect(
      scanPrMetadataLeaks({
        body,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        ownRepository: OWN_REPOSITORY,
      }).errors,
    ).toStrictEqual([1, 2, 3, 4, 5, 6, 7].map((line) => refusal({ kind: "forbidden-word-ci", line, path: "body" })));
  });

  it("still refuses an identifier the own repository's NAME carries, only its owner going uncounted", () => {
    const ownWithLocation = `${PLANTED_WORD}/${"wobble"}.slack.com`;
    expect(
      scanPrMetadataLeaks({
        body: `see ${ownWithLocation}`,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        ownRepository: ownWithLocation,
      }).errors,
    ).toStrictEqual([refusal({ kind: "forbidden-provider-location", line: 1, path: "body" })]);
  });

  it("exempts nothing when the value is not one owner/repo slug", () => {
    expect(
      ["", PLANTED_WORD, `${OWN_REPOSITORY}/extra`, `${PLANTED_WORD} /widgets`].map(
        (ownRepository) =>
          scanPrMetadataLeaks({
            body: `see ${OWN_REPOSITORY}`,
            denylist: DENYLIST,
            identifierRules: SYNTHETIC_RULES,
            ownRepository,
          }).errors,
      ),
    ).toStrictEqual([0, 1, 2, 3].map(() => [refusal({ kind: "forbidden-word-ci", line: 1, path: "body" })]));
  });

  it("leaves the credential half reading the bytes as written", () => {
    expect(
      prMetadataLeakErrors({
        body: `${OWN_REPOSITORY} token=ghp_${"a".repeat(30)}`,
        denylist: DENYLIST,
        ownRepository: OWN_REPOSITORY,
      }),
    ).toStrictEqual([
      "PR body contains a github-oauth-token shape at line 1 — remove it (the matched text is redacted from this log).",
    ]);
  });
});

describe("the installation's own identifiers, off this build's own repository", () => {
  const OWN = { linearTeamKeys: ["ZZT"], personNames: [], providerLocationLabels: [] };

  it("lets the installation's own team key through a title, and still refuses a foreign one", () => {
    const scan = ({ keys }: { keys: readonly string[] }): readonly string[] =>
      scanPrMetadataLeaks({
        body: "",
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        installationIdentifiers: { ...OWN, linearTeamKeys: keys },
        title: "feat(ZZT-12): ship",
      }).errors;
    expect(scan({ keys: ["ZZT"] })).toStrictEqual([]);
    expect(scan({ keys: ["QQA"] })).toStrictEqual([refusal({ kind: "forbidden-team-key", line: 1, path: "title" })]);
    expect(
      scanPrMetadataLeaks({
        body: "",
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        title: "feat(ZZT-12): ship",
      }).errors,
    ).toStrictEqual([refusal({ kind: "forbidden-team-key", line: 1, path: "title" })]);
  });

  it("forgives the whole own address, not only its owner, once the installation's identifiers apply", () => {
    const ownWithLocation = `${PLANTED_WORD}/${"wobble"}.slack.com`;
    expect(
      scanPrMetadataLeaks({
        body: `see https://github.com/${ownWithLocation}/commit/abc`,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        installationIdentifiers: OWN,
        ownRepository: ownWithLocation,
      }).errors,
    ).toStrictEqual([]);
  });

  it("forgives the own address's name only inside an occurrence of that address, never standing alone", () => {
    const own = `acme/${PLANTED_WORD}`;
    expect(
      scanPrMetadataLeaks({
        body: `see https://github.com/${own}/pull/1\nthe ${PLANTED_WORD} rollout`,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        installationIdentifiers: OWN,
        ownRepository: own,
      }).errors,
    ).toStrictEqual([refusal({ kind: "forbidden-word-ci", line: 2, path: "body" })]);
  });

  it("forgives what the occurrence AS WRITTEN carries, so a differently cased address spends nothing on a name beside it", () => {
    const scan = ({ body, own, identifiers }: { body: string; own: string; identifiers?: typeof OWN }) =>
      scanPrMetadataLeaks({
        body,
        denylist: DENYLIST,
        identifierRules: SYNTHETIC_RULES,
        installationIdentifiers: identifiers,
        ownRepository: own,
      }).errors;
    const refused = [refusal({ kind: "forbidden-substring-cs", line: 1, path: "body" })];
    expect(scan({ body: "see acme/blorpo and theBlorpoApp", identifiers: OWN, own: "acme/Blorpo" })).toStrictEqual(
      refused,
    );
    expect(scan({ body: "see blorpo/web and theBlorpoApp", own: "Blorpo/web" })).toStrictEqual(refused);
    expect(scan({ body: "see acme/Blorpo and theBlorpoApp", identifiers: OWN, own: "acme/Blorpo" })).toStrictEqual(
      refused,
    );
    expect(scan({ body: "see acme/Blorpo", identifiers: OWN, own: "acme/Blorpo" })).toStrictEqual([]);
    expect(scan({ body: "see Blorpo/tool", own: "blorpo/tool" })).toStrictEqual(refused);
    expect(scan({ body: "see acme/Blorpo", identifiers: OWN, own: "acme/blorpo" })).toStrictEqual(refused);
  });

  it("never forgives a credential", () => {
    expect(
      prMetadataLeakErrors({
        body: `ZZT-12 token=ghp_${"a".repeat(30)}`,
        denylist: DENYLIST,
        installationIdentifiers: OWN,
      }),
    ).toStrictEqual([
      "PR body contains a github-oauth-token shape at line 1 — remove it (the matched text is redacted from this log).",
    ]);
  });
});

describe("prFormatResult folds the denylist scan into the gate", () => {
  it("fails a conforming body when the title leaks a denylisted term", () => {
    const result = prFormatResult({
      body: CONFORMING_BODY,
      bots: GENERIC,
      denylist: DENYLIST,
      title: "hunter2-legacy-passphrase rollout",
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("denylisted term at line");
    expect(result.summary.includes("hunter2")).toBe(false);
  });

  it("passes a conforming body with clean metadata", () => {
    const result = prFormatResult({
      author: "octocat",
      body: CONFORMING_BODY,
      bots: GENERIC,
      denylist: DENYLIST,
      title: "fast-feedback dev loop",
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("PR description conforms");
  });
});
