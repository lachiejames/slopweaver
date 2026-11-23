import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_IDENTIFIER_RULES } from "../../../hygiene/forbiddenIdentifiers.js";
import { type ForbiddenIdentifierRules, identifierDigest, identifierScanner } from "../../../hygiene/identifierScan.js";
import {
  CODE_OWNERS_PATH,
  codeOwnerAccountRanges,
  identifierHitsBesideOwnRepository,
  OWNER_REFERENCE_DIGEST,
  OWNER_REFERENCE_PATH,
  ownAddressRanges,
  ownerReferenceRange,
  repositoryContentIdentifierScanner,
  SOURCE_REPOSITORY,
} from "../../../hygiene/ownRepository.js";

/** A planted owner word, never a real one; the location label is assembled so this file plants nothing. */
const OWNER = "zorblatt";
const OWN = `${OWNER}/widgets`;
const LABEL = "wobble";
const d = ({ text }: { text: string }): string => identifierDigest({ text });
const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [d({ text: "foo" })],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [d({ text: OWNER }), d({ text: `foo ${OWNER}` })],
    wordCs: [],
  },
  providerLocations: [
    { allowed: [], marker: "slack.com", provider: "slack", re: /(?<![a-z0-9%\\-])([a-z0-9-]+)\.slack\.com/gi },
  ],
};

const hits = ({ content, ownRepository }: { content: string; ownRepository: string | undefined }) =>
  identifierHitsBesideOwnRepository({ content, ownRepository, path: "body", rules: RULES });
const word = ({ line }: { line: number }) => ({ kind: "forbidden-word-ci", line, path: "body" });

describe("identifierHitsBesideOwnRepository", () => {
  it("does not count the owner of each whole own-slug occurrence, case-insensitively", () => {
    const content = [
      `see https://github.com/${OWN}/pull/1, ${OWN.toUpperCase()}#2 and (${OWN})`,
      `github.com/${OWN}/pull/3 <https://www.github.com/${OWN}>`,
    ].join("\n");
    expect(hits({ content, ownRepository: OWN })).toStrictEqual([]);
  });

  it("gives up every hit a hyphenated owner produces alone, and no more", () => {
    const rules: ForbiddenIdentifierRules = {
      ...RULES,
      hashed: { ...RULES.hashed, wordCi: [d({ text: "foo" }), d({ text: "bar" })] },
    };
    const scan = ({ content }: { content: string }) =>
      identifierHitsBesideOwnRepository({ content, ownRepository: "foo-bar/widgets", path: "body", rules });
    expect(scan({ content: "see foo-bar/widgets" })).toStrictEqual([]);
    expect(scan({ content: "foo said foo-bar/widgets" })).toStrictEqual([word({ line: 1 })]);
  });

  it("counts every hit with no slug or a malformed one", () => {
    expect(
      [undefined, "", OWNER, `${OWN}/extra`, `${OWNER} /widgets`].map((ownRepository) =>
        hits({ content: `see ${OWN}`, ownRepository }),
      ),
    ).toStrictEqual([0, 1, 2, 3, 4].map(() => [word({ line: 1 })]));
  });

  it("still counts the owner alone beside the slug, and a multi-word name ending in the owner", () => {
    expect(hits({ content: `${OWNER} said ${OWN}\nFoo ${OWN}`, ownRepository: OWN })).toStrictEqual([
      word({ line: 1 }),
      word({ line: 2 }),
    ]);
  });

  it("still counts an identifier the own repository's NAME carries", () => {
    const own = `${OWNER}/${LABEL}.slack.com`;
    expect(hits({ content: `see ${own}`, ownRepository: own })).toStrictEqual([
      { kind: "forbidden-provider-location", line: 1, path: "body" },
    ]);
  });

  it("counts the owner of a path that only ends in the slug, or a longer name", () => {
    const lines = [
      `https://github.com/other/${OWN}`,
      `see other/${OWN}`,
      `see other\\${OWN}`,
      `see other:${OWN}`,
      `https://x.github.com/${OWN}`,
      `https://evil.example/github.com/${OWN}`,
      `see ${OWN}.v2`,
      `see ${OWN}.`,
      `see ${OWN}\\extra`,
      `see ${OWN}-extra`,
    ];
    expect(hits({ content: lines.join("\n"), ownRepository: OWN })).toStrictEqual(
      lines.map((_, index) => word({ line: index + 1 })),
    );
  });
});

