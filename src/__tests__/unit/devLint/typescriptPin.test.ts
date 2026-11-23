/**
 * The TypeScript pin invariant over planted manifests and lockfiles — the live 6.0.3 policy and the 7.1
 * policy both proved while the live pin is still 6.0.3, and every dual-toolchain shape refused by name.
 */

import { describe, expect, it } from "vitest";

import { type TrackedText, typescriptPinFindings } from "../../../devLint/typescriptPin.js";

const BETA = "7.1.0-beta";
const MANIFESTS = ["desktop/package.json", "package.json", "site/package.json"];
const LOCKFILES = ["desktop/yarn.lock", "site/yarn.lock", "yarn.lock"];
const SET = "(tracked tree)";

/**
 * A manifest with the given devDependencies and any other top-level fields.
 *
 * @param path the manifest's repo-relative path
 * @param devDependencies the devDependencies block
 * @param extra any other top-level fields
 * @returns the subject
 */
function manifest({
  path,
  devDependencies,
  extra = {},
}: {
  path: string;
  devDependencies: Record<string, string>;
  extra?: Record<string, unknown>;
}): TrackedText {
  return { path, text: JSON.stringify({ devDependencies, name: "acme", ...extra }) };
}

/**
 * A Yarn Berry lockfile with the given entries after the metadata header.
 *
 * @param path the lockfile's repo-relative path
 * @param entries each entry's header and its indented body lines
 * @returns the subject
 */
function lockfile({ path, entries }: { path: string; entries: readonly (readonly [string, string])[] }): TrackedText {
  const body = entries.map(([header, fields]) => `${header}:\n${fields}\n`);
  return { path, text: ["# acme lockfile\n", "__metadata:\n  version: 8\n  cacheKey: 10c0\n", ...body].join("\n") };
}

/**
 * The lock entry body for one resolution.
 *
 * @param resolution what the entry installed
 * @returns its indented fields
 */
function resolved({ resolution }: { resolution: string }): string {
  return `  version: 0.0.0\n  resolution: "${resolution}"\n  languageName: node`;
}

/**
 * The builtin compat patch's resolution, with its two version fields set independently.
 *
 * @param encoded the version encoded in the underlying npm locator
 * @param metadata the `::version=` field
 * @returns the resolution string
 */
function compatPatch({ encoded, metadata }: { encoded: string; metadata: string }): string {
  return `typescript@patch:typescript@npm%3A${encoded}#optional!builtin<compat/typescript>::version=${metadata}&hash=5786d5`;
}

/**
 * A clean lockfile pinning the given version, plain and through the builtin compat patch.
 *
 * @param path the lockfile's repo-relative path
 * @param version the resolved version
 * @returns the subject
 */
function cleanLock({ path, version }: { path: string; version: string }): TrackedText {
  return lockfile({
    entries: [
      [`"typescript@npm:${version}"`, resolved({ resolution: `typescript@npm:${version}` })],
      [
        `"typescript@patch:typescript@npm%3A${version}#optional!builtin<compat/typescript>"`,
        resolved({ resolution: compatPatch({ encoded: version, metadata: version }) }),
      ],
      ['"zod@npm:4.0.0"', resolved({ resolution: "zod@npm:4.0.0" })],
    ],
    path,
  });
}

/**
 * The three TypeScript-bearing manifests at one version, plus the non-TypeScript stub.
 *
 * @param version the pinned version
 * @returns the four manifests
 */
function cleanManifests({ version }: { version: string }): TrackedText[] {
  return [
    manifest({ devDependencies: { typescript: version }, path: "desktop/package.json" }),
    manifest({ devDependencies: { typescript: version, zod: "4.0.0" }, path: "package.json" }),
    manifest({ devDependencies: { typescript: version }, path: "site/package.json" }),
    manifest({ devDependencies: { sharp: "0.0.0" }, path: "stubs/sharp/package.json" }),
  ];
}

/**
 * The findings, as kind and path, for a 7.1 tree whose clean defaults the case overrides.
 *
 * @param manifests the manifests, else the clean set
 * @param lockfiles the lockfiles, else the clean set
 * @param expected the pinned version, else the 7.1 beta
 * @param foreignLockfiles another package manager's tracked lockfiles, else none
 * @returns each finding's kind and path, in the scanner's order
 */
function judge({
  manifests = cleanManifests({ version: BETA }),
  lockfiles = LOCKFILES.map((path) => cleanLock({ path, version: BETA })),
  expected = BETA,
  foreignLockfiles = [],
}: {
  manifests?: readonly TrackedText[];
  lockfiles?: readonly TrackedText[];
  expected?: string;
  foreignLockfiles?: readonly string[];
}): readonly { kind: string; path: string }[] {
  return typescriptPinFindings({
    expected,
    expectedLockfiles: LOCKFILES,
    expectedManifests: MANIFESTS,
    foreignLockfiles,
    lockfiles,
    manifests,
  }).map(({ kind, path }) => ({ kind, path }));
}

