/**
 * The native stack registration shared by `stack push`, `stack adopt` and `pr retarget --adopt`.
 *
 * The four write-API methods it reaches are plain functions that record each call, so every case asserts
 * exactly which endpoints were touched — and that the one it did not choose was never called.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import {
  type GithubStackRegistrationOutcome,
  registerAgainstParent,
  registerStackEntry,
  stackRegistrationFailed,
  stackRegistrationLines,
} from "../../../../../cli/commands/github/stackRegistration.js";
import type { GithubStack } from "../../../../../corpus/github/stack.js";
import type { GithubWriteApi, PrStackMembership, WrittenPr } from "../../../../../corpus/github/write.js";
import type { IngestError } from "../../../../../lib/ingestError.js";

type RegistrationApi = Pick<GithubWriteApi, "findOpenPrByHead" | "getPr" | "createStack" | "addToStack">;

const FAILURE: IngestError = { kind: "http", message: "bad gateway", operation: "github.x" };

function pr({ number, stack }: { number: number; stack: PrStackMembership | undefined }): WrittenPr {
  return {
    authorId: 1,
    baseRef: "main",
    baseRepoFullName: "o/r",
    body: "b",
    commits: 1,
    draft: false,
    head: { label: "o:feature", ref: "feature", repoFullName: "o/r", sha: "1".repeat(40) },
    htmlUrl: `https://github.com/o/r/pull/${String(number)}`,
    mergedAtIso: undefined,
    nodeId: `PR_${String(number)}`,
    number,
    stack,
    state: "open",
    title: "t",
    updatedAtIso: "2026-10-12T00:00:00Z",
  };
}

function membership({ number }: { number: number }): PrStackMembership {
  return { id: 900 + number, number, position: 1, size: 2 };
}

function nativeStack({ number }: { number: number }): GithubStack {
  return { entries: [], id: 900 + number, number, open: true };
}

/** Every call each method received, in order, keyed by method name. */
interface Calls {
  readonly findOpenPrByHead: unknown[];
  readonly getPr: unknown[];
  readonly createStack: unknown[];
  readonly addToStack: unknown[];
}

function harness({
  findOpenPrByHead = () => errAsync(FAILURE),
  getPr = () => errAsync(FAILURE),
  createStack = () => errAsync(FAILURE),
  addToStack = () => errAsync(FAILURE),
}: Partial<RegistrationApi>): { api: RegistrationApi; calls: Calls } {
  const calls: Calls = { addToStack: [], createStack: [], findOpenPrByHead: [], getPr: [] };
  return {
    api: {
      addToStack: (input) => {
        calls.addToStack.push(input);
        return addToStack(input);
      },
      createStack: (input) => {
        calls.createStack.push(input);
        return createStack(input);
      },
      findOpenPrByHead: (input) => {
        calls.findOpenPrByHead.push(input);
        return findOpenPrByHead(input);
      },
      getPr: (input) => {
        calls.getPr.push(input);
        return getPr(input);
      },
    },
    calls,
  };
}

const ENTRY = { base: "feature-a", defaultBranch: "main", owner: "o", prNumber: 20, repo: "r" };

describe("registerStackEntry", () => {
  it("returns none for a base that is the default branch and calls nothing", async () => {
    const h = harness({});
    const result = await registerStackEntry({ ...ENTRY, api: h.api, base: "main" });
    expect(result).toEqual({ kind: "none" });
    expect(h.calls).toEqual({ addToStack: [], createStack: [], findOpenPrByHead: [], getPr: [] });
  });

  it("returns no-parent when no open pull request has the base as its head", async () => {
    const h = harness({ findOpenPrByHead: () => okAsync(undefined) });
    const result = await registerStackEntry({ ...ENTRY, api: h.api });
    expect(result).toEqual({ base: "feature-a", kind: "no-parent" });
    expect(h.calls).toEqual({
      addToStack: [],
      createStack: [],
      findOpenPrByHead: [{ head: "feature-a", owner: "o", repo: "r" }],
      getPr: [],
    });
  });

  it("is unregistered, naming the provider's message, when the parent lookup fails", async () => {
    const h = harness({});
    const result = await registerStackEntry({ ...ENTRY, api: h.api });
    expect(result).toEqual({ kind: "unregistered", reason: "could not resolve the parent PR: bad gateway" });
    expect({ add: h.calls.addToStack.length, create: h.calls.createStack.length, get: h.calls.getPr.length }).toEqual({
      add: 0,
      create: 0,
      get: 0,
    });
  });

  it("creates a stack of parent and child when the resolved parent has no stack", async () => {
    const h = harness({
      createStack: () => okAsync(nativeStack({ number: 5 })),
      findOpenPrByHead: () => okAsync(pr({ number: 10, stack: undefined })),
      getPr: () => okAsync(pr({ number: 20, stack: undefined })),
    });
    const result = await registerStackEntry({ ...ENTRY, api: h.api });
    expect(result).toEqual({ kind: "registered", stackNumber: 5 });
    expect(h.calls).toEqual({
      addToStack: [],
      createStack: [{ owner: "o", pullRequests: [10, 20], repo: "r" }],
      findOpenPrByHead: [{ head: "feature-a", owner: "o", repo: "r" }],
      getPr: [{ number: 20, owner: "o", repo: "r" }],
    });
  });
});