// Against the COMMITTED rules: the source repository's owner is a forbidden word there, so every expected hit below is
// that rule firing. The owner is derived from the address, so this file spells no name the rules hold.
const SOURCE_OWNER = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));
const contentScanner = repositoryContentIdentifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES });
const at = ({ line, path }: { line: number; path: string }) => ({ kind: "forbidden-word-ci", line, path });

describe("repositoryContentIdentifierScanner", () => {
  it("counts the source repository's owner on its own, so the forgiveness below is not vacuous", () => {
    expect(contentScanner.scan({ content: `see ${SOURCE_OWNER}`, path: "a.md" })).toStrictEqual([
      at({ line: 1, path: "a.md" }),
    ]);
  });

  it("forgives the source address as source spells it: a link, a route, an SSH remote, a list, any case", () => {
    const lines = [
      `see ${SOURCE_REPOSITORY}`,
      `https://github.com/${SOURCE_REPOSITORY}/pull/1`,
      `git@github.com:${SOURCE_REPOSITORY}.git`,
      `{ path: "/pull-requests/${SOURCE_REPOSITORY}/1866" }`,
      `acme/acme-admin,${SOURCE_REPOSITORY}@@me`,
      `pr=${SOURCE_REPOSITORY.toUpperCase()}#2`,
      `it ends on ${SOURCE_REPOSITORY}.`,
    ];
    expect(contentScanner.scan({ content: lines.join("\n"), path: "a.ts" })).toStrictEqual([]);
  });

  it("still counts the owner outside the address, a longer name, and the owner glued to another word", () => {
    const lines = [
      `${SOURCE_OWNER} said ${SOURCE_REPOSITORY}`,
      `${SOURCE_OWNER}/other-repo`,
      `${SOURCE_OWNER}:a-branch`,
      `see other.${SOURCE_REPOSITORY}`,
      `see ${SOURCE_REPOSITORY}-extra`,
      `see ${SOURCE_REPOSITORY}.v2`,
    ];
    expect(contentScanner.scan({ content: lines.join("\n"), path: "a.ts" })).toStrictEqual(
      lines.map((_, index) => at({ line: index + 1, path: "a.ts" })),
    );
  });

  it("forgives the owner's account on a code-owner rule row, and nowhere else in that file", () => {
    const file = [`# reviews by @${SOURCE_OWNER}`, `* @${SOURCE_OWNER}`, `/docs/ ${SOURCE_OWNER} @acme/docs`].join(
      "\n",
    );
    expect(contentScanner.scan({ content: file, path: CODE_OWNERS_PATH })).toStrictEqual([
      at({ line: 1, path: CODE_OWNERS_PATH }),
      at({ line: 3, path: CODE_OWNERS_PATH }),
    ]);
  });

  it("does not forgive a code-owner row at any other path", () => {
    expect(contentScanner.scan({ content: `* @${SOURCE_OWNER}`, path: "docs/CODEOWNERS" })).toStrictEqual([
      at({ line: 1, path: "docs/CODEOWNERS" }),
    ]);
  });

  it("keeps no budget between two files scanned by one scanner", () => {
    const first = contentScanner.scan({ content: `see ${SOURCE_REPOSITORY}`, path: "a.md" });
    const second = contentScanner.scan({ content: `see ${SOURCE_OWNER}`, path: "b.md" });
    expect([first, second]).toStrictEqual([[], [at({ line: 1, path: "b.md" })]]);
  });
});