/**
 * The clean lock set with `yarn.lock` replaced.
 *
 * @param root the root lockfile to use
 * @returns the three lockfiles
 */
function withRootLock({ root }: { root: TrackedText }): TrackedText[] {
  return [
    cleanLock({ path: "desktop/yarn.lock", version: BETA }),
    cleanLock({ path: "site/yarn.lock", version: BETA }),
    root,
  ];
}

describe("typescriptPinFindings", () => {
  it("passes today's tree: three 6.0.3 pins, the Sharp stub, plain and builtin-patch resolutions", () => {
    expect(
      judge({
        expected: "6.0.3",
        lockfiles: LOCKFILES.map((path) => cleanLock({ path, version: "6.0.3" })),
        manifests: cleanManifests({ version: "6.0.3" }),
      }),
    ).toEqual([]);
  });

  it("passes the 7.1 beta tree the flip lands", () => {
    expect(judge({})).toEqual([]);
  });

  it("refuses today's 6.0.3 tree under the 7.1 policy, every pin and every resolution", () => {
    expect(
      judge({
        lockfiles: LOCKFILES.map((path) => cleanLock({ path, version: "6.0.3" })),
        manifests: cleanManifests({ version: "6.0.3" }),
      }),
    ).toEqual([
      { kind: "direct-pin-mismatch", path: "desktop/package.json" },
      { kind: "lock-resolution-mismatch", path: "desktop/yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "desktop/yarn.lock" },
      { kind: "direct-pin-mismatch", path: "package.json" },
      { kind: "direct-pin-mismatch", path: "site/package.json" },
      { kind: "lock-resolution-mismatch", path: "site/yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "site/yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
    ]);
  });

  it("refuses a caret range and a pin in resolutions", () => {
    const manifests = cleanManifests({ version: BETA });
    manifests[1] = manifest({
      devDependencies: { typescript: `^${BETA}` },
      extra: { resolutions: { typescript: "6.0.3" } },
      path: "package.json",
    });
    expect(judge({ manifests })).toEqual([
      { kind: "direct-pin-mismatch", path: "package.json" },
      { kind: "direct-pin-mismatch", path: "package.json" },
    ]);
  });

  // A `resolutions` key is a selector, and `typescript@npm:6.0.3` named no package the
  // scanner knew, so a redirect to 5.9.3 passed while Yarn installed it.
  it("reads a resolutions key as Yarn's selector, judging the package it redirects and naming one it cannot read", () => {
    const manifests = cleanManifests({ version: BETA });
    manifests[1] = manifest({
      devDependencies: { typescript: BETA },
      extra: {
        resolutions: {
          "**/typescript": "6.0.3",
          "@acme": "1.0.0",
          "@typescript/typescript6@npm:6.0.3": "6.0.3",
          "acme@1/zod": "4.0.0",
          "parent@1/typescript@^6": "6.0.3",
          "typescript@npm:6.0.3": "npm:5.9.3",
        },
      },
      path: "package.json",
    });
    // In message order, which `localeCompare` reads past punctuation: @acme, @typescript/…, then the three
    // `typescript` targets.
    expect(judge({ manifests })).toEqual([
      { kind: "invalid-input", path: "package.json" },
      { kind: "forbidden-typescript6-package", path: "package.json" },
      { kind: "direct-pin-mismatch", path: "package.json" },
      { kind: "direct-pin-mismatch", path: "package.json" },
      { kind: "direct-pin-mismatch", path: "package.json" },
    ]);
  });

  it("refuses the @typescript/typescript6 package by name and by alias, and an alias to typescript", () => {
    const manifests = cleanManifests({ version: BETA });
    manifests[1] = manifest({
      devDependencies: {
        "@typescript/typescript6": "6.0.3",
        tsclassic: "npm:@typescript/typescript6@6.0.3",
        tsold: "npm:typescript@6.0.3",
        typescript: BETA,
      },
      path: "package.json",
    });
    expect(judge({ manifests })).toEqual([
      { kind: "forbidden-typescript6-package", path: "package.json" },
      { kind: "forbidden-typescript6-package", path: "package.json" },
      { kind: "forbidden-typescript-alias", path: "package.json" },
    ]);
  });

  // `tsold: "patch:typescript@npm%3A5.9.3#…"` passed both scans, which tested prefixes.
  it("refuses a TypeScript nested under any protocol, and a compiler found only by its bin, never a scoped look-alike", () => {
    const manifests = cleanManifests({ version: BETA });
    manifests[1] = manifest({
      devDependencies: {
        scoped: "npm:@acme/typescript@1.0.0",
        ts6patch: "patch:@typescript/typescript6@npm%3A6.0.3#~/.yarn/patches/x.patch",
        tsold: "patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>",
        typescript: BETA,
      },
      path: "package.json",
    });
    const tsc = "\n  bin:\n    tsc: bin/tsc";
    const root = lockfile({
      entries: [
        [`"typescript@npm:${BETA}"`, `${resolved({ resolution: `typescript@npm:${BETA}` })}${tsc}`],
        ['"tsold@patch:a"', resolved({ resolution: `tsold@${compatPatch({ encoded: "5.9.3", metadata: "5.9.3" })}` })],
        ['"compiler@https://acme.test/c.tgz"', `${resolved({ resolution: "compiler@https://acme.test/c.tgz" })}${tsc}`],
        ['"@acme/typescript@npm:1.0.0"', resolved({ resolution: "@acme/typescript@npm:1.0.0" })],
      ],
      path: "yarn.lock",
    });
    expect(judge({ lockfiles: withRootLock({ root }), manifests })).toEqual([
      { kind: "forbidden-typescript6-package", path: "package.json" },
      { kind: "forbidden-typescript-alias", path: "package.json" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
    ]);
  });

  // Yarn 4.18.1 locked a portal to a vendored 5.9.3 as `typescript: bin/tsc`, and
  // `yarn install --immutable` installed it beside the pin with neither manifest naming `typescript@`.
  it("refuses a tracked copy of a compiler by its own name, and a lock entry by a compiler bin target", () => {
    const manifests = [
      ...cleanManifests({ version: BETA }),
      manifest({ devDependencies: {}, extra: { name: "@typescript/typescript6" }, path: "vendor/ts6/package.json" }),
      manifest({ devDependencies: {}, extra: { name: "typescript" }, path: "vendor/typescript/package.json" }),
    ];
    manifests[1] = manifest({
      devDependencies: { tsold: "portal:./vendor/typescript", typescript: BETA },
      path: "package.json",
    });
    const portal = "tsold@portal:./vendor/typescript::locator=acme%40workspace%3A.";
    const root = lockfile({
      entries: [
        [`"${portal}"`, `${resolved({ resolution: portal })}\n  bin:\n    typescript: bin/tsc`],
        ['"tss@file:./t.tgz"', `${resolved({ resolution: "tss@file:./t.tgz" })}\n  bin:\n    tss: ./bin/tsserver.js`],
        ['"cc@file:./c.tgz"', `${resolved({ resolution: "cc@file:./c.tgz" })}\n  bin:\n    compiler: bin/tsc.sh`],
        ['"eslint@npm:9.0.0"', `${resolved({ resolution: "eslint@npm:9.0.0" })}\n  bin:\n    eslint: bin/eslint.js`],
      ],
      path: "yarn.lock",
    });
    expect(judge({ lockfiles: withRootLock({ root }), manifests })).toEqual([
      { kind: "vendored-typescript", path: "vendor/ts6/package.json" },
      { kind: "vendored-typescript", path: "vendor/typescript/package.json" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
    ]);
  });

  it("refuses a @typescript/typescript6 resolution and an older typescript resolved for a dependant", () => {
    const root = lockfile({
      entries: [
        [`"typescript@npm:${BETA}"`, resolved({ resolution: `typescript@npm:${BETA}` })],
        ['"@typescript/typescript6@npm:6.0.3"', resolved({ resolution: "@typescript/typescript6@npm:6.0.3" })],
        ['"typescript@npm:^5.0.0, typescript@npm:^6.0.0"', resolved({ resolution: "typescript@npm:6.0.3" })],
      ],
      path: "yarn.lock",
    });
    expect(judge({ lockfiles: withRootLock({ root }) })).toEqual([
      { kind: "forbidden-typescript6-package", path: "yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
    ]);
  });

  it("refuses the builtin compat patch when either of its two version fields is not the pin", () => {
    const root = lockfile({
      entries: [
        ['"typescript@patch:a"', resolved({ resolution: compatPatch({ encoded: "6.0.3", metadata: BETA }) })],
        ['"typescript@patch:b"', resolved({ resolution: compatPatch({ encoded: BETA, metadata: "6.0.3" }) })],
      ],
      path: "yarn.lock",
    });
    expect(judge({ lockfiles: withRootLock({ root }) })).toEqual([
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
    ]);
  });

  it("refuses a typescript patch that is not Yarn's builtin compat patch", () => {
    const resolution = `typescript@patch:typescript@npm%3A${BETA}#~/.yarn/patches/typescript.patch::version=${BETA}&hash=abc123`;
    const root = lockfile({ entries: [['"typescript@patch:c"', resolved({ resolution })]], path: "yarn.lock" });
    expect(judge({ lockfiles: withRootLock({ root }) })).toEqual([
      { kind: "lock-resolution-mismatch", path: "yarn.lock" },
    ]);
  });

  it("ignores a peer range naming an older TypeScript on an entry that resolves something else", () => {
    const root = lockfile({
      entries: [
        [`"typescript@npm:${BETA}"`, resolved({ resolution: `typescript@npm:${BETA}` })],
        [
          '"twoslash@npm:0.3.9"',
          `${resolved({ resolution: "twoslash@npm:0.3.9" })}\n  peerDependencies:\n    typescript: ^5.5 || ^6`,
        ],
      ],
      path: "yarn.lock",
    });
    expect(judge({ lockfiles: withRootLock({ root }) })).toEqual([]);
  });

  // A peer range installs no compiler, so a manifest declaring one is neither a mismatch
  // nor a fourth TypeScript-bearing manifest.
  it("ignores a peer range naming an older TypeScript in a manifest outside the set", () => {
    const manifests = cleanManifests({ version: BETA });
    manifests[3] = manifest({
      devDependencies: { sharp: "0.0.0" },
      extra: { peerDependencies: { typescript: "^5.5 || ^6" } },
      path: "stubs/sharp/package.json",
    });
    expect(judge({ manifests })).toEqual([]);
  });

  // A `package-lock.json` resolving 5.9.3 beside a manifest naming no TypeScript left the
  // gate clean, because only `yarn.lock` was ever listed.
  it("refuses another package manager's lockfile by its presence, beside a manifest naming no TypeScript", () => {
    const manifests = [
      ...cleanManifests({ version: BETA }),
      manifest({ devDependencies: {}, path: "tools/package.json" }),
    ];
    expect(judge({ foreignLockfiles: ["tools/package-lock.json"], manifests })).toEqual([
      { kind: "foreign-lockfile", path: "tools/package-lock.json" },
    ]);
  });

  it("names a missing TypeScript manifest and a missing lockfile, so an empty scan never passes", () => {
    const manifests = cleanManifests({ version: BETA }).filter(({ path }) => path !== "site/package.json");
    const lockfiles = LOCKFILES.filter((path) => path !== "desktop/yarn.lock").map((path) =>
      cleanLock({ path, version: BETA }),
    );
    expect(judge({ lockfiles, manifests })).toEqual([
      { kind: "lockfile-set-mismatch", path: SET },
      { kind: "manifest-set-mismatch", path: SET },
    ]);
    expect(judge({ lockfiles: [], manifests: [] })).toEqual([
      { kind: "lockfile-set-mismatch", path: SET },
      { kind: "manifest-set-mismatch", path: SET },
    ]);
  });

  it("names a fourth manifest that starts naming TypeScript, while a manifest that does not is ignored", () => {
    const manifests = [
      ...cleanManifests({ version: BETA }),
      manifest({ devDependencies: { typescript: BETA }, path: "tools/package.json" }),
    ];
    const findings = typescriptPinFindings({
      expected: BETA,
      expectedLockfiles: LOCKFILES,
      expectedManifests: MANIFESTS,
      foreignLockfiles: [],
      lockfiles: LOCKFILES.map((path) => cleanLock({ path, version: BETA })),
      manifests,
    });
    expect(findings.map(({ message }) => message)).toEqual([
      "the TypeScript-bearing manifests are [desktop/package.json, package.json, site/package.json, tools/package.json], " +
        "expected exactly [desktop/package.json, package.json, site/package.json]",
    ]);
  });

  // An entry with no resolution was skipped, `tsc` bin and all.
  it("names a lock entry with no resolution as unjudged input, while the metadata header needs none", () => {
    const root = lockfile({
      entries: [
        [`"typescript@npm:${BETA}"`, resolved({ resolution: `typescript@npm:${BETA}` })],
        ['"compiler@https://acme.test/c.tgz"', "  version: 5.9.3\n  bin:\n    tsc: bin/tsc"],
      ],
      path: "yarn.lock",
    });
    expect(judge({ lockfiles: withRootLock({ root }) })).toEqual([{ kind: "invalid-input", path: "yarn.lock" }]);
  });

  it("names a manifest that is not JSON and a lockfile that is not YAML as unjudged input", () => {
    const manifests = [...cleanManifests({ version: BETA }), { path: "stubs/other/package.json", text: "{ nope" }];
    const root = { path: "yarn.lock", text: '"typescript@npm:1":\n  resolution: [unclosed\n' };
    expect(judge({ lockfiles: withRootLock({ root }), manifests })).toEqual([
      { kind: "invalid-input", path: "stubs/other/package.json" },
      { kind: "invalid-input", path: "yarn.lock" },
    ]);
  });
});