describe("registerAgainstParent", () => {
  const PARENT_ARGS = { base: "feature-a", owner: "o", prNumber: 20, repo: "r" };

  it("adds to the parent's stack when the parent already has one", async () => {
    const h = harness({
      addToStack: () => okAsync(nativeStack({ number: 8 })),
      getPr: () => okAsync(pr({ number: 20, stack: undefined })),
    });
    const result = await registerAgainstParent({
      ...PARENT_ARGS,
      api: h.api,
      parentPr: { number: 10, stackNumber: 8 },
    });
    expect(result).toEqual({ kind: "registered", stackNumber: 8 });
    expect(h.calls).toEqual({
      addToStack: [{ owner: "o", pullRequests: [20], repo: "r", stackNumber: 8 }],
      createStack: [],
      findOpenPrByHead: [],
      getPr: [{ number: 20, owner: "o", repo: "r" }],
    });
  });

  it("reports already-joined when this PR already sits in the parent's stack, writing nothing", async () => {
    const h = harness({ getPr: () => okAsync(pr({ number: 20, stack: membership({ number: 8 }) })) });
    const result = await registerAgainstParent({
      ...PARENT_ARGS,
      api: h.api,
      parentPr: { number: 10, stackNumber: 8 },
    });
    expect(result).toEqual({ kind: "already-joined", stackNumber: 8 });
    expect({ add: h.calls.addToStack.length, create: h.calls.createStack.length }).toEqual({ add: 0, create: 0 });
  });

  it("is unregistered, writing nothing, when this PR's own re-read fails", async () => {
    const h = harness({});
    const result = await registerAgainstParent({
      ...PARENT_ARGS,
      api: h.api,
      parentPr: { number: 10, stackNumber: 8 },
    });
    expect(result).toEqual({
      kind: "unregistered",
      reason: "could not re-read this PR's own stack membership: bad gateway",
    });
    expect({ add: h.calls.addToStack.length, create: h.calls.createStack.length }).toEqual({ add: 0, create: 0 });
  });

  it("is unregistered, naming the create call, when creating the stack fails", async () => {
    const h = harness({ getPr: () => okAsync(pr({ number: 20, stack: undefined })) });
    const result = await registerAgainstParent({
      ...PARENT_ARGS,
      api: h.api,
      parentPr: { number: 10, stackNumber: undefined },
    });
    expect(result).toEqual({ kind: "unregistered", reason: "the stack create call failed: bad gateway" });
    expect({ add: h.calls.addToStack.length, create: h.calls.createStack.length }).toEqual({ add: 0, create: 1 });
  });

  it("is unregistered, naming the add call, when adding to the stack fails", async () => {
    const h = harness({ getPr: () => okAsync(pr({ number: 20, stack: undefined })) });
    const result = await registerAgainstParent({
      ...PARENT_ARGS,
      api: h.api,
      parentPr: { number: 10, stackNumber: 8 },
    });
    expect(result).toEqual({ kind: "unregistered", reason: "the stack add call failed: bad gateway" });
    expect({ add: h.calls.addToStack.length, create: h.calls.createStack.length }).toEqual({ add: 1, create: 0 });
  });
});

describe("stackRegistrationLines and stackRegistrationFailed", () => {
  it("renders every outcome, and only unregistered fails", () => {
    const outcomes: readonly (GithubStackRegistrationOutcome | undefined)[] = [
      undefined,
      { kind: "none" },
      { base: "feature-a", kind: "no-parent" },
      { kind: "already-joined", stackNumber: 8 },
      { kind: "registered", stackNumber: 5 },
      { kind: "unregistered", reason: "the stack add call failed: bad gateway" },
    ];
    expect(
      outcomes.map((registration) => ({
        failed: stackRegistrationFailed({ registration }),
        lines: stackRegistrationLines({ registration }),
      })),
    ).toEqual([
      { failed: false, lines: [] },
      { failed: false, lines: ["stack: this is the bottom of a fresh stack — no registration needed"] },
      {
        failed: false,
        lines: [
          "stack: base feature-a is not the repository default and no OPEN pull request has it as its head, so there " +
            "is nothing to stack against — this is not a chain",
        ],
      },
      { failed: false, lines: ["stack: GitHub had already joined this PR to stack #8 by branch topology"] },
      { failed: false, lines: ["stack: registered as part of stack #5"] },
      {
        failed: true,
        lines: [
          "stack: NOT registered natively — the stack add call failed: bad gateway",
          "  This pull request is now chained onto another open pull request's branch WITHOUT a native GitHub",
          "  stack, which is the exact state the doors exist to prevent. Repair it before anything else:",
          "    slopweaver github stack adopt --pr <n>",
          "    slopweaver github stack audit --repo <owner/name> --check",
        ],
      },
    ]);
  });
});
