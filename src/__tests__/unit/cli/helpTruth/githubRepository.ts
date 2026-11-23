/**
 * The help-truth tables' rows for `github`'s repository, branch and alert verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { GITHUB_ACTIONS_FLAG_NAMES, parseGithubActionsArgs } from "../../../../cli/commands/github/actionsCore.js";
import { GITHUB_ALERT_FLAG_NAMES, parseGithubAlertArgs } from "../../../../cli/commands/github/alertCore.js";
import { GITHUB_BRANCH_FLAG_NAMES, parseGithubBranchArgs } from "../../../../cli/commands/github/branchDeleteCore.js";
import {
  GITHUB_CODE_SCANNING_FLAG_NAMES,
  parseGithubCodeScanningArgs,
} from "../../../../cli/commands/github/codeScanningCore.js";
import { githubVerbErrorLines } from "../../../../cli/commands/github/errors.js";
import { parseGithubExposureArgs } from "../../../../cli/commands/github/exposureCore.js";
import { GITHUB_EXPOSURE_FLAG_NAMES } from "../../../../cli/commands/github/exposureUsage.js";
import { GITHUB_PUSH_FLAG_NAMES, parseGithubPushArgs } from "../../../../cli/commands/github/pushCore.js";
import {
  GITHUB_PUSH_RESTRICTION_FLAG_NAMES,
  parseGithubPushRestrictionArgs,
} from "../../../../cli/commands/github/pushRestrictionCore.js";
import { GITHUB_PUSH_ROOT_FLAG_NAMES, parsePushRootArgs } from "../../../../cli/commands/github/pushRootCore.js";
import { GITHUB_REPO_FLAG_NAMES, parseGithubRepoArgs } from "../../../../cli/commands/github/repoCore.js";
import {
  GITHUB_REPOINT_PLAN_FLAG_NAMES,
  parseRepointPlanArgs,
} from "../../../../cli/commands/github/repointPlanCore.js";
import { parseGithubStackAdoptArgs } from "../../../../cli/commands/github/stackAdoptCore.js";
import { parseGithubStackAuditArgs } from "../../../../cli/commands/github/stackAuditCore.js";
import { GITHUB_STACK_FLAG_NAMES } from "../../../../cli/commands/github/stackCore.js";
import { parseGithubStackDissolveArgs } from "../../../../cli/commands/github/stackDissolveCore.js";
import { parseGithubStackPushArgs } from "../../../../cli/commands/github/stackPushCore.js";
import { parseGithubStackRemoveArgs } from "../../../../cli/commands/github/stackRemoveCore.js";
import { parseGithubStackSubmitArgs } from "../../../../cli/commands/github/stackSubmitRun.js";
import { GITHUB_TAG_FLAG_NAMES, parseGithubTagArgs } from "../../../../cli/commands/github/tagCreateCore.js";
import { GITHUB_VULN_FLAG_NAMES, parseGithubVulnArgs } from "../../../../cli/commands/github/vulnCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/** A valid `github alert list` invocation, so each list-only flag's probe only needs to add itself. */
const GITHUB_ALERT_LIST_PROBE: readonly string[] = ["list", "--repo", "owner/name"];

/** A valid `github vuln list` invocation: the repository is the only requirement. */
const GITHUB_VULN_LIST_PROBE: readonly string[] = ["list", "--repo", "owner/name"];

/** A valid `github vuln get` invocation: the alert's own number is required alongside the repository. */
const GITHUB_VULN_GET_PROBE: readonly string[] = ["get", "--repo", "owner/name", "--number", "1"];

/** A valid `github vuln body` invocation: it needs the form and takes no repository of its own. */
const GITHUB_VULN_BODY_PROBE: readonly string[] = ["body", "--form", "{}"];

/** A valid `github alert dismiss` invocation: every one of these three is required. */
const GITHUB_ALERT_DISMISS_PROBE: readonly string[] = [
  "dismiss",
  "--repo",
  "owner/name",
  "--number",
  "1",
  "--reason",
  "false_positive",
  "--comment",
  "test fixture builds the taint",
];

