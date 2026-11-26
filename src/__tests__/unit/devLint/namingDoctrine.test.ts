/**
 * The naming-doctrine gate's own tests (AGENTS.md rule 11). Two halves, and the second is the load-bearing
 * one: it must catch a concept named two ways, and it must NOT catch two distinct concepts whose names merely
 * share letters — the workflow skills, `org`/`org-health`, `hand`/`handover`.
 *
 * deleted-with-code: NAMING_DOCTRINE_DEBT, NamingDoctrineDebt
 */

import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import {
  type CommandSurfaceName,
  commandSurfaceDivergences,
  divergenceIdentity,
  labelSlug,
  nameRelation,
  nameSegments,
  type SidebarNameDeclaration,
  sidebarDivergences,
} from "../../../devLint/namingDoctrine.js";
import { skillNamesOf } from "../../../devLint/namingDoctrineRun.js";
import { extractSidebarEntries } from "../../../devLint/namingDoctrineSidebar.js";

const noun = ({ name }: { name: string }): CommandSurfaceName => ({
  name,
  path: "src/cli/manifests/index.ts",
  surface: "noun",
});
const skill = ({ name }: { name: string }): CommandSurfaceName => ({
  name,
  path: `skills/${name}/SKILL.md`,
  surface: "skill",
});
const row = (over: Partial<SidebarNameDeclaration>): SidebarNameDeclaration => ({
  href: "/queue",
  key: "queue",
  label: "Queue",
  line: 1,
  path: "site/lib/sidebarCounts.ts",
  ...over,
});

describe("nameSegments", () => {
  it("splits on hyphens, underscores, whitespace and camelCase, lowercased", () => {
    expect(nameSegments({ name: "vulnerability-fix" })).toEqual(["vulnerability", "fix"]);
    expect(nameSegments({ name: "sessionStart" })).toEqual(["session", "start"]);
    expect(nameSegments({ name: "Pull requests" })).toEqual(["pull", "requests"]);
    expect(nameSegments({ name: "org_health" })).toEqual(["org", "health"]);
  });
});

describe("nameRelation — one concept named two ways", () => {
  it("catches the owner's own example as an abbreviation", () => {
    expect(nameRelation({ a: "vulnfix", b: "vulnerability-fix" })).toBe("abbreviation");
  });

  it("catches a plural, each spelling rule", () => {
    expect(nameRelation({ a: "widget", b: "widgets" })).toBe("plural");
    expect(nameRelation({ a: "policy", b: "policies" })).toBe("plural");
    expect(nameRelation({ a: "box", b: "boxes" })).toBe("plural");
    expect(nameRelation({ a: "pull-request", b: "pull-requests" })).toBe("plural");
  });

  it("catches names that differ only by separators", () => {
    expect(nameRelation({ a: "session-start", b: "sessionstart" })).toBe("separator");
  });

  it("calls one name declared twice the doctrine kept, not a divergence", () => {
    expect(nameRelation({ a: "workstreams", b: "workstreams" })).toBeUndefined();
  });
});

describe("nameRelation — distinct concepts it must leave alone", () => {
  it.each([
    ["hand", "handover"],
    ["org", "org-health"],
    ["loop", "loop-bot"],
    ["slack", "slack-read-thread"],
    ["pickup", "handover"],
    ["orchestrate", "handover"],
    ["dogfood", "desktop"],
    ["session", "session-start"],
    ["key", "keys-and-locks"],
  ])("%s and %s are two concepts", (a, b) => {
    expect(nameRelation({ a, b })).toBeUndefined();
  });
});

describe("commandSurfaceDivergences", () => {
  it("finds exactly the related pairs, across and within surfaces", () => {
    const found = commandSurfaceDivergences({
      names: [
        noun({ name: "vulnfix" }),
        noun({ name: "widget" }),
        noun({ name: "hand" }),
        skill({ name: "vulnerability-fix" }),
        skill({ name: "widgets" }),
        skill({ name: "handover" }),
        skill({ name: "loop-bot" }),
      ],
    });
    expect(found.map((divergence) => divergenceIdentity({ divergence }))).toEqual([
      "command-surface noun:vulnfix skill:vulnerability-fix",
      "command-surface noun:widget skill:widgets",
    ]);
  });

  it("keys a pair by both names sorted, whichever order the registries list them in", () => {
    const [divergence] = commandSurfaceDivergences({
      names: [skill({ name: "widgets" }), noun({ name: "widget" })],
    });
    expect(divergenceIdentity({ divergence: divergence! })).toBe("command-surface noun:widget skill:widgets");
  });
});

