import { describe, expect, it } from "vitest";

import {
  LAP_ENV_ALLOWLIST,
  LAP_VITEST_MAX_WORKERS,
  lapEnvironment,
  lapPlan,
  parseGithubLapArgs,
  stepEnvironment,
} from "../../../../../cli/commands/github/lapCore.js";
import { lapLockState } from "../../../../../cli/commands/github/lapLockShape.js";
import { storeUrls } from "../../../../../cli/commands/github/lapStore.js";
import {
  differingPlanSources,
  type LapPreflightFacts,
  landOnlyFindings,
  landOnlyReceiptFindings,
  lapDoorRequest,
  lapPreflightVerdict,
  lapReceipt,
  lapStepKey,
  presentUnderExactName,
  standingHolderOf,
  standingHoldOf,
} from "../../../../../cli/commands/github/lapVerdict.js";
import { OFFLOADED_COMMANDS } from "../../../../../devLint/ciOffloadCommands.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const BASE = "4cf8df588ae4aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD = "777de6d8be0fbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Facts for a lap that may run, overridden per case. */
function facts(over: Partial<LapPreflightFacts> = {}): LapPreflightFacts {
  return {
    baseRef: "main",
    baseTip: BASE,
    enforceAdmins: false,
    headContainsBase: true,
    headSha: HEAD,
    isAdmin: true,
    planSourcesDiffering: [],
    prState: "open",
    protection: "protected",
    required: [
      { appId: undefined, context: "build" },
      { appId: undefined, context: "integration" },
    ],
    ...over,
  };
}

