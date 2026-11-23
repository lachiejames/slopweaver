import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { loadRepoApplyManifest } from "../../../../../cli/commands/github/repoManifestRun.js";
import { runGithubRepo } from "../../../../../cli/commands/github/repoRun.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { applyManifestValue, type ManifestWorld, manifestWorld } from "../../../../githubRepoManifestWorld.js";
import { approvedRepoDeps } from "../../../../githubRepoWriteFakes.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const PATH = "settings-apply.json";
const REST = ["--repo", "acme/widget", "--apply-manifest", PATH];
const ARTIFACT = JSON.stringify(applyManifestValue());

/** The six private-safe steps a fresh repository needs, as the fake names each write. */
const PRIVATE_STEPS = [
  "description",
  "topics",
  "features",
  "merge-settings",
  "label-create:ready",
  "dependabot-alerts",
];

/** The reads that exist only on a public repository. */
const PUBLIC_ONLY_READS = new Set(["branch-protection", "secret-scanning", "private-vulnerability-reporting"]);

/** The reads every preview takes before the public-only ones, in order. */
const FIRST_READS = ["repository", "topics", "labels", "dependabot-alerts"];

/** A public repository that another actor makes private right after its Dependabot read is answered. */
function publicWorldMadePrivateAfterDependabot(): ManifestWorld {
  const world = manifestWorld();
  world.repository = { ...world.repository, visibility: "public" };
  world.afterRead = {
    change: ({ world: live }) => {
      live.repository = { ...live.repository, visibility: "private" };
    },
    read: "dependabot-alerts",
  };
  return world;
}

