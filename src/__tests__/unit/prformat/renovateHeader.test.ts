/**
 * Renovate's OWN body is never red on this repository's `pr-format` gate, so a bump is not held on its description.
 *
 * A Renovate pull request is a stranger's (`src/prformat/prBodyGate.ts`'s `prOwnership`): renovate regenerates its
 * body on every run, so no description rule could hold, and only the security scans run on it. The header lives in
 * `renovate.json`, so this reads it from there and renders what renovate draws under it: the update table its
 * `prBodyColumns` and `prBodyDefinitions` shape, then one `prBodyNotes` line per update, for every dependency the
 * manifests declare at its real version.
 *
 * The self-hosted Renovate draws {@link MEND_COLUMNS} whatever `prBodyColumns` says (MEASURED on its live bodies),
 * so every body is drawn twice here, once per column set.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SOURCE_REPOSITORY } from "../../../hygiene/ownRepository.js";
import { dependencyBotActors } from "../../../organisation/dependencyBots.js";
import { scanPrMetadataLeaks } from "../../../prformat/checkCore.js";
import { gatePrBody, prOwnership } from "../../../prformat/prBodyGate.js";

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/** The renovate settings the body depends on, read off the committed config. */
const RENOVATE = JSON.parse(readFileSync(join(process.cwd(), "renovate.json"), "utf8")) as {
  prHeader: string;
  prBodyColumns: readonly string[];
  prBodyDefinitions: Readonly<Record<string, string>>;
  prBodyNotes: readonly string[];
};

/** The columns the self-hosted Renovate actually draws, read off a live body rather than off `renovate.json`. */
const MEND_COLUMNS: readonly string[] = ["Package", "Change", "Age", "Confidence"];

/** The manifests renovate reads here, so a row is drawn for every package it could ever put in a table. */
const MANIFESTS = ["package.json", "site/package.json"];

/** One update renovate could propose: the package, the version it moves from and to, and the kind of move. */
interface Bump {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly update: string;
}

/**
 * The three moves renovate could propose off one pinned `x.y.z` version — the next patch, minor and major.
 *
 * @param version the declared pin; a range, a tag or a protocol yields no moves
 * @returns a patch, a minor and a major bump off that pin
 */
function movesFrom({ name, version }: { name: string; version: string }): readonly Bump[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) {
    return [];
  }
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return [
    { from: version, name, to: `${major}.${minor}.${patch + 1}`, update: "patch" },
    { from: version, name, to: `${major}.${minor + 1}.0`, update: "minor" },
    { from: version, name, to: `${major + 1}.0.0`, update: "major" },
  ];
}