// The owner reference is read out of the committed README by its digest, so this file never spells it either.
const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", OWNER_REFERENCE_PATH),
  "utf8",
);
const REFERENCE = [...README.matchAll(/\[[^\]\n]+\]\([^)\s]+\)/g)]
  .map((match) => match[0])
  .find((text) => identifierDigest({ text }) === OWNER_REFERENCE_DIGEST)!;
const unforgiven = identifierScanner({ rules: FORBIDDEN_IDENTIFIER_RULES });

describe("ownAddressRanges with the repository-content edges", () => {
  it("covers the slug's own characters, a trailing .git left out, and skips a recased or longer occurrence", () => {
    const content = `git@x:${OWN}.git ${OWN.toUpperCase()} ${OWN}-extra (${OWN})`;
    const ranges = ownAddressRanges({ content, edges: "repository-content", ownRepository: OWN });
    expect(ranges.map(({ start, end }) => content.slice(start, end))).toStrictEqual([OWN, OWN]);
    expect(ranges.map(({ start }) => start)).toStrictEqual([6, content.lastIndexOf(OWN)]);
  });

  it("keeps the recased occurrence too when asked for any case, and still skips the longer one", () => {
    const content = `git@x:${OWN}.git ${OWN.toUpperCase()} ${OWN}-extra (${OWN})`;
    const ranges = ownAddressRanges({ anyCase: true, content, edges: "repository-content", ownRepository: OWN });
    expect(ranges.map(({ start, end }) => content.slice(start, end))).toStrictEqual([OWN, OWN.toUpperCase(), OWN]);
  });
});

describe("codeOwnerAccountRanges", () => {
  const owner = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));
  const content = `# @${owner}\n* @${owner} @other # @${owner}\n/docs @${owner}-bot @${owner.toUpperCase()}\n`;

  it("covers each owner account field on a rule row, any case, never a comment or a longer handle", () => {
    const ranges = codeOwnerAccountRanges({ content, path: CODE_OWNERS_PATH });
    expect(ranges.map(({ start, end }) => content.slice(start, end))).toStrictEqual([
      `@${owner}`,
      `@${owner.toUpperCase()}`,
    ]);
    expect(ranges.map(({ start }) => start)).toStrictEqual([
      content.indexOf(`* @${owner}`) + 2,
      content.lastIndexOf("@"),
    ]);
  });

  it("covers nothing at any other path", () => {
    expect(codeOwnerAccountRanges({ content, path: "docs/CODEOWNERS" })).toStrictEqual([]);
  });
});

describe("ownerReferenceRange", () => {
  it("is the rendered link's exact span in the README, and absent in any other file or inside code", () => {
    const content = `intro\n${REFERENCE}\n`;
    expect(ownerReferenceRange({ content, path: OWNER_REFERENCE_PATH })).toStrictEqual({
      end: 6 + REFERENCE.length,
      start: 6,
    });
    expect([
      ownerReferenceRange({ content, path: "docs/README.md" }),
      ownerReferenceRange({ content: `\`${REFERENCE}\``, path: OWNER_REFERENCE_PATH }),
    ]).toStrictEqual([undefined, undefined]);
  });
});