describe("sidebarDivergences", () => {
  it("catches a page whose address disagrees with its key and label", () => {
    const [divergence] = sidebarDivergences({
      entries: [row({ href: "/getting-started", key: "setup", label: "Setup" })],
    });
    expect(divergenceIdentity({ divergence: divergence! })).toBe("sidebar setup href=getting-started label=setup");
  });

  it("passes a multi-word page whose three names agree", () => {
    expect(
      sidebarDivergences({ entries: [row({ href: "/pull-requests", key: "pull-requests", label: "Pull requests" })] }),
    ).toEqual([]);
  });

  it("ignores a fragment or query on the address", () => {
    expect(sidebarDivergences({ entries: [row({ href: "/fleet#now", key: "fleet", label: "Fleet" })] })).toEqual([]);
  });

  it("leaves a row that opens no page outside the criterion", () => {
    expect(sidebarDivergences({ entries: [row({ href: null, key: "settings", label: "Preferences" })] })).toEqual([]);
  });

  it("slugs a label by collapsing every non-alphanumeric run", () => {
    expect(labelSlug({ label: "Pull requests & more!" })).toBe("pull-requests-more");
  });
});

describe("extractSidebarEntries", () => {
  it("reads every literal row through `as const satisfies`", () => {
    const content =
      'export const SIDEBAR_ENTRIES = [\n  { href: "/queue", key: "queue", label: "Queue" },\n' +
      '  { href: null, key: "settings", label: "Settings" },\n] as const satisfies readonly X[];\n';
    const rows = unwrap(extractSidebarEntries({ content, path: "s.ts" }));
    expect(rows.map((entry) => [entry.href, entry.key, entry.label, entry.line])).toEqual([
      ["/queue", "queue", "Queue", 2],
      [null, "settings", "Settings", 3],
    ]);
  });

  it("fails closed when the constant is missing", () => {
    expect(unwrapErr(extractSidebarEntries({ content: "export const OTHER = [];\n", path: "s.ts" }))).toBe(
      "s.ts: declares no `SIDEBAR_ENTRIES` constant",
    );
  });

  it("fails closed on an empty table", () => {
    expect(unwrapErr(extractSidebarEntries({ content: "export const SIDEBAR_ENTRIES = [];\n", path: "s.ts" }))).toBe(
      "s.ts: `SIDEBAR_ENTRIES` is not a non-empty array literal",
    );
  });

  it("fails closed on a row whose key is computed rather than literal", () => {
    const content = 'export const SIDEBAR_ENTRIES = [\n  { href: "/q", key: KEY, label: "Q" },\n];\n';
    expect(unwrapErr(extractSidebarEntries({ content, path: "s.ts" }))).toBe(
      "s.ts:2: a SIDEBAR_ENTRIES row's href, key or label is not a literal",
    );
  });
});

describe("skillNamesOf", () => {
  it("names a skill by its directory and ignores reference files", () => {
    const names = skillNamesOf({
      listing: ["skills/github/SKILL.md", "skills/github/reference/push.md", "src/x.ts", "skills/a/b/SKILL.md"],
    });
    expect(names.map((name) => name.name)).toEqual(["github"]);
  });
});

describe("the last divergence the rule was measured with", () => {
  it("is found again were it back: a vulnfix noun beside the vulnerability-fix skill", () => {
    const reintroduced = commandSurfaceDivergences({
      names: [noun({ name: "vulnfix" }), skill({ name: "vulnerability-fix" })],
    });
    expect(reintroduced.map((divergence) => divergenceIdentity({ divergence }))).toEqual([
      "command-surface noun:vulnfix skill:vulnerability-fix",
    ]);
  });

  it("reports a sidebar row duplicated whole once per copy, so neither copy can ride the other", () => {
    const setup = row({ href: "/getting-started", key: "setup", label: "Setup" });
    expect(sidebarDivergences({ entries: [setup, { ...setup, line: 2 }] }).length).toBe(2);
  });
});