/** Every update the declared dependencies could see, at their real pinned versions. */
const BUMPS = MANIFESTS.flatMap((manifest) => {
  const { dependencies = {}, devDependencies = {} } = JSON.parse(
    readFileSync(join(process.cwd(), manifest), "utf8"),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return Object.entries({ ...dependencies, ...devDependencies }).flatMap(([name, version]) =>
    movesFrom({ name, version }),
  );
});

/** A Mend badge cell, the image-only shape renovate draws for its Age, Adoption, Passing and Confidence columns. */
function badge({ kind, bump }: { kind: string; bump: Bump }): string {
  return `![${kind}](https://developer.mend.io/api/mc/badges/${kind}/npm/${bump.name}/${bump.to}?slim=true)`;
}

/**
 * The cell each of renovate's own default `prBodyDefinitions` draws for one bump, keyed by column name. A column
 * configured in `renovate.json` but missing here is refused by a test below, so a new column is drawn in its REAL
 * shape before any assertion trusts it (an `Adoption` column is a badge too).
 */
const DEFAULT_CELLS: Readonly<Record<string, (bump: Bump) => string>> = {
  Adoption: (bump) => badge({ bump, kind: "adoption" }),
  Age: (bump) => badge({ bump, kind: "age" }),
  Change: ({ from, name, to }) => `[\`${from}\` → \`${to}\`](https://renovatebot.com/diffs/npm/${name}/${from}/${to})`,
  Confidence: (bump) => badge({ bump, kind: "confidence" }),
  "Current value": ({ from }) => `\`${from}\``,
  "New value": ({ to }) => `\`${to}\``,
  Package: ({ name }) =>
    `[${name}](https://example.com/${name}) ([source](https://redirect.github.com/example/${name}))`,
  "Package file": () => "package.json",
  Passing: (bump) => badge({ bump, kind: "passing" }),
  Pending: ({ to }) => `\`${to}\``,
  References: ({ name }) => `[source](https://github.com/example/${name})`,
  Type: () => "devDependencies",
  Update: ({ update }) => update,
};

/**
 * Render one of this config's templates for one bump, the way renovate's Handlebars would for a versioned update.
 * Only the tokens this repository's templates use are known; any other is left in place for a test to refuse.
 *
 * @param template a `prBodyDefinitions` or `prBodyNotes` template from `renovate.json`
 * @returns the text renovate would draw
 */
function rendered({ template, bump }: { template: string; bump: Bump }): string {
  return template
    .replaceAll("{{#if displayTo}}", "")
    .replaceAll("{{/if}}", "")
    .replaceAll("{{{depName}}}", bump.name)
    .replaceAll("{{{updateType}}}", bump.update)
    .replaceAll("{{{displayFrom}}}", bump.from)
    .replaceAll("{{{displayTo}}}", bump.to);
}

/** The cell one column draws for one bump: this config's own definition when it overrides one, else renovate's. */
function cell({ column, bump }: { column: string; bump: Bump }): string {
  const override = RENOVATE.prBodyDefinitions[column];
  if (override !== undefined) {
    return rendered({ bump, template: override });
  }
  return DEFAULT_CELLS[column]!(bump);
}

/**
 * The body renovate posts for one bump: the committed header, the update table, then the notes.
 *
 * @param columns the columns to draw: the committed `prBodyColumns` or {@link MEND_COLUMNS}
 * @param defaults draw renovate's own default cells, ignoring this config's definitions
 * @returns the part of the body `renovate.json` controls
 */
function bodyFor({
  columns,
  bump,
  defaults = false,
}: {
  columns: readonly string[];
  bump: Bump;
  defaults?: boolean;
}): string {
  const cells = columns.map((column) => (defaults ? DEFAULT_CELLS[column]!(bump) : cell({ bump, column })));
  const table = [
    `| ${columns.join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
    `| ${cells.join(" | ")} |`,
  ].join("\n");
  const notes = RENOVATE.prBodyNotes.map((template) => rendered({ bump, template })).join("\n\n");
  return `${RENOVATE.prHeader}\nThis PR contains the following updates:\n\n${table}\n\n${notes}\n\n---\n`;
}

/**
 * Everything that would hold a Renovate bump red on its body: the description gate, judging it as the CI event's
 * `renovate[bot]` author makes it, and the security scan, on a repository whose owner is not this source tree's.
 *
 * @param body the body renovate posts
 * @returns every refusal, empty when the bump is green on its description
 */
function renovateRefusals({ body }: { body: string }): readonly string[] {
  const owned = prOwnership({ author: "renovate[bot]", authorType: "Bot", bots: GENERIC }) === "owned";
  const scan = scanPrMetadataLeaks({ body, denylist: [], ownRepository: "acme/slopweaver" });
  return [...gatePrBody({ body, owned }).errors, ...scan.errors];
}

describe("renovate.json's pull request body", () => {
  // Renovate renders prHeader as a Handlebars template; kept literal, the text this reads IS what every bump posts, so
  // no update type can render a header without its Risk and Blast radius rows.
  it("has a literal header, with no template for renovate to render per update", () => {
    expect(RENOVATE.prHeader.includes("{{")).toBe(false);
  });

  // A bump opens on whichever repository runs this config, and dev-gate's identifier scan forgives only THAT
  // repository's owner, never this source tree's own address. MEASURED: once the committed rules carried
  // the owner's name forms, every Renovate bump opened on another owner's copy was red on `dev-gate`'s
  // `pr-format`, the header's Problem cell linking `github.com/<source owner>/slopweaver`.
  // So the header names no repository at all — its Problem origin links Renovate's own schedule docs instead — and
  // the scan judges it as a copy under the synthetic owner would.
  it("names no forbidden identifier on a repository whose owner is not this source tree's", () => {
    expect(scanPrMetadataLeaks({ body: RENOVATE.prHeader, denylist: [], ownRepository: "acme/slopweaver" })).toEqual({
      errors: [],
      identifierReports: [],
    });
    expect(SOURCE_REPOSITORY.length).toBeGreaterThan(0);
    const owner = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));
    expect(RENOVATE.prHeader.toLowerCase().includes(owner.toLowerCase())).toBe(false);
  });

  // Renovate truncates a GitHub body at 58,000 characters, so a header near that would lose its own table.
  it("leaves the update table room under renovate's body truncation", () => {
    expect(RENOVATE.prHeader.length).toBeLessThan(8000);
  });

  it("configures only columns and templates whose renovate shape this test draws", () => {
    expect(RENOVATE.prBodyColumns.length).toBeGreaterThan(0);
    const columns = [...RENOVATE.prBodyColumns, ...MEND_COLUMNS, ...Object.keys(RENOVATE.prBodyDefinitions)];
    expect(columns.filter((column) => !Object.hasOwn(DEFAULT_CELLS, column))).toEqual([]);
    const sample = { from: "1.0.0", name: "sample", to: "1.0.1", update: "patch" };
    const templates = [...Object.values(RENOVATE.prBodyDefinitions), ...RENOVATE.prBodyNotes];
    expect(templates.filter((template) => rendered({ bump: sample, template }).includes("{{"))).toEqual([]);
  });

  it("draws the package cell as the bare name and no version in any table cell, whichever columns are drawn", () => {
    expect(RENOVATE.prBodyDefinitions).toEqual({
      Age: "",
      Change: "{{{updateType}}}",
      Confidence: "",
      Package: "`{{{depName}}}`",
    });
    expect(RENOVATE.prBodyColumns).toEqual(["Package", "Type", "Update"]);
  });

  // A Renovate pull request is a stranger's: the description gate judges none of its body, so only the security
  // scans stand between a bump and green.
  it.each([
    { columns: RENOVATE.prBodyColumns, label: "the configured columns" },
    { columns: MEND_COLUMNS, label: "the columns the self-hosted Renovate draws" },
  ])(
    "renders a body the gate does not judge and the scan passes, for every bump of every dependency, under $label",
    ({ columns }) => {
      expect(BUMPS.length).toBeGreaterThan(0);
      const refused = BUMPS.filter((bump) => renovateRefusals({ body: bodyFor({ bump, columns }) }).length > 0);
      expect([...new Set(refused.map((bump) => bump.name))]).toEqual([]);
    },
  );

  it("states the version change in a note, outside the table", () => {
    const bump = { from: "1.63.0", name: "playwright-core", to: "1.63.1", update: "patch" };
    expect(bodyFor({ bump, columns: RENOVATE.prBodyColumns })).toContain(
      "`playwright-core` moves from `1.63.0` to `1.63.1`.",
    );
  });

  // A synthetic bump carrying a hyphenated name no manifest here declares, once read as an anagram of Problem.
  it.each([
    { columns: RENOVATE.prBodyColumns, label: "the configured columns" },
    { columns: MEND_COLUMNS, label: "the columns the self-hosted Renovate draws" },
  ])("keeps a hyphenated package name green, under $label", ({ columns }) => {
    const bump = { from: "4.3.0", name: "prettier-plugin-organize-imports", to: "4.3.1", update: "patch" };
    expect(renovateRefusals({ body: bodyFor({ bump, columns }) })).toEqual([]);
  });

  // Renovate's OWN default badge cells, which the committed definitions blank. A stranger's body is not judged, so a
  // bump stays green even if a renovate run ignores a definition and draws the badge.
  it.each([
    { columns: ["Package", "Age"], from: "6.35.1", label: "an Age badge", name: "knip", to: "6.35.2" },
    { columns: ["Package", "Adoption"], from: "6.35.1", label: "an Adoption badge", name: "knip", to: "6.35.2" },
    {
      columns: ["Package", "Confidence"],
      from: "5.10.1",
      label: "a Confidence badge",
      name: "cron-parser",
      to: "5.10.2",
    },
  ])("stays green with renovate's default cell for $label", ({ columns, from, name, to }) => {
    const bump = { from, name, to, update: "patch" };
    expect(renovateRefusals({ body: bodyFor({ bump, columns, defaults: true }) })).toEqual([]);
  });

  // The Change cell the self-hosted Renovate (44.172.1) draws whatever `prBodyDefinitions` says.
  it.each([
    { from: "7.0.138", name: "ai", to: "7.0.139" },
    { from: "1.63.0", name: "playwright-core", to: "1.63.1" },
    { from: "0.13.7", name: "x", to: "0.13.8" },
  ])("stays green with renovate's own Change cell for $name $from → $to", ({ from, name, to }) => {
    const bump = { from, name, to, update: "patch" };
    const change = DEFAULT_CELLS["Change"]!(bump);
    const table = `| Package | Change |\n|---|---|\n| ${cell({ bump, column: "Package" })} | ${change} |`;
    expect(change).toContain(`\`${from}\` → \`${to}\``);
    expect(
      renovateRefusals({ body: `${RENOVATE.prHeader}\nThis PR contains the following updates:\n\n${table}\n` }),
    ).toEqual([]);
  });

  it("stays green with drizzle-orm in renovate's default homepage-and-source package cell", () => {
    const bump = { from: "0.45.2", name: "drizzle-orm", to: "0.45.3", update: "patch" };
    const table = `| Package |\n|---|\n| ${DEFAULT_CELLS["Package"]!(bump)} |`;
    expect(renovateRefusals({ body: `${RENOVATE.prHeader}\n${table}\n` })).toEqual([]);
  });

  // What keeps a bump unjudged is WHO opened it, never its body: a user who happens to be called renovate is owned,
  // and the same body is then refused as the pre-C3 table its header still draws.
  it("is judged when the author is a user named renovate rather than the bot", () => {
    const bump = { from: "1.63.0", name: "playwright-core", to: "1.63.1", update: "patch" };
    const owner = prOwnership({ author: "renovate", authorType: "User", bots: GENERIC });
    expect(owner).toBe("owned");
    expect(gatePrBody({ body: bodyFor({ bump, columns: RENOVATE.prBodyColumns }), owned: true }).shape).toBe("pre-c3");
  });
});
