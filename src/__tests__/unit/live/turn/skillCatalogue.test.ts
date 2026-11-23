/** Discovering the skills a dispatched worker could load, from this build and every declared checkout. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { availableSkills, parseCatalogueSkill } from "../../../../live/turn/skillCatalogue.js";

const dirs: string[] = [];

/** A throwaway directory, removed in `afterEach` — a fixture the OS is never asked to reclaim. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-skill-catalogue-"));
  dirs.push(dir);
  return dir;
}

/** A minimal valid `profile.json` body declaring these checkouts and nothing else this test needs. */
function profileWith({ checkouts }: { checkouts: readonly string[] }): Record<string, unknown> {
  return {
    displayName: "operator",
    gitNamespace: "example",
    id: "me",
    mainCheckouts: checkouts.map((path) => ({ path })),
    schemaVersion: 1,
    sources: [],
  };
}

/** Write one skill's `SKILL.md` under a skills root, creating the directory. */
function writeSkill({ body, name, root }: { body: string; name: string; root: string }): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), body, "utf8");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("parseCatalogueSkill", () => {
  it("reads the name and description out of the frontmatter", () => {
    const skill = parseCatalogueSkill({
      content: "---\nname: datadog-monitor-pr\ndescription: The shape every monitor PR arrives in.\n---\n\n# body\n",
      path: "a/SKILL.md",
    })!;

    expect(skill.name).toBe("datadog-monitor-pr");
    expect(skill.description).toBe("The shape every monitor PR arrives in.");
    expect(skill.path).toBe("a/SKILL.md");
  });

  it("strips a quoted value", () => {
    const skill = parseCatalogueSkill({
      content: '---\nname: "quoted"\ndescription: "a quoted description"\n---\n',
      path: "a/SKILL.md",
    })!;

    expect(skill.description).toBe("a quoted description");
  });

  it("is not an entry without a description — there would be nothing to rank on", () => {
    expect(parseCatalogueSkill({ content: "---\nname: bare\n---\n", path: "a/SKILL.md" })).toBe(undefined);
  });

  it("is not an entry without frontmatter at all", () => {
    expect(parseCatalogueSkill({ content: "# just a heading\n", path: "a/SKILL.md" })).toBe(undefined);
  });
});

describe("availableSkills", () => {
  it("reads this build's own skills and every declared checkout's, in that order", () => {
    const home = scratch();
    const repoRoot = scratch();
    const checkout = scratch();
    writeSkill({
      body: "---\nname: ask\ndescription: retrieve the evidence\n---\n",
      name: "ask",
      root: join(repoRoot, "skills"),
    });
    writeSkill({
      body: "---\nname: ship\ndescription: land a change\n---\n",
      name: "ship",
      root: join(checkout, ".agents/skills"),
    });
    writeFileSync(join(home, "profile.json"), JSON.stringify(profileWith({ checkouts: [checkout] })), "utf8");

    expect(availableSkills({ home, repoRoot }).map((skill) => skill.name)).toEqual(["ask", "ship"]);
  });

  it("deduplicates by name, so a symlinked second root does not double every entry", () => {
    const home = scratch();
    const repoRoot = scratch();
    const checkout = scratch();
    const body = "---\nname: ship\ndescription: land a change\n---\n";
    writeSkill({ body, name: "ship", root: join(checkout, ".agents/skills") });
    writeSkill({ body, name: "ship", root: join(checkout, ".claude/skills") });
    writeFileSync(join(home, "profile.json"), JSON.stringify(profileWith({ checkouts: [checkout] })), "utf8");

    expect(availableSkills({ home, repoRoot }).length).toBe(1);
  });

  it("skips a directory holding no SKILL.md rather than throwing", () => {
    const home = scratch();
    const repoRoot = scratch();
    mkdirSync(join(repoRoot, "skills", "empty"), { recursive: true });
    writeSkill({
      body: "---\nname: ask\ndescription: retrieve the evidence\n---\n",
      name: "ask",
      root: join(repoRoot, "skills"),
    });
    writeFileSync(join(home, "profile.json"), JSON.stringify(profileWith({ checkouts: [] })), "utf8");

    expect(availableSkills({ home, repoRoot }).map((skill) => skill.name)).toEqual(["ask"]);
  });

  it("returns an empty catalogue when nothing is discoverable, rather than failing the dispatch", () => {
    const home = scratch();
    const repoRoot = scratch();

    expect(availableSkills({ home, repoRoot })).toEqual([]);
  });
});