describe("parseGithubLapArgs", () => {
  it("resolves the repository, number and the two modes", () => {
    expect(unwrap(parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--land"] }))).toEqual({
      acknowledge: undefined,
      dryRun: false,
      home: undefined,
      land: true,
      landOnly: false,
      number: 7,
      owner: "o",
      repo: "r",
    });
  });

  it("reads --land-only as a landing that runs no lane", () => {
    const parsed = unwrap(parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--land-only"] }));
    expect([parsed.land, parsed.landOnly]).toEqual([true, true]);
  });

  it("names every usage problem at once", () => {
    expect(unwrapErr(parseGithubLapArgs({ rest: ["--repo", "broken", "--number", "0"] }))).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number, or an ordered comma-separated list of them",
    ]);
  });

  it("accepts --land with --dry-run, which checks the landing before the lap and runs nothing", () => {
    const parsed = unwrap(parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--land", "--dry-run"] }));
    expect([parsed.land, parsed.landOnly, parsed.dryRun]).toEqual([true, false, true]);
  });

  it("refuses --land-only with --dry-run, which posts nothing to land on", () => {
    const rest = ["--repo", "o/r", "--number", "7", "--land-only", "--dry-run"];
    expect(unwrapErr(parseGithubLapArgs({ rest }))).toEqual([
      "--land-only and --dry-run contradict each other: a dry run posts nothing, so it has nothing to land on",
    ]);
  });

  it("refuses --land --dry-run over a batch, whose landings are not checked ahead", () => {
    const rest = ["--repo", "o/r", "--number", "7,8", "--land", "--dry-run"];
    expect(unwrapErr(parseGithubLapArgs({ rest }))).toEqual([
      "--land --dry-run checks ONE pull request's landing before its lap; a batch's landings are not checked ahead yet, so lap the members one at a time",
    ]);
  });

  it("carries an acknowledgement and its reason for --land's merge, verbatim", () => {
    const rest = [
      "--repo",
      "o/r",
      "--number",
      "7",
      "--land",
      "--acknowledge",
      "codex-loop-incomplete",
      "--reason",
      "data only",
    ];
    expect(unwrap(parseGithubLapArgs({ rest })).acknowledge).toEqual({
      reason: "data only",
      subjects: "codex-loop-incomplete",
    });
  });

  it("refuses an acknowledgement with no reason, and one with no --land to hand it to", () => {
    expect(
      unwrapErr(parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--land", "--acknowledge", "x"] })),
    ).toEqual(["--acknowledge and --reason go together: `github merge` writes the reason to the door ledger"]);
    expect(
      unwrapErr(
        parseGithubLapArgs({ rest: ["--repo", "o/r", "--number", "7", "--acknowledge", "x", "--reason", "y"] }),
      ),
    ).toEqual(["--acknowledge is for --land's merge, and a lap without --land merges nothing"]);
  });

  it("refuses any acknowledgement on a batch, which would hand it to every member", () => {
    const batch = ["--repo", "o/r", "--number", "7,8", "--land"];
    const refusal =
      "--acknowledge accepts one pull request's finding, and a batch would hand it to every member: name a member's own codex-loop-incomplete with --codex-loop-incomplete <n>=<reason>, or lap an acknowledged member alone";
    expect(unwrapErr(parseGithubLapArgs({ rest: [...batch, "--acknowledge", "x", "--reason", "y"] }))).toEqual([
      refusal,
    ]);
    expect(unwrapErr(parseGithubLapArgs({ rest: [...batch, "--reason", "y"] }))).toEqual([
      "--acknowledge and --reason go together: `github merge` writes the reason to the door ledger",
      refusal,
    ]);
    expect(unwrap(parseGithubLapArgs({ rest: batch })).acknowledge).toBeUndefined();
  });
});

describe("landOnlyFindings", () => {
  const green = ({ context }: { context: string }) => ({
    context,
    description: "local lap: 20 steps green in 35m over base 4cf8df588a",
    state: "success",
  });

  it("finds nothing when both contexts' latest status is a lap's green over the base tip", () => {
    expect(
      landOnlyFindings({ baseTip: BASE, statuses: [green({ context: "build" }), green({ context: "integration" })] }),
    ).toEqual([]);
  });

  it("reads only the latest status per context, so a newer pending outranks an older green", () => {
    const pending = { context: "build", description: "local lap: running", state: "pending" };
    expect(
      landOnlyFindings({
        baseTip: BASE,
        statuses: [pending, green({ context: "build" }), green({ context: "integration" })],
      }),
    ).toEqual(['"build" reads pending ("local lap: running"), not a lap\'s green over base 4cf8df588a']);
  });

  it("refuses a green some other poster wrote, and a context with no status at all", () => {
    const hosted = { context: "build", description: null, state: "success" };
    expect(landOnlyFindings({ baseTip: BASE, statuses: [hosted] })).toEqual([
      '"build" reads success (null), not a lap\'s green over base 4cf8df588a',
      '"integration" carries no status on this head',
    ]);
  });
});

describe("landOnlyReceiptFindings", () => {
  const plan = [
    { argv: ["yarn", "lint"], directory: undefined, id: "lint" },
    { argv: ["yarn", "test"], directory: "site", id: "unit" },
  ];
  const finished = {
    baseTip: BASE,
    headSha: HEAD,
    outcomes: [
      { exitCode: 0, id: "lint" },
      { exitCode: 0, id: "unit" },
    ],
    phase: "finished",
    plan: plan.map((step) => lapStepKey(step)),
  };
  const none = [
    "no finished lap receipt on this machine shows all 2 steps green at head 777de6d8be over base 4cf8df588a",
  ];

  it("finds nothing when one finished receipt at this head and base has every planned step green", () => {
    expect(landOnlyReceiptFindings({ baseTip: BASE, headSha: HEAD, plan, receipts: [finished] })).toEqual([]);
  });

  it("refuses a receipt whose step ran another command under the same id", () => {
    const changed = [plan[0]!, { ...plan[1]!, argv: ["yarn", "false"] }];
    expect(landOnlyReceiptFindings({ baseTip: BASE, headSha: HEAD, plan: changed, receipts: [finished] })).toEqual(
      none,
    );
  });

  it("refuses a receipt over another base, with a red step, or over a different plan", () => {
    const otherBase = { ...finished, baseTip: "0123456789aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
    const red = {
      ...finished,
      outcomes: [
        { exitCode: 0, id: "lint" },
        { exitCode: 1, id: "unit" },
      ],
    };
    const otherPlan = { ...finished, plan: finished.plan.slice(0, 1) };
    const laterRed = { ...finished, outcomes: [...finished.outcomes, { exitCode: 1, id: "lint" }] };
    expect(landOnlyReceiptFindings({ baseTip: BASE, headSha: HEAD, plan, receipts: [laterRed] })).toEqual(none);
    expect(
      landOnlyReceiptFindings({ baseTip: BASE, headSha: HEAD, plan, receipts: [otherBase, red, otherPlan] }),
    ).toEqual(none);
    expect(landOnlyReceiptFindings({ baseTip: BASE, headSha: HEAD, plan, receipts: [] })).toEqual(none);
  });
});

describe("lapPlan", () => {
  it("runs every command CI's offload register names, in its order, each exactly once", () => {
    expect(OFFLOADED_COMMANDS.length).toBeGreaterThan(0);
    const lanes = lapPlan().filter((step) => step.kind === "lane" && step.context === "build");
    const cap = `--maxWorkers=${String(LAP_VITEST_MAX_WORKERS)}`;
    expect(
      lanes.map((step) => ({ command: step.argv.filter((word) => word !== cap).join(" "), directory: step.directory })),
    ).toEqual(OFFLOADED_COMMANDS.map((entry) => ({ command: entry.command, directory: entry.directory })));
  });

  it("caps the workers of every Vitest lane at CI's runner size, and of nothing else", () => {
    const capped = lapPlan()
      .filter((step) => step.argv.includes(`--maxWorkers=${String(LAP_VITEST_MAX_WORKERS)}`))
      .map((step) => step.id);
    expect(capped).toEqual(["integration", "unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6", "subprocess"]);
  });

  it("starts with the install, then integration, and builds the CLI right before the subprocess lane", () => {
    const ids = lapPlan().map((step) => step.id);
    expect(ids.slice(0, 2)).toEqual(["install", "integration"]);
    expect(ids[ids.indexOf("subprocess") - 1]).toBe("cli-build");
  });

  it("installs each nested project once, before its first command", () => {
    const ids = lapPlan().map((step) => step.id);
    expect(ids.filter((id) => id === "site-install")).toEqual(["site-install"]);
    expect(ids.indexOf("site-install")).toBeLessThan(ids.indexOf("site.test-nextra-patch"));
    expect(ids.indexOf("desktop-install")).toBeLessThan(ids.indexOf("desktop"));
  });

  it("gives every step a distinct id, so no two logs share a file", () => {
    const ids = lapPlan().map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("lapPreflightVerdict", () => {
  it("lets a fresh, admin-landable head run with nothing to say", () => {
    expect(lapPreflightVerdict({ facts: facts() })).toEqual({ notes: [], refusals: [] });
  });

  it("runs on a base its plan cannot protect, saying so in the plan's own words", () => {
    const verdict = lapPreflightVerdict({
      facts: facts({ enforceAdmins: undefined, protection: "plan-unavailable", required: [] }),
    });
    expect(verdict).toEqual({
      notes: [
        "main cannot be protected on this repository's GitHub plan (GitHub answered the protection read with " +
          '"Upgrade to GitHub Pro or make this repository public to enable this feature"), so no branch-protection ' +
          "rule applies to it: the lap has no required contexts to satisfy",
      ],
      refusals: [],
    });
  });

  it("runs on an unprotected base with no plan note, so the 404 reading is unchanged", () => {
    const verdict = lapPreflightVerdict({
      facts: facts({ enforceAdmins: undefined, protection: "unprotected", required: [] }),
    });
    expect(verdict).toEqual({ notes: [], refusals: [] });
  });

  it("refuses a head that does not contain the base tip, naming both", () => {
    expect(lapPreflightVerdict({ facts: facts({ headContainsBase: false }) }).refusals).toEqual([
      "the head 777de6d8be does not contain main's tip 4cf8df588a: rebase it and push, so the tree the lap tests is the tree that lands",
    ]);
  });

  it("refuses a closed pull request, a non-admin token, enforced admins and an unpostable context together", () => {
    const verdict = lapPreflightVerdict({
      facts: facts({
        enforceAdmins: true,
        isAdmin: false,
        prState: "closed",
        required: [{ appId: undefined, context: "CodeQL" }],
      }),
    });
    expect(verdict.refusals).toEqual([
      "the pull request is closed, so there is nothing to lap",
      "this token is not an administrator of the repository, so the lap's statuses could never land it",
      "main's protection enforces itself on administrators, so the bypass the lap lands through is closed",
      'main requires "CodeQL", which a lap never posts',
    ]);
  });

  it("notes, without refusing, contexts pinned to an app GitHub alone can satisfy", () => {
    const verdict = lapPreflightVerdict({
      facts: facts({
        required: [
          { appId: 15368, context: "build" },
          { appId: 15368, context: "integration" },
        ],
      }),
    });
    expect(verdict).toEqual({
      notes: [
        '"build" and "integration" are pinned to app 15368, so GitHub itself will not count the lap\'s statuses; the landing is the administrator bypass',
      ],
      refusals: [],
    });
  });
});

describe("the store's lanes", () => {
  it("are exactly the ones whose CI job set a store variable, each with the variables that job set", () => {
    const withStore = lapPlan()
      .filter((step) => step.storeVariables.length > 0)
      .map((step) => ({ id: step.id, variables: step.storeVariables }));
    expect(withStore).toEqual([
      {
        id: "subprocess",
        variables: ["DOOR_LEDGER_STORE_PROOF_URL", "PROFILE_STEERS_PROOF_ADMIN_URL", "STORE_PROOF_ADMIN_URL"],
      },
      { id: "desktop-e2e", variables: ["DESKTOP_E2E_STORE_ADMIN_URL"] },
    ]);
  });

  it("name only variables the store supplies", () => {
    const supplied = Object.keys(storeUrls({ port: "1" }));
    const named = lapPlan().flatMap((step) => step.storeVariables);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((variable) => !supplied.includes(variable))).toEqual([]);
  });

  it("give a step its own job's store variables and none of the others", () => {
    const e2e = lapPlan().find((step) => step.id === "desktop-e2e")!;
    const env = stepEnvironment({
      env: { CI: "true" },
      step: e2e,
      store: { DESKTOP_E2E_STORE_ADMIN_URL: "postgresql://e2e", STORE_PROOF_ADMIN_URL: "postgresql://proof" },
    });
    expect(env).toEqual({ CI: "true", DESKTOP_E2E_STORE_ADMIN_URL: "postgresql://e2e" });
  });
});

describe("lapEnvironment", () => {
  it("passes only the allowlist, forces CI's switches and the throwaway home, and adds what the lap supplies", () => {
    const env = lapEnvironment({
      ambient: {
        GITHUB_TOKEN: "seat-token",
        HOME: "/Users/seat",
        PATH: "/bin",
        POLLY_MODE: "record",
        PROTO_HOME: "/Users/seat/.proto",
        SLOPWEAVER_ALLOW_BASH: "1",
        SLOPWEAVER_HOME: "/operator",
      },
      extra: { STORE_PROOF_ADMIN_URL: "postgresql://x" },
      laneHome: "/lane",
    });
    expect(env).toEqual({
      CI: "true",
      HOME: "/lane",
      PATH: "/bin",
      POLLY_MODE: "replay",
      SLOPWEAVER_HOME: "/lane",
      STORE_PROOF_ADMIN_URL: "postgresql://x",
      TZ: "UTC",
    });
    expect(LAP_ENV_ALLOWLIST.length).toBeGreaterThan(0);
  });
});

describe("lapReceipt", () => {
  it("keeps the environment's keys and never its values, which hold the store's URLs", () => {
    const receipt = lapReceipt({
      env: { STORE_PROOF_ADMIN_URL: "postgresql://postgres:postgres@127.0.0.1:1/postgres", CI: "true" },
      outcomes: [],
      phase: "running",
      plan: lapPlan().slice(0, 1),
      refs: { baseTip: BASE, headSha: HEAD },
      startedIso: "2026-11-10T03:00:00.000Z",
      subject: "o/r#7",
    });
    expect(receipt.environmentKeys).toEqual(["CI", "STORE_PROOF_ADMIN_URL"]);
    expect(receipt.plan).toEqual([{ argv: ["yarn", "install", "--immutable"], directory: undefined, id: "install" }]);
  });
});

describe("lapLockState", () => {
  it("is held only while its process lives", () => {
    const lock = {
      nonce: "n",
      phase: "running" as const,
      pid: 42,
      startedIso: "2026-11-10T03:00:00.000Z",
      subject: "o/r#1@abc",
    };
    expect(lapLockState({ lock, pidAlive: true })).toBe("held");
    expect(lapLockState({ lock, pidAlive: false })).toBe("stale");
  });
});

describe("differingPlanSources", () => {
  const bytes = ({ text }: { text: string }): Uint8Array => new TextEncoder().encode(text);
  const files =
    ({ tree }: { tree: Readonly<Record<string, string>> }): ((path: string) => Uint8Array | undefined) =>
    (path) => {
      const text = tree[path];
      return text === undefined ? undefined : bytes({ text });
    };
  const sources = ["ci.yml", "lapCore.ts", "unitShards.ts"];

  it("names a file whose bytes differ, whatever an index bit would tell git diff", () => {
    expect(
      differingPlanSources({
        readAtHead: files({ tree: { "ci.yml": "a", "lapCore.ts": "x", "unitShards.ts": "s" } }),
        readLocal: files({ tree: { "ci.yml": "a\n", "lapCore.ts": "x", "unitShards.ts": "s" } }),
        sources,
      }),
    ).toEqual(["ci.yml"]);
  });

  it("names a path present on only one side, in sources order", () => {
    expect(
      differingPlanSources({
        readAtHead: files({ tree: { "ci.yml": "a", "unitShards.ts": "s" } }),
        readLocal: files({ tree: { "lapCore.ts": "x", "unitShards.ts": "s" } }),
        sources,
      }),
    ).toEqual(["ci.yml", "lapCore.ts"]);
  });

  it("names nothing when every copy matches", () => {
    const tree = { "ci.yml": "a", "lapCore.ts": "x", "unitShards.ts": "s" };
    expect(differingPlanSources({ readAtHead: files({ tree }), readLocal: files({ tree }), sources })).toEqual([]);
  });
});

describe("standingHolderOf", () => {
  const holds = [{ holder: "claude-code:other-session", repo: "Acme/Widget" }];

  it("finds a hold placed under another casing of the same repository", () => {
    expect(standingHolderOf({ holds, slug: "acme/widget" })).toBe("claude-code:other-session");
  });

  it("answers undefined for a repository nothing holds", () => {
    expect(standingHolderOf({ holds, slug: "acme/other" })).toBeUndefined();
  });

  it("answers undefined over an empty hold store", () => {
    expect(standingHolderOf({ holds: [], slug: "acme/widget" })).toBeUndefined();
  });
});

describe("presentUnderExactName", () => {
  /** A checkout whose workflow directory holds only a case-renamed `CI.yml`. */
  const listings: Readonly<Record<string, readonly string[]>> = {
    "": [".github", "src"],
    ".github": ["workflows"],
    ".github/workflows": ["CI.yml"],
  };
  const entriesOf: (dir: string) => readonly string[] | undefined = (dir) => listings[dir];

  it("reads a case-renamed CI.yml as ABSENT for ci.yml, never as the same path", () => {
    expect(presentUnderExactName({ entriesOf, relative: ".github/workflows/ci.yml" })).toBe(false);
  });

  it("finds a path whose every component is listed verbatim", () => {
    expect(presentUnderExactName({ entriesOf, relative: ".github/workflows/CI.yml" })).toBe(true);
  });

  it("answers false when a parent directory is absent", () => {
    expect(presentUnderExactName({ entriesOf, relative: "src/testLanes/unitShards.ts" })).toBe(false);
  });

  it("answers false for a case-renamed DIRECTORY component too", () => {
    expect(presentUnderExactName({ entriesOf, relative: ".GitHub/workflows/CI.yml" })).toBe(false);
  });
});

describe("standingHoldOf", () => {
  const path = "/h/live/github/merge-hold.json";
  const hold = {
    atIso: "2026-11-11T00:00:00.000Z",
    holder: "claude-code:other-session",
    pr: 99,
    repo: "Acme/Widget",
    why: "landing #99",
  };

  it("names the holder of a decodable hold under another casing", () => {
    expect(standingHoldOf({ path, raw: { holds: [hold], version: 1 }, slug: "acme/widget" })).toEqual({
      holder: "claude-code:other-session",
      kind: "held",
    });
  });

  it("answers clear for a decodable document holding nothing for that repository", () => {
    expect(standingHoldOf({ path, raw: { holds: [hold], version: 1 }, slug: "acme/other" })).toEqual({
      kind: "clear",
    });
  });

  it("answers unreadable, never clear, for a document that is not a hold document", () => {
    expect(standingHoldOf({ path, raw: "garbage", slug: "acme/widget" })).toEqual({
      kind: "unreadable",
      path,
      why: "it is not a hold document",
    });
  });

  it("answers unreadable when any entry cannot be decoded, even another repository's", () => {
    expect(
      standingHoldOf({ path, raw: { holds: [hold, { repo: "acme/widget" }], version: 1 }, slug: "acme/other" }),
    ).toEqual({ kind: "unreadable", path, why: "it carries an entry no hold verb can decode" });
  });
});

describe("lapDoorRequest", () => {
  it("addresses the exact head commit as the door artifact and marks the write external", () => {
    expect(
      lapDoorRequest({
        args: {
          acknowledge: undefined,
          dryRun: false,
          home: undefined,
          land: false,
          landOnly: false,
          number: 7,
          owner: "o",
          repo: "r",
        },
        headSha: HEAD,
        home: "/h",
      }),
    ).toEqual({
      action: { kind: "verb", noun: "github", verb: "lap" },
      artifact: { id: `o/r#7@${HEAD}` },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});