/** Run one `github repo` invocation over a settings world and a set of readable files. */
async function run({
  rest = REST,
  world,
  files = { [PATH]: ARTIFACT },
  door = memoryDoorLedger().port,
}: {
  rest?: readonly string[];
  world: ManifestWorld;
  files?: Readonly<Record<string, string>>;
  door?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-repo-manifest-"));
  homes.push(home);
  const out: string[] = [];
  const diagnostic: string[] = [];
  const deps = approvedRepoDeps({ diagnostic, door, files, home, manifest: world, out });
  const code = await runGithubRepo({ deps, rest });
  return { code, diagnostic, out };
}

/** The digest a `--json` preview prints. */
async function previewDigest({ world }: { world: ManifestWorld }): Promise<string> {
  const preview = await run({ rest: [...REST, "--json"], world });
  return (JSON.parse(preview.out[0]!) as { digest: string }).digest;
}

/** Apply the default artifact on the preview's digest. */
async function approveOnce({
  world,
  door,
}: {
  world: ManifestWorld;
  door?: DoorLedgerPort;
}): Promise<{ code: number; out: string[]; diagnostic: string[] }> {
  const approve = await previewDigest({ world });
  world.reads.length = 0;
  return run({ rest: [...REST, "--approve", approve], world, ...(door === undefined ? {} : { door }) });
}

describe("github repo --apply-manifest preview", () => {
  it("names each step and every section waiting for public, sends nothing and never reads a public-only setting", async () => {
    const world = manifestWorld();
    const result = await run({ world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual([]);
    expect(world.reads.filter((read) => PUBLIC_ONLY_READS.has(read))).toEqual([]);
    expect(result.out.slice(0, 4)).toEqual([
      "preview: apply the settings manifest to acme/widget (id 101): set the description; set the topics; set the " +
        'repository features; set the merge settings; create the label "ready"; turn Dependabot alerts on',
      "  waiting for public: branch-protection-main, applied by previewing again after --set-public",
      "  waiting for public: secret-scanning, applied by previewing again after --set-public",
      "  waiting for public: private-vulnerability-reporting, applied by previewing again after --set-public",
    ]);
  });

  it("lists the public-only sections as waiting when the repository is made private before they are read", async () => {
    const world = publicWorldMadePrivateAfterDependabot();
    const result = await run({ world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual([]);
    expect(result.diagnostic).toEqual([]);
    expect(world.reads).toEqual([...FIRST_READS, "branch-protection", "repository"]);
    expect(result.out.slice(1, 4)).toEqual([
      "  waiting for public: branch-protection-main, applied by previewing again after --set-public",
      "  waiting for public: secret-scanning, applied by previewing again after --set-public",
      "  waiting for public: private-vulnerability-reporting, applied by previewing again after --set-public",
    ]);
  });

  it("binds the re-read private visibility into the digest's view when it lists them as waiting", async () => {
    const world = publicWorldMadePrivateAfterDependabot();
    const result = await run({ rest: [...REST, "--json"], world });
    const preview = JSON.parse(result.out[0]!) as {
      current: { visibility: string };
      waiting: string[];
      sent: boolean;
    };

    expect(result.code).toBe(0);
    expect(preview.sent).toBe(false);
    expect(preview.current.visibility).toBe("private");
    expect(preview.waiting).toEqual(["branch-protection-main", "secret-scanning", "private-vulnerability-reporting"]);
  });

  it("still exits on a public-only read GitHub refuses while the repository stays public", async () => {
    const world = manifestWorld({ refusedRead: "branch-protection" });
    world.repository = { ...world.repository, visibility: "public" };
    const result = await run({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual([]);
    expect(result.out).toEqual([]);
    expect(world.reads).toEqual([...FIRST_READS, "branch-protection", "repository"]);
    expect(result.diagnostic.join("\n")).toContain("read acme/widget's protection on main");
    expect(result.diagnostic.join("\n")).toContain("Resource not accessible");
  });

  it("carries the public-only refusal, not the re-read's, when the re-read itself fails", async () => {
    const world = manifestWorld({ refusedRead: "branch-protection" });
    world.repository = { ...world.repository, visibility: "public" };
    world.afterRead = {
      change: ({ world: live }) => {
        live.gone = true;
      },
      read: "branch-protection",
    };
    const result = await run({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual([]);
    expect(world.reads).toEqual([...FIRST_READS, "branch-protection", "repository"]);
    expect(result.diagnostic.join("\n")).toContain("Resource not accessible");
    expect(result.diagnostic.join("\n")).not.toContain("HTTP 404");
  });

  it("refuses rather than waits when the re-read names another repository at the address", async () => {
    const world = manifestWorld();
    world.repository = { ...world.repository, visibility: "public" };
    world.afterRead = {
      change: ({ world: live }) => {
        live.repository = { ...live.repository, id: 202, visibility: "private" };
      },
      read: "dependabot-alerts",
    };
    const result = await run({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual([]);
    expect(result.out).toEqual([]);
    expect(world.reads).toEqual([...FIRST_READS, "branch-protection", "repository"]);
    expect(result.diagnostic.join("\n")).toContain("Upgrade to GitHub Pro");
  });

  it("says there is nothing to send now when only the public-only sections remain on a private repository", async () => {
    const world = manifestWorld();
    await approveOnce({ world });
    world.sent.length = 0;
    const result = await run({ world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual([]);
    expect(result.out[0]).toBe(
      "nothing to send now: apply the settings manifest to acme/widget (id 101): nothing to send",
    );
  });
});

describe("github repo --apply-manifest apply", () => {
  it("applies the private-safe sections in order on the preview's digest and names what still waits", async () => {
    const world = manifestWorld();
    const door = memoryDoorLedger();
    const result = await approveOnce({ door: door.port, world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual(PRIVATE_STEPS);
    expect(world.topics).toEqual(["cli", "widgets"]);
    expect(world.repository.description).toBe("A widget for acme");
    expect(world.dependabotAlerts).toBe(true);
    expect(result.out).toEqual([
      "confirmed: the settings manifest is applied to acme/widget; still waiting for public: branch-protection-main, " +
        "secret-scanning, private-vulnerability-reporting",
    ]);
    expect(door.records().length).toBe(1);
  });

  it("applies the public-only sections on a second pass once the repository is public, and only those", async () => {
    const world = manifestWorld();
    await approveOnce({ world });
    world.repository = { ...world.repository, visibility: "public" };
    world.sent.length = 0;
    const preview = await run({ world });
    const result = await approveOnce({ world });

    expect(preview.out[1]).toBe(
      "  approving this also accepts: main accepts a commit only once the checks ci pass, an admin included",
    );
    expect(result.code).toBe(0);
    expect(world.sent).toEqual(["branch-protection-main", "secret-scanning", "private-vulnerability-reporting"]);
    expect(world.secretScanning).toEqual({ pushProtection: true, secretScanning: true });
    expect(result.out).toEqual(["confirmed: the settings manifest is applied to acme/widget"]);
  });

  it("reports a public repository already carrying the artifact as done", async () => {
    const world = manifestWorld();
    await approveOnce({ world });
    world.repository = { ...world.repository, visibility: "public" };
    await approveOnce({ world });
    world.sent.length = 0;
    const result = await run({ world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual([]);
    expect(result.out[0]).toBe("already done: apply the settings manifest to acme/widget (id 101): nothing to send");
  });

  it("holds the approval when a setting changed after the preview", async () => {
    const world = manifestWorld();
    const door = memoryDoorLedger();
    const approve = await previewDigest({ world });
    world.topics = ["other"];
    const result = await run({ door: door.port, rest: [...REST, "--approve", approve], world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual([]);
    expect(door.text()).toContain("github.repo-write-unapproved");
  });

  it("refuses the whole apply before sending anything when a label of that name already differs", async () => {
    const world = manifestWorld({ labels: [{ color: "ffffff", description: null, name: "Ready" }] });
    const result = await run({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual([]);
    expect(result.diagnostic.join("\n")).toContain('acme/widget already has a label "Ready" (#ffffff, no description');
  });

  it("stops at the first step its read-back does not show, naming what landed and rolling nothing back", async () => {
    const world = manifestWorld({ ignored: "merge-settings" });
    const result = await approveOnce({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual(["description", "topics", "features", "merge-settings"]);
    expect(world.repository.description).toBe("A widget for acme");
    expect(result.diagnostic.join("\n")).toContain(
      'the settings apply on acme/widget stopped at "set the merge settings" (confirmed: set the description, set ' +
        "the topics, set the repository features; still waiting for public: branch-protection-main, " +
        "secret-scanning, private-vulnerability-reporting). Nothing is rolled",
    );
  });

  it("carries GitHub's refusal when a send is refused", async () => {
    const world = manifestWorld({ refused: "features" });
    const result = await approveOnce({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual(["description", "topics", "features"]);
    expect(result.diagnostic.join("\n")).toContain("GitHub said: send: ");
    expect(result.diagnostic.join("\n")).toContain("HTTP 422");
  });

  it("continues past a send that errored when its read-back shows it landed anyway", async () => {
    const world = manifestWorld({ appliedButErrored: "topics" });
    const result = await approveOnce({ world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual(PRIVATE_STEPS);
  });

  it("sends no public-only setting once the repository is made private mid-run", async () => {
    const world = manifestWorld();
    world.repository = { ...world.repository, visibility: "public" };
    world.afterSend = {
      change: ({ world: live }) => {
        live.repository = { ...live.repository, visibility: "private" };
      },
      step: "dependabot-alerts",
    };
    const result = await approveOnce({ world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual(PRIVATE_STEPS);
    expect(result.diagnostic.join("\n")).toContain('stopped at "protect main"');
    expect(result.diagnostic.join("\n")).toContain(
      "before send: the repository is private now, so its public-only settings were not sent",
    );
  });

  it("does not take a read that maps a 404 to a state as confirmation once the repository is gone", async () => {
    const world = manifestWorld();
    world.dependabotAlerts = true;
    world.afterSend = {
      change: ({ world: live }) => {
        live.gone = true;
      },
      step: "dependabot-alerts",
    };
    const files = { [PATH]: JSON.stringify(applyManifestValue({ dependabotAlerts: { enabled: false } })) };
    const preview = await run({ files, rest: [...REST, "--json"], world });
    const approve = (JSON.parse(preview.out[0]!) as { digest: string }).digest;
    const result = await run({ files, rest: [...REST, "--approve", approve], world });

    expect(result.code).toBe(1);
    expect(world.sent).toEqual(PRIVATE_STEPS);
    expect(result.diagnostic.join("\n")).toContain('stopped at "turn Dependabot alerts off"');
    expect(result.diagnostic.join("\n")).toContain(
      'read-back: "turn Dependabot alerts off" read as sent, unconfirmed until the repository re-reads',
    );
    expect(result.diagnostic.join("\n")).toContain("after read-back: the repository could not be read");
  });
});

describe("github repo --apply-manifest artifact", () => {
  it("exits as a failed read, before any GitHub call, when the artifact cannot be read", async () => {
    const world = manifestWorld();
    const result = await run({ files: {}, world });

    expect(result.code).toBe(1);
    expect(world.reads).toEqual([]);
    expect(result.diagnostic[0]).toBe(`could not read the apply artifact ${PATH}`);
  });

  it("refuses an artifact that is not JSON as a usage problem, before any GitHub call", async () => {
    const world = manifestWorld();
    const result = await run({ files: { [PATH]: "{ not json" }, world });

    expect(result.code).toBe(2);
    expect(world.reads).toEqual([]);
    expect(result.diagnostic[0]).toMatch(/^the apply artifact settings-apply\.json is not JSON: /);
  });

  it("refuses an artifact the schema refuses, naming each problem", async () => {
    const world = manifestWorld();
    const value = applyManifestValue({ description: "OWNER CALL — see ownerCalls.description" });
    const result = await run({ files: { [PATH]: JSON.stringify(value) }, world });

    expect(result.code).toBe(2);
    expect(world.reads).toEqual([]);
    expect(result.diagnostic).toEqual([
      `the apply artifact ${PATH} is refused:`,
      "settings.description: a placeholder, not a ruling: rule on it first",
    ]);
  });

  it("refuses an artifact naming another repository", async () => {
    const world = manifestWorld();
    const value = { ...applyManifestValue(), repository: "acme/gadget" };
    const result = await run({ files: { [PATH]: JSON.stringify(value) }, world });

    expect(result.code).toBe(2);
    expect(world.reads).toEqual([]);
    expect(result.diagnostic).toEqual([
      "the apply artifact names acme/gadget, not acme/widget; an artifact applies to the repository it names",
    ]);
  });

  it("matches the artifact's repository to the one typed without case", async () => {
    const world = manifestWorld();
    const value = { ...applyManifestValue(), repository: "Acme/Widget" };
    const result = await run({ files: { [PATH]: JSON.stringify(value) }, world });

    expect(result.code).toBe(0);
    expect(world.sent).toEqual([]);
  });

  it("refuses --apply-manifest with an empty path as a usage problem", async () => {
    const world = manifestWorld();
    const result = await run({ rest: ["--repo", "acme/widget", "--apply-manifest", ""], world });

    expect(result.code).toBe(2);
    expect(world.reads).toEqual([]);
  });
});

describe("loadRepoApplyManifest", () => {
  const address = { owner: "acme", repo: "widget" };

  it("answers the parsed artifact when it names the repository typed", () => {
    const loaded = loadRepoApplyManifest({ address, path: PATH, readText: () => ok(ARTIFACT) });

    expect(unwrap(loaded).repository).toBe("acme/widget");
  });

  it("reports a failed read as unreadable, carrying the read's own lines", () => {
    const loaded = loadRepoApplyManifest({ address, path: PATH, readText: () => err(["ENOENT: no such file"]) });

    expect(unwrapErr(loaded)).toStrictEqual({
      kind: "unreadable",
      lines: [`could not read the apply artifact ${PATH}`, "ENOENT: no such file"],
    });
  });

  it("reports content that was read and names another repository as invalid", () => {
    const text = JSON.stringify({ ...applyManifestValue(), repository: "acme/gadget" });
    const loaded = loadRepoApplyManifest({ address, path: PATH, readText: () => ok(text) });

    expect(unwrapErr(loaded)).toStrictEqual({
      kind: "invalid",
      lines: ["the apply artifact names acme/gadget, not acme/widget; an artifact applies to the repository it names"],
    });
  });

  it("asks the seam for exactly the path typed", () => {
    const asked: string[] = [];
    loadRepoApplyManifest({
      address,
      path: "nested/apply.json",
      readText: ({ path }) => {
        asked.push(path);
        return ok(ARTIFACT);
      },
    });

    expect(asked).toStrictEqual(["nested/apply.json"]);
  });
});
