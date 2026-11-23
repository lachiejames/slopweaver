/*
 * The pure fixtures the `github stack adopt --register-only` test files share: the drifted child and its parent,
 * a native stack, a provider whose unreached methods fail loudly, one that answers a create and reads back stack
 * #5, and the parsed register-only arguments. Nothing here touches disk. It moved here when
 * `stackAdoptRegistrationRun.test.ts` was split by behaviour.
 */
import { okAsync } from "neverthrow";

import { unwrap } from "#lib/result.js";

import {
  type GithubStackAdoptArgs,
  parseGithubStackAdoptArgs,
} from "../../../../../../cli/commands/github/stackAdoptCore.js";
import type { GithubStackAdoptRegistrationDeps } from "../../../../../../cli/commands/github/stackAdoptRegistrationRun.js";
import type { GithubStackAdoptDeps } from "../../../../../../cli/commands/github/stackAdoptRun.js";
import type { GithubStack } from "../../../../../../corpus/github/stack.js";
import type { GithubWriteApi, WrittenPr } from "../../../../../../corpus/github/write.js";
import { fakeApi } from "../../../../../githubPrHarness.js";

const CHILD_SHA = "a".repeat(40);
/** The default branch's tip, as `ls-remote --symref origin HEAD` answers it. */
export const MAIN_SHA = "1".repeat(40);
/** The argv every register-only run opens with, before its own flags. */
export const PREFIX: readonly string[] = ["node", "slopweaver", "github", "stack", "adopt", "--pr", "100"];

/**
 * The child pull request, eight commits on `child-branch`, based on `parent-branch`.
 *
 * @returns the child, with any field the caller passes replaced
 */
export function childPr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return {
    authorId: 1,
    baseRef: "parent-branch",
    baseRepoFullName: "o/r",
    body: "b",
    // Eight, as two real stacked pull requests read — the count ordinary adopt refuses.
    commits: 8,
    draft: false,
    head: { label: "o:child-branch", ref: "child-branch", repoFullName: "o/r", sha: CHILD_SHA },
    htmlUrl: "https://example.invalid/pr/100",
    mergedAtIso: undefined,
    nodeId: "PR_100",
    number: 100,
    stack: undefined,
    state: "open",
    title: "t",
    updatedAtIso: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

/**
 * The parent pull request, heading `parent-branch` and based on `main`.
 *
 * @returns the parent, with any field the caller passes replaced
 */
export function parentPr(overrides: Partial<WrittenPr> = {}): WrittenPr {
  return childPr({
    baseRef: "main",
    head: { label: "o:parent-branch", ref: "parent-branch", repoFullName: "o/r", sha: "b".repeat(40) },
    htmlUrl: "https://example.invalid/pr/10",
    nodeId: "PR_10",
    number: 10,
    ...overrides,
  });
}

/**
 * An open native stack whose entries are open pull requests, each on its own `branch-<n>` against `main`.
 *
 * @param entries the pull request numbers, bottom first
 * @param number the stack's number, which is also its id
 * @returns the stack
 */
export function nativeStack({ entries, number }: { entries: readonly number[]; number: number }): GithubStack {
  return {
    entries: entries.map((entry) => ({
      baseRef: "main",
      headRef: `branch-${String(entry)}`,
      mergedAtIso: undefined,
      number: entry,
      state: "open",
    })),
    id: number,
    number,
    open: true,
  };
}

/**
 * A provider on the shared {@link fakeApi}, whose unreached methods fail loudly, with the open-pull-request
 * listings answering empty rather than failing.
 *
 * @returns a complete API, the caller's methods replacing the defaults
 */
export function unreachableApi(overrides: Partial<GithubWriteApi>): GithubWriteApi {
  return fakeApi({
    listOpenPrs: () => okAsync({ prs: [], truncated: false, viewerId: undefined }),
    listOpenPrsAuthoredByMe: () => okAsync({ prs: [], truncated: false }),
    ...overrides,
  });
}

/**
 * A provider that answers the create, then reads back a correctly-formed stack #5.
 *
 * @param calls the list each `createStack` and `getStack` call is recorded onto, in order
 * @returns the API, whose pull request reads change once the create has run
 */
export function creatingApi({ calls }: { calls: string[] }): GithubWriteApi {
  const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
  let created = false;
  return unreachableApi({
    createStack: ({ pullRequests }) => {
      calls.push(`createStack ${pullRequests.join(",")}`);
      created = true;
      return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
    },
    // `undefined` for the parent's OWN base (`main`): nothing is below it, so a create is safe. The lookup
    // still HAPPENS — the default-branch shortcut was removed — which this arm is what proves.
    findOpenPrByHead: ({ head }) => {
      if (head === "main") {
        return okAsync(undefined);
      }
      return okAsync(created ? parentPr({ stack: joined }) : parentPr());
    },
    getPr: ({ number }) => {
      if (number === 10) return okAsync(created ? parentPr({ stack: joined }) : parentPr());
      return okAsync(created ? childPr({ stack: { id: 5, number: 5, position: 2, size: 2 } }) : childPr());
    },
    getStack: ({ stackNumber }) => {
      calls.push(`getStack ${String(stackNumber)}`);
      return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
    },
  });
}

/**
 * `--register-only` for the child pull request, as the shared adopt parser reads it, against an explicit home.
 *
 * @param home the temporary state home the run's ledger writes go to
 * @returns the parsed arguments
 */
export function registerOnlyArgs({ home }: { home: string }): GithubStackAdoptArgs {
  return unwrap(
    parseGithubStackAdoptArgs({ argv: ["--pr", "100", "--register-only", "--cwd", "/repo", "--home", home] }),
  );
}

/**
 * The register-only edges out of the shared harness's, whose `registerMember` that harness always supplies.
 *
 * @returns the deps `runGithubStackAdoptRegistration` takes
 */
export function registrationDepsOf({ deps }: { deps: GithubStackAdoptDeps }): GithubStackAdoptRegistrationDeps {
  const { env, git, makeApi, now, out, registerMember, token } = deps;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the shared harness always supplies `registerMember`; a guard would add a failure path the old in-file helper never had
  return { env, git, makeApi, now, out, registerMember: registerMember!, token };
}