describe("the one owner reference", () => {
  it("is in the README exactly once, and its digest is the pinned one", () => {
    expect(README.split(REFERENCE).length - 1).toBe(1);
    expect(identifierDigest({ text: REFERENCE })).toBe(OWNER_REFERENCE_DIGEST);
  });

  it("is refused on its own, so the forgiveness below is not vacuous", () => {
    expect(unforgiven.scan({ content: REFERENCE, path: "a.md" }).length).toBeGreaterThan(0);
  });

  it("is forgiven in the README, which then scans clean", () => {
    expect(contentScanner.scan({ content: README, path: OWNER_REFERENCE_PATH })).toStrictEqual([]);
  });

  it("is refused in any other file, the same file name under another directory included", () => {
    for (const path of ["docs/README.md", "a.md", CODE_OWNERS_PATH]) {
      expect(contentScanner.scan({ content: `see ${REFERENCE}`, path })).toStrictEqual(
        unforgiven.scan({ content: `see ${REFERENCE}`, path }),
      );
    }
  });

  it("is forgiven once: a second copy in the README is refused", () => {
    expect(contentScanner.scan({ content: `${REFERENCE}\n${REFERENCE}`, path: OWNER_REFERENCE_PATH })).toStrictEqual(
      unforgiven.scan({ content: `x\n${REFERENCE}`, path: OWNER_REFERENCE_PATH }),
    );
  });

  it("is not another name in its label or another target", () => {
    const renamed = REFERENCE.replace(/^\[[^\]]+\]/, `[${SOURCE_OWNER} Other]`);
    const retargeted = REFERENCE.replace("linkedin.com", "example.com");
    for (const link of [renamed, retargeted]) {
      expect(contentScanner.scan({ content: link, path: OWNER_REFERENCE_PATH })).toStrictEqual(
        unforgiven.scan({ content: link, path: OWNER_REFERENCE_PATH }),
      );
    }
    expect(unforgiven.scan({ content: renamed, path: OWNER_REFERENCE_PATH }).length).toBeGreaterThan(0);
  });

  it("still counts another name on the reference's own line", () => {
    expect(
      contentScanner.scan({ content: `${REFERENCE} and ${SOURCE_OWNER}`, path: OWNER_REFERENCE_PATH }),
    ).toStrictEqual([at({ line: 1, path: OWNER_REFERENCE_PATH })]);
  });

  it("is not the same text where GFM renders no link: code, HTML, an image, an escape, another link", () => {
    const shapes = [
      `\`${REFERENCE}\``,
      `\`see ${REFERENCE} here\``,
      `!${REFERENCE}`,
      `\\${REFERENCE}`,
      ["```", REFERENCE, "```"].join("\n"),
      ["~~~", REFERENCE, "~~~"].join("\n"),
      `\`\`${REFERENCE}\`\``,
      ["paragraph", "", `    ${REFERENCE}`].join("\n"),
      ["paragraph", "", `\t${REFERENCE}`].join("\n"),
      `<!-- ${REFERENCE} -->`,
      ["<pre>", REFERENCE, "</pre>"].join("\n"),
      ["<code>", REFERENCE, "</code>"].join("\n"),
      ["`opened", REFERENCE, "closed`"].join("\n"),
      ["````", "code", "```", REFERENCE, "````"].join("\n"),
      ["```", "~~~", REFERENCE, "```"].join("\n"),
      ["```", "```not-a-close", REFERENCE, "```"].join("\n"),
      ["<div>", REFERENCE, "</div>"].join("\n"),
      `<span title="${REFERENCE}">text</span>`,
      `![prefix ${REFERENCE} suffix](image.png)`,
      `[outer](https://example.com/${REFERENCE})`,
      `[outer](https://example.com "${REFERENCE}")`,
    ];
    expect(shapes.length).toBeGreaterThan(0);
    for (const file of shapes) {
      expect(contentScanner.scan({ content: file, path: OWNER_REFERENCE_PATH })).toStrictEqual(
        unforgiven.scan({ content: file, path: OWNER_REFERENCE_PATH }),
      );
      expect(unforgiven.scan({ content: file, path: OWNER_REFERENCE_PATH }).length).toBeGreaterThan(0);
    }
  });

  it("is forgiven after a closed code span or a closed fence, and inside inline code HTML, where GFM still links it", () => {
    const after = [
      `\`code\` then ${REFERENCE}`,
      ["```", "code", "```", REFERENCE].join("\n"),
      `see <code>${REFERENCE}</code>`,
    ];
    expect(after.map((file) => contentScanner.scan({ content: file, path: OWNER_REFERENCE_PATH }))).toStrictEqual([
      [],
      [],
      [],
    ]);
  });
});