/** A valid `github push-root record` invocation: the repository and a full root sha are both required. */
const GITHUB_PUSH_ROOT_RECORD_PROBE: readonly string[] = ["record", "--repo", "owner/name", "--root", "a".repeat(40)];

/** A valid `github repoint-plan` invocation: the repository and the archive's name are both required. */
const GITHUB_REPOINT_PLAN_PROBE: readonly string[] = ["--repo", "owner/name", "--archive-name", "name-archive"];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "github push-root": GITHUB_PUSH_ROOT_FLAG_NAMES,
  "github repoint-plan": GITHUB_REPOINT_PLAN_FLAG_NAMES,
  "github actions": GITHUB_ACTIONS_FLAG_NAMES,
  "github alert": GITHUB_ALERT_FLAG_NAMES,
  "github code-scanning": GITHUB_CODE_SCANNING_FLAG_NAMES,
  "github exposure": GITHUB_EXPOSURE_FLAG_NAMES,
  "github vuln": GITHUB_VULN_FLAG_NAMES,
  "github branch": GITHUB_BRANCH_FLAG_NAMES,
  "github tag": GITHUB_TAG_FLAG_NAMES,
  "github push": GITHUB_PUSH_FLAG_NAMES,
  "github push-restriction": GITHUB_PUSH_RESTRICTION_FLAG_NAMES,
  "github repo": GITHUB_REPO_FLAG_NAMES,
  "github stack": GITHUB_STACK_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "github push-root": {
    "--cwd": [...GITHUB_PUSH_ROOT_RECORD_PROBE, "--cwd", "/tmp"],
    "--dry-run": [...GITHUB_PUSH_ROOT_RECORD_PROBE, "--dry-run"],
    "--home": ["list", "--home", "/tmp"],
    "--json": ["list", "--json"],
    "--repo": [...GITHUB_PUSH_ROOT_RECORD_PROBE],
    "--root": [...GITHUB_PUSH_ROOT_RECORD_PROBE],
  },
  "github repoint-plan": {
    "--archive-name": [...GITHUB_REPOINT_PLAN_PROBE],
    "--home": [...GITHUB_REPOINT_PLAN_PROBE, "--home", "/tmp"],
    "--json": [...GITHUB_REPOINT_PLAN_PROBE, "--json"],
    "--new-checkout": [...GITHUB_REPOINT_PLAN_PROBE, "--new-checkout", "/tmp/fresh"],
    "--repo": [...GITHUB_REPOINT_PLAN_PROBE],
  },
  "github push": {
    "--acknowledge": ["--acknowledge", "base-moved"],
    "--acknowledge-all": ["--acknowledge-all", "--reason", "known flake"],
    "--cwd": ["--cwd", "/tmp"],
    "--dry-run": ["--dry-run"],
    "--force-with-lease": ["--force-with-lease"],
    "--home": ["--home", "/tmp"],
    "--orphan-above": ["--orphan-above", "41,42"],
    "--reason": ["--acknowledge-all", "--reason", "known flake"],
    "--remote": ["--remote", "origin"],
    "--self-review": ["--self-review", "-"],
  },
  "github branch": {
    "--branch": ["--repo", "owner/name", "--branch", "old", "--dry-run"],
    "--dry-run": ["--repo", "owner/name", "--branch", "old", "--dry-run"],
    "--expect-tip": ["--repo", "owner/name", "--branch", "old", "--expect-tip", "a".repeat(40)],
    "--home": ["--repo", "owner/name", "--branch", "old", "--dry-run", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--branch", "old", "--dry-run", "--json"],
    "--keep-as-tag": ["--repo", "owner/name", "--branch", "old", "--dry-run", "--keep-as-tag", "archive/old"],
    "--repo": ["--repo", "owner/name", "--branch", "old", "--dry-run"],
  },
  "github tag": {
    "--dry-run": [
      "--repo",
      "owner/name",
      "--tag",
      "t",
      "--sha",
      "0123456789abcdef0123456789abcdef01234567",
      "--dry-run",
    ],
    "--home": [
      "--repo",
      "owner/name",
      "--tag",
      "t",
      "--sha",
      "0123456789abcdef0123456789abcdef01234567",
      "--home",
      "/tmp",
    ],
    "--json": ["--repo", "owner/name", "--tag", "t", "--sha", "0123456789abcdef0123456789abcdef01234567", "--json"],
    "--message": [
      "--repo",
      "owner/name",
      "--tag",
      "t",
      "--sha",
      "0123456789abcdef0123456789abcdef01234567",
      "--message",
      "m",
    ],
    "--repo": ["--repo", "owner/name", "--tag", "t", "--sha", "0123456789abcdef0123456789abcdef01234567"],
    "--sha": ["--repo", "owner/name", "--tag", "t", "--sha", "0123456789abcdef0123456789abcdef01234567"],
    "--tag": ["--repo", "owner/name", "--tag", "t", "--sha", "0123456789abcdef0123456789abcdef01234567"],
  },
  "github alert": {
    "--comment": [...GITHUB_ALERT_DISMISS_PROBE],
    "--dry-run": [...GITHUB_ALERT_LIST_PROBE, "--dry-run"],
    "--home": [...GITHUB_ALERT_LIST_PROBE, "--home", "/tmp"],
    "--json": [...GITHUB_ALERT_LIST_PROBE, "--json"],
    "--number": [...GITHUB_ALERT_DISMISS_PROBE],
    "--pr": [...GITHUB_ALERT_LIST_PROBE, "--pr", "1"],
    "--reason": [...GITHUB_ALERT_DISMISS_PROBE],
    "--repo": [...GITHUB_ALERT_LIST_PROBE],
    "--state": [...GITHUB_ALERT_LIST_PROBE, "--state", "open"],
  },
  "github exposure": {
    "--home": ["inventory", "--repo", "owner/name", "--home", "/tmp"],
    "--json": ["inventory", "--repo", "owner/name", "--json"],
    "--repo": ["inventory", "--repo", "owner/name"],
  },
  "github code-scanning": {
    "--approve": ["enable", "--repo", "owner/name", "--approve", "ghrepo-0123456789abcdef"],
    "--dry-run": ["disable", "--repo", "owner/name", "--dry-run"],
    "--home": ["disable", "--repo", "owner/name", "--home", "/tmp"],
    "--json": ["show", "--repo", "owner/name", "--json"],
    "--repo": ["show", "--repo", "owner/name"],
  },
  "github vuln": {
    "--checkout": ["surfaces", "--package", "dompurify", "--checkout", "/tmp"],
    "--everywhere-at": ["surfaces", "--package", "dompurify", "--checkout", "/tmp", "--everywhere-at", "12"],
    "--file": ["body", "--file", "form.json"],
    "--form": [...GITHUB_VULN_BODY_PROBE],
    "--home": [...GITHUB_VULN_LIST_PROBE, "--home", "/tmp"],
    "--json": [...GITHUB_VULN_LIST_PROBE, "--json"],
    "--number": [...GITHUB_VULN_GET_PROBE],
    "--out": [...GITHUB_VULN_BODY_PROBE, "--out", "pr-form.json"],
    "--package": ["surfaces", "--package", "dompurify", "--checkout", "/tmp"],
    "--repo": [...GITHUB_VULN_LIST_PROBE],
    "--severity": [...GITHUB_VULN_LIST_PROBE, "--severity", "critical"],
    "--state": [...GITHUB_VULN_LIST_PROBE, "--state", "open"],
  },
  "github actions": {
    "--apply": ["--repo", "owner/name", "--disable", "--apply"],
    "--disable": ["--repo", "owner/name", "--disable"],
    "--home": ["--repo", "owner/name", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--json"],
    "--repo": ["--repo", "owner/name"],
  },
  "github repo": {
    "--apply-manifest": ["--repo", "owner/name", "--apply-manifest", "/tmp/settings-apply.json"],
    "--approve": ["--repo", "owner/name", "--archive", "--approve", "ghrepo-0123456789abcdef"],
    "--archive": ["--repo", "owner/name", "--archive"],
    "--create": ["--repo", "owner/name", "--create"],
    "--description": ["--repo", "owner/name", "--description", "new text"],
    "--enable-actions": ["--repo", "owner/name", "--enable-actions"],
    "--public": ["--repo", "owner/name", "--create", "--public"],
    "--push-fresh-cut": ["--repo", "owner/name", "--push-fresh-cut", "0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4"],
    "--set-public": ["--repo", "owner/name", "--set-public"],
    "--rename-to": ["--repo", "owner/name", "--rename-to", "renamed"],
    "--transfer-to": ["--repo", "owner/name", "--transfer-to", "fixture-owner"],
    "--dry-run": ["--repo", "owner/name", "--description", "new text", "--dry-run"],
    "--home": ["--repo", "owner/name", "--description", "new text", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--description", "new text", "--json"],
    "--repo": ["--repo", "owner/name", "--description", "new text"],
  },
  "github push-restriction": {
    "--allow": ["--repo", "owner/name", "--allow", "octocat"],
    "--branch": ["--repo", "owner/name", "--branch", "main"],
    "--dry-run": ["--repo", "owner/name", "--allow", "octocat", "--dry-run"],
    "--home": ["--repo", "owner/name", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--json"],
    "--repo": ["--repo", "owner/name"],
    "--unrestrict": ["--repo", "owner/name", "--unrestrict"],
  },
  "github stack": {
    "--acknowledge": ["--form", "-", "--acknowledge", "base-moved"],
    "--check": ["--repo", "owner/name", "--check"],
    "--acknowledge-all": ["--form", "-", "--acknowledge-all", "--reason", "known flake"],
    "--cwd": ["--form", "-", "--cwd", "/tmp"],
    "--dry-run": ["--pr", "100", "--dry-run"],
    "--file": ["--file", "/tmp/pr.md"],
    "--file-example": ["--file-example"],
    "--force": ["submit", "--force"],
    "--form": ["--form", "-"],
    "--form-example": ["--form-example"],
    "--home": ["--form", "-", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--json"],
    "--mine": ["--repo", "owner/name", "--mine"],
    // `--pr` FIRST, deliberately: the selector routes a github-stack probe by its leading flag, and a
    // `--register-only`-only probe would be read as `stack push` rather than `stack adopt`.
    "--register-only": ["--pr", "100", "--register-only"],
    "--orphan-above": ["--form", "-", "--orphan-above", "41,42"],
    "--pr": ["--pr", "100"],
    "--reason": ["--form", "-", "--acknowledge-all", "--reason", "known flake"],
    "--remote": ["--form", "-", "--remote", "origin"],
    "--repo": ["--repo", "owner/name", "--pr", "100"],
    "--self-review": ["--form", "{}", "--self-review", "-"],
    "--stack": ["--repo", "owner/name", "--stack", "5"],
    "--timeout-seconds": ["--form", "-", "--wait", "--timeout-seconds", "120"],
    "--wait": ["--form", "-", "--wait"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // A fragment that already names its own sub-verb ("list"/"dismiss") passes through unchanged; anything
  // else gets the list baseline, which is what the generic unknown-flag strictness probe needs.
  "github alert": ({ fragment }) => {
    const named = ["list", "dismiss"].includes(String(fragment[0]));
    return parseGithubAlertArgs({ argv: named ? [...fragment] : ["list", ...fragment] }).mapErr((error) =>
      githubVerbErrorLines({ error }),
    );
  },
  // A fragment that names `inventory` or `sweep` passes through; anything else gets the inventory baseline, which
  // is what the generic unknown-flag strictness probe needs.
  "github exposure": ({ fragment }) =>
    parseGithubExposureArgs({
      argv: ["inventory", "sweep"].includes(String(fragment[0]))
        ? [...fragment]
        : ["inventory", "--repo", "owner/name", ...fragment],
    }).mapErr((error) => [error.message]),
  "github code-scanning": ({ fragment }) => {
    const named = ["show", "disable", "enable"].includes(String(fragment[0]));
    return parseGithubCodeScanningArgs({ argv: named ? [...fragment] : ["disable", ...fragment] });
  },
  // A fragment that already names its own sub-verb ("list"/"get"/"body") passes through unchanged; anything
  // else gets the list baseline, which is what the generic unknown-flag strictness probe needs.
  "github vuln": ({ fragment }) => {
    const named = ["list", "get", "body", "surfaces"].includes(String(fragment[0]));
    const argv = named ? [...fragment] : [...GITHUB_VULN_LIST_PROBE, ...fragment];
    return parseGithubVulnArgs({ argv }).mapErr((error) => githubVerbErrorLines({ error }));
  },
  "github branch": ({ fragment }) =>
    parseGithubBranchArgs({ argv: ["delete", ...fragment] }).mapErr((error) => githubVerbErrorLines({ error })),
  "github tag": ({ fragment }) =>
    parseGithubTagArgs({ argv: ["create", ...fragment] }).mapErr((error) => githubVerbErrorLines({ error })),
  "github push": ({ fragment }) => parseGithubPushArgs({ argv: [...fragment] }),
  // A fragment naming its own sub-verb passes through; anything else gets the record baseline, which is what the
  // generic unknown-flag strictness probe needs.
  "github push-root": ({ fragment }) => {
    const named = ["record", "list"].includes(String(fragment[0]));
    return parsePushRootArgs({
      rest: named ? [...fragment] : [...GITHUB_PUSH_ROOT_RECORD_PROBE, ...fragment],
    }).mapErr((error) => error.lines);
  },
  "github repoint-plan": ({ fragment }) => {
    const named = fragment.includes("--repo");
    return parseRepointPlanArgs({ rest: named ? [...fragment] : [...GITHUB_REPOINT_PLAN_PROBE, ...fragment] }).mapErr(
      (error) => error.lines,
    );
  },
  "github repo": ({ fragment }) => parseGithubRepoArgs({ rest: [...fragment] }),
  "github actions": ({ fragment }) => parseGithubActionsArgs({ rest: [...fragment] }),
  "github push-restriction": ({ fragment }) => parseGithubPushRestrictionArgs({ rest: [...fragment] }),
  // `--check`/`--json`/`--mine` are audit's alone and are checked FIRST, because audit's probe fragments also
  // carry `--repo` and would otherwise be routed to remove's parser. Then `--stack` selects dissolve's
  // parser, `--repo` (without `--stack`) selects remove's — both checked before
  // `--pr`, since remove's own probe fragment also carries `--pr`. `--pr` alone selects adopt's parser. The
  // probe table deliberately includes it for adopt's advertised `--dry-run`; routing that shared flag
  // through push hid adopt's live parser defect.
  "github stack": ({ fragment }) => {
    // `submit` is the one sub-verb whose probe fragment names itself, because `--force` is its alone and
    // no other flag in the shared usage selects it.
    if (fragment.includes("submit")) {
      return parseGithubStackSubmitArgs({ argv: fragment.filter((part) => part !== "submit") }).mapErr((error) =>
        githubVerbErrorLines({ error }),
      );
    }
    if (fragment.includes("--check") || fragment.includes("--json") || fragment.includes("--mine")) {
      return parseGithubStackAuditArgs({ argv: [...fragment] }).mapErr((error) => githubVerbErrorLines({ error }));
    }
    if (fragment.includes("--stack")) {
      return parseGithubStackDissolveArgs({ argv: [...fragment] });
    }
    if (fragment.includes("--repo")) {
      return parseGithubStackRemoveArgs({ argv: [...fragment] });
    }
    return fragment.includes("--pr")
      ? parseGithubStackAdoptArgs({ argv: [...fragment] }).mapErr((error) => githubVerbErrorLines({ error }))
      : parseGithubStackPushArgs({ argv: [...fragment] });
  },
};

/** The rows for `github`'s repository, branch and alert verbs. */
export const githubRepositorySlice: HelpTruthSlice = { guarded, probes, parsers };
