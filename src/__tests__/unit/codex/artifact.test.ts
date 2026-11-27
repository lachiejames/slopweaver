import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fenceFor, formatItems, renderCodexArtifact } from "../../../codex/artifact.js";
import { createPassScratch, writeCodexArtifact } from "../../../codex/artifactStore.js";
import type { CodexArtifactRecord, CodexAttempt, CodexPassOutcome, CodexUsage } from "../../../codex/types.js";

const USAGE: CodexUsage = {
  cache_write_input_tokens: 3,
  cached_input_tokens: 2,
  input_tokens: 1,
  output_tokens: 4,
  reasoning_output_tokens: 5,
};

const MEASURED_ATTEMPT: CodexAttempt = {
  elapsedMs: 1200,
  finishedAtIso: "2026-01-01T00:00:01.200Z",
  items: { counts: { agent_message: 1 }, kind: "measured" },
  kind: "initial",
  startedAtIso: "2026-01-01T00:00:00.000Z",
  status: "answered",
  threadId: "t1",
  usage: { kind: "measured", usage: USAGE },
};

const ABORTED_ATTEMPT: CodexAttempt = {
  elapsedMs: 204_000,
  finishedAtIso: "2026-01-01T00:03:24.000Z",
  items: { kind: "not-measured", reason: "aborted" },
  kind: "initial",
  startedAtIso: "2026-01-01T00:00:00.000Z",
  status: "aborted",
  threadId: "t1",
  usage: { kind: "not-measured", reason: "aborted" },
};

const REVIEW_SCOPE: CodexArtifactRecord["scope"] = {
  baseRef: "origin/main",
  baseSha: "base123",
  diffBytes: 4096,
  diffSha256: "diffsha",
  headSha: "head456",
  mode: "review",
  pass: "r1",
  property: { id: "r1-01", statement: "no migration is destructive" },
};

const PLAN_SCOPE: CodexArtifactRecord["scope"] = {
  mode: "plan",
  pass: "p2",
  promptBytes: 6007,
  promptSha256: "promptsha",
};

function recordWith({
  outcome,
  attempts = [MEASURED_ATTEMPT],
  artifactId = "aaaa-1111",
  scope = REVIEW_SCOPE,
}: {
  outcome: CodexPassOutcome;
  attempts?: readonly CodexAttempt[];
  artifactId?: string;
  scope?: CodexArtifactRecord["scope"];
}): CodexArtifactRecord {
  return {
    artifactId,
    attempts,
    bound: { conclusionWindowMs: 36_000, totalMs: 240_000, warnAfterMs: 204_000 },
    createdAtIso: "2026-01-01T00:00:00.000Z",
    observedElapsedMs: 1200,
    outcome,
    repoRoot: "/repo",
    requestedApprovalPolicy: "never",
    requestedModel: "gpt-5.6-sol",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: ["/scratch/pass-1"],
    schemaVersion: 1,
    scope,
  };
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Codex's own words for a spend cap, from its rollout log's `task_complete.error.message`. */
const SPEND_CAP =
  "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.";

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const CLEAN: CodexPassOutcome = {
  answer: {
    counterexample: "",
    evidence: "hunk 2",
    propertyId: "r1-01",
    summary: "it holds",
    verdict: "CLEAN",
  },
  kind: "answered",
  rawFinalResponse: '{"verdict":"CLEAN"}',
};

describe("fenceFor", () => {
  it("uses three backticks when the content has none", () => {
    expect(fenceFor({ content: "plain text" })).toBe("```");
  });

  it("outgrows an inner triple fence, so a markdown body cannot terminate the artifact's own block", () => {
    expect(fenceFor({ content: "before\n```ts\ncode\n```\nafter" })).toBe("````");
  });

  it("outgrows the LONGEST run, not the first", () => {
    expect(fenceFor({ content: "``` then ````` here" })).toBe("``````");
  });
});

describe("formatItems", () => {
  it("lists measured counts", () => {
    expect(formatItems({ items: { counts: { agent_message: 2, reasoning: 1 }, kind: "measured" } })).toBe(
      "agent_message=2, reasoning=1",
    );
  });

  it("says `none` for a measured empty set — a real zero, distinct from unknown", () => {
    expect(formatItems({ items: { counts: {}, kind: "measured" } })).toBe("none");
  });

  it("says not-measured with a reason after an abort — never a zero count", () => {
    expect(formatItems({ items: { kind: "not-measured", reason: "aborted" } })).toBe("- (not measured: aborted)");
  });
});

describe("renderCodexArtifact", () => {
  it("names the policy fields as REQUESTED, never as observed", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: CLEAN }) });
    expect(text).toContain("requested model: `gpt-5.6-sol`");
    expect(text).toContain("requested sandbox: `workspace-write`");
    expect(text).toContain("These are what was ASKED FOR");
  });

  /**
   * The artifact is the disclosure of record, and `workspace-write` means writes are possible — so the
   * artifact has to say WHERE they were possible. Without this the reader sees a permissive sandbox and no
   * indication that its scope was one scratch directory.
   */
  it("discloses web search and the writable roots, not just the sandbox mode", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: CLEAN }) });
    expect(text).toContain("requested network access: `true`");
    expect(text).toContain("requested web search: `true`");
    expect(text).toContain("workspace prepared (writable): `/scratch/pass-1`");
  });

  it("records everything needed to prove WHICH diff was judged", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: CLEAN }) });
    expect(text).toContain("base sha (merge-base): `base123`");
    expect(text).toContain("HEAD sha at capture: `head456`");
    expect(text).toContain("diff sha256: `diffsha`");
    expect(text).toContain("diff bytes: 4096");
  });

  it("reports the requested bound and the OBSERVED elapsed separately", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: CLEAN }) });
    expect(text).toContain("requested bound: 240000ms");
    expect(text).toContain("observed elapsed: 1200ms");
  });

  it("prints all five counters for a measured attempt", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: CLEAN }) });
    expect(text).toContain("input_tokens: 1");
    expect(text).toContain("cache_write_input_tokens: 3");
    expect(text).toContain("reasoning_output_tokens: 5");
  });

  it("prints a dash with a reason for an ABORTED attempt, and states no total is derived", () => {
    const text = renderCodexArtifact({
      record: recordWith({ attempts: [ABORTED_ATTEMPT, MEASURED_ATTEMPT], outcome: CLEAN }),
    });
    expect(text).toContain("- (not measured: aborted)");
    expect(text).toContain("NO total is derived");
  });

  it("embeds the raw response verbatim, in a fence that survives inner backticks", () => {
    const raw = 'here is the plan:\n```json\n{"verdict":"READY"}\n```\ndone';
    const text = renderCodexArtifact({
      record: recordWith({ outcome: { ...CLEAN, rawFinalResponse: raw } }),
    });
    expect(text).toContain(raw);
    expect(text).toContain("````");
  });

  it("marks a NO VERDICT artifact as explicitly not clean", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          kind: "no-verdict",
          rawFinalResponse: "half an answer",
          reason: "unrecoverable-abort",
          salvage: null,
        },
      }),
    });
    expect(text).toContain("## Outcome — NO VERDICT");
    expect(text).toContain("**This is not a clean result.**");
    expect(text).toContain("`unrecoverable-abort`");
  });

  it("marks a FATAL artifact as a fault rather than a finding", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          cause: { quota: null, reported: null, thrown: "binary missing" },
          error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
          kind: "fatal",
          salvage: null,
        },
      }),
    });
    expect(text).toContain("## Outcome — FATAL");
    expect(text).toContain("This is a fault, not a finding");
    expect(text).toContain("- cause: binary missing");
  });

  it("names the spend cap on a FATAL artifact, with both channels written out whole", () => {
    const stderr = "Codex Exec exited with code 1: Reconnecting... 1/5\nReconnecting... 2/5";
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          cause: { code: "E1", quota: "credits-out", reported: SPEND_CAP, status: 429, thrown: stderr },
          error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
          kind: "fatal",
          salvage: null,
        },
      }),
    });
    expect(text).toContain(`- cause: ${SPEND_CAP} [quota: credits-out, HTTP 429, code E1]`);
    expect(text).toContain(`### What the stream reported\n\n\`\`\`\n${SPEND_CAP}\n\`\`\``);
    expect(text).toContain(`### What the boundary threw\n\n\`\`\`\n${stderr}\n\`\`\``);
  });

  it("says a FATAL record written before causes were recorded has none, rather than rendering a blank", () => {
    const legacy = {
      error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
      kind: "fatal",
      salvage: null,
    } as unknown as CodexPassOutcome;
    const text = renderCodexArtifact({ record: recordWith({ outcome: legacy }) });
    expect(text).toContain("- cause: cause not recorded (this record predates that field)");
    expect(text).not.toContain("### What the stream reported");
  });

  it("writes the cause once when the stream's report and the thrown message are the same sentence", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          cause: { quota: "credits-out", reported: SPEND_CAP, thrown: SPEND_CAP },
          error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
          kind: "fatal",
          salvage: null,
        },
      }),
    });
    expect(text).toContain(`### What the stream reported, and the boundary threw\n\n\`\`\`\n${SPEND_CAP}\n\`\`\``);
    expect(text).not.toContain("### What the boundary threw\n");
  });

  it("writes what a FATAL pass had already done, so a transport fault does not erase the investigation", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          cause: { quota: null, reported: "unexpected status 404 Not Found", thrown: "exited 1" },
          error: { kind: "llm", message: "the Codex transport failed", operation: "codex.resume" },
          kind: "fatal",
          salvage: {
            commands: 3,
            failedCommands: 1,
            fileChanges: 0,
            lastAgentMessage: "I had narrowed it to the watermark reader.",
            recentCommands: ["rg -n resolveSince src", "git log --oneline -20", "nl -ba src/corpus/refresh.ts"],
            searches: 2,
          },
        },
      }),
    });
    expect(text).toContain("### What the pass had done when it stopped");
    expect(text).toContain("I had narrowed it to the watermark reader.");
    expect(text).toContain("nl -ba src/corpus/refresh.ts");
  });

  it("says a FATAL pass that streamed nothing kept nothing, rather than omitting the section", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          cause: { quota: null, reported: null, thrown: "binary missing" },
          error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
          kind: "fatal",
          salvage: null,
        },
      }),
    });
    expect(text).toContain("### What the pass had done when it stopped");
    expect(text).toContain("Nothing was observed on the stream before the stop");
  });

  it("says a FATAL pass produced no response, inside the shortest fence", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: {
          cause: { quota: null, reported: null, thrown: "binary missing" },
          error: { kind: "llm", message: "the Codex transport failed", operation: "codex.run" },
          kind: "fatal",
          salvage: null,
        },
      }),
    });
    expect(text).toContain("```\n(none — the pass produced no response)\n```\n");
  });

  it("says a no-verdict pass that never answered produced no response", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "no-conclusion-in-bound", salvage: null },
      }),
    });
    expect(text).toContain("```\n(none — the pass produced no response)\n```\n");
  });

  it("shows a null thread id explicitly rather than blank", () => {
    const text = renderCodexArtifact({
      record: recordWith({ attempts: [{ ...ABORTED_ATTEMPT, threadId: null }], outcome: CLEAN }),
    });
    expect(text).toContain("null (the abort landed before the id existed)");
  });
});

describe("writeCodexArtifact", () => {
  it("writes a complete artifact and leaves no partial file behind", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-artifact-"));
    fixtureDirs.push(root);
    const result = writeCodexArtifact({ orchestrationRoot: root, record: recordWith({ outcome: CLEAN }) });
    expect(result.isOk()).toBe(true);
    const location = result._unsafeUnwrap();
    expect(location.artifactPath).toBe(join(root, "aaaa-1111", "artifact.md"));
    const entries = readdirSync(location.runDir);
    // Both published files, and NOTHING else — no `.partial` survivor. Sorted because readdir order is
    // not guaranteed, and a test that depends on it fails on a different filesystem for no real reason.
    expect(entries.toSorted()).toEqual(["artifact.md", "record.json"]);
    expect(readFileSync(location.artifactPath, "utf8")).toContain("# Codex pass artifact — r1");
  });

  it("creates the run directory 0700 and the artifact 0600 — a review of private source", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-artifact-"));
    fixtureDirs.push(root);
    const location = writeCodexArtifact({
      orchestrationRoot: root,
      record: recordWith({ outcome: CLEAN }),
    })._unsafeUnwrap();
    expect(statSync(location.runDir).mode & 0o777).toBe(0o700);
    expect(statSync(location.artifactPath).mode & 0o777).toBe(0o600);
  });

  it("REFUSES to write into an id that already exists, so a collision cannot overwrite a result", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-artifact-"));
    fixtureDirs.push(root);
    const first = writeCodexArtifact({ orchestrationRoot: root, record: recordWith({ outcome: CLEAN }) });
    expect(first.isOk()).toBe(true);
    const second = writeCodexArtifact({ orchestrationRoot: root, record: recordWith({ outcome: CLEAN }) });
    expect(second.isErr()).toBe(true);
    expect(second._unsafeUnwrapErr().kind).toBe("io");
  });

  it("leaves no temporary file and a byte-complete artifact — the write is flushed before rename", () => {
    // Rename is atomic for visibility, but atomicity is not durability: without an fsync a crash can keep
    // the rename and lose the bytes. Found by the review verbs on their own diff (r2-atomic-artifact).
    // A test cannot cut the power, so what is asserted here is the observable part: the published file is
    // complete, and no partial sibling survives to be mistaken for it.
    const root = mkdtempSync(join(tmpdir(), "codex-artifact-"));
    fixtureDirs.push(root);
    const location = writeCodexArtifact({
      orchestrationRoot: root,
      record: recordWith({ outcome: CLEAN }),
    })._unsafeUnwrap();
    expect(readdirSync(location.runDir).toSorted()).toEqual(["artifact.md", "record.json"]);
    const text = readFileSync(location.artifactPath, "utf8");
    expect(text.startsWith("# Codex pass artifact — r1")).toBe(true);
    // The last section is always the raw response, so a truncated write would not reach it.
    expect(text).toContain("## Raw final response");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("keeps two distinct passes in separate directories", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-artifact-"));
    fixtureDirs.push(root);
    writeCodexArtifact({ orchestrationRoot: root, record: recordWith({ artifactId: "one", outcome: CLEAN }) });
    writeCodexArtifact({ orchestrationRoot: root, record: recordWith({ artifactId: "two", outcome: CLEAN }) });
    expect(readdirSync(root).toSorted()).toEqual(["one", "two"]);
  });
});

// `home reclaim` takes a whole scratch once its sibling `artifact.md` exists, so a scratch minted beside an
// existing record would be deleted under a running pass. Both refusals are what keep that structural.
describe("createPassScratch", () => {
  it("mints an owner-only scratch for a fresh id, creating the orchestration root it sits in", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-scratch-"));
    fixtureDirs.push(root);
    const scratch = createPassScratch({ artifactId: "fresh", orchestrationRoot: join(root, "orchestration") });
    expect(scratch.isOk()).toBe(true);
    expect(scratch._unsafeUnwrap()).toBe(join(root, "orchestration", "fresh.scratch"));
    expect(statSync(scratch._unsafeUnwrap()).mode & 0o777).toBe(0o700);
  });

  it("mints the pass's owner-only shell temp inside it, the only temp its sandbox may write", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-scratch-"));
    fixtureDirs.push(root);
    const scratch = createPassScratch({ artifactId: "temp", orchestrationRoot: root })._unsafeUnwrap();
    expect(readdirSync(scratch)).toEqual([".tmp"]);
    expect(statSync(join(scratch, ".tmp")).mode & 0o777).toBe(0o700);
  });

  it("refuses an id whose record directory already exists", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-scratch-"));
    fixtureDirs.push(root);
    writeCodexArtifact({ orchestrationRoot: root, record: recordWith({ artifactId: "spent", outcome: CLEAN }) });
    const scratch = createPassScratch({ artifactId: "spent", orchestrationRoot: root });
    expect(scratch.isErr()).toBe(true);
    expect(scratch._unsafeUnwrapErr().message).toContain("already has a record directory");
    expect(readdirSync(root)).toEqual(["spent"]);
  });

  it("refuses a second scratch for the same id, so two passes never share one workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-scratch-"));
    fixtureDirs.push(root);
    expect(createPassScratch({ artifactId: "same", orchestrationRoot: root }).isOk()).toBe(true);
    const second = createPassScratch({ artifactId: "same", orchestrationRoot: root });
    expect(second.isErr()).toBe(true);
    expect(second._unsafeUnwrapErr().message).toContain("EEXIST");
  });
});

/**
 * The three defects the tool found reviewing its own PR. Each is pinned here so it cannot come back.
 */
describe("what the self-review caught", () => {
  /**
   * s-01. The disclosed writable root was rebuilt by string interpolation while the workspace was built with
   * `join`, so a non-normalised orchestration root produced a disclosure naming a different directory from
   * the one written to. A disclosure that can drift from the thing it discloses is worse than none.
   */
  it("discloses the workspace it was GIVEN, never one it rebuilt", () => {
    const text = renderCodexArtifact({
      record: { ...recordWith({ outcome: CLEAN }), requestedWritableRoots: ["/base/link/../pass-1.scratch"] },
    });

    expect(text).toContain("workspace prepared (writable): `/base/link/../pass-1.scratch`");
  });

  /** And when no workspace could be created, it discloses none rather than inventing a placeholder. */
  it("discloses NO writable root when the pass never got a workspace", () => {
    const text = renderCodexArtifact({
      record: { ...recordWith({ outcome: CLEAN }), requestedWritableRoots: [] },
    });

    expect(text).toContain("workspace prepared (writable): ");
    expect(text).not.toContain("workspace prepared (writable): `undefined`");
    expect(text).not.toContain("workspace prepared (writable): ``");
  });
});

/**
 * A no-verdict artifact used to be a dead end: a reason, and `(none — the pass produced no response)`.
 * These pin the two things that changed — the work is now on the page, and the advice about what to do next
 * is no longer the same sentence for both arms.
 */
describe("renderCodexArtifact — a pass that produced no verdict", () => {
  const SALVAGED: CodexPassOutcome = {
    kind: "no-verdict",
    rawFinalResponse: null,
    reason: "no-conclusion-in-bound",
    salvage: {
      commands: 92,
      failedCommands: 4,
      fileChanges: 1,
      lastAgentMessage: "The two cursor layers disagree and I had not finished checking the second.",
      recentCommands: ["rg -n resolveSince src/corpus"],
      searches: 0,
    },
  };

  it("puts the pass's observed work on the page instead of only a reason", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: SALVAGED, scope: PLAN_SCOPE }) });

    expect(text).toContain("commands observed: 92 (4 exited non-zero)");
    expect(text).toContain("rg -n resolveSince src/corpus");
    expect(text).toContain("The two cursor layers disagree and I had not finished checking the second.");
  });

  it("still says plainly that none of it is a verdict", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: SALVAGED, scope: PLAN_SCOPE }) });

    expect(text).toContain("**This is not a clean result.**");
    expect(text).toContain("This is NOT a verdict");
  });

  /** For a review property, "narrow it, do not raise the bound" is right and stays. */
  it("tells a review pass to narrow the property rather than raise the bound", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: SALVAGED, scope: REVIEW_SCOPE }) });

    expect(text).toContain("narrow the property, do not raise the bound");
  });

  /**
   * For a planning pass it was close to backwards. Measured: three recorded planning passes burned 100% of a
   * 1,500-to-1,800-second bound, and the one narrowing in the history halved the prompt and still failed.
   */
  it("tells a planning pass to match the bound to the breadth it was given", () => {
    const text = renderCodexArtifact({ record: recordWith({ outcome: SALVAGED, scope: PLAN_SCOPE }) });

    expect(text).toContain("match the bound to the BREADTH you asked for");
    expect(text).not.toContain("narrow the property, do not raise the bound");
  });

  it("distinguishes a pass that did nothing from one whose work was not kept", () => {
    const text = renderCodexArtifact({
      record: recordWith({
        outcome: { kind: "no-verdict", rawFinalResponse: null, reason: "off-track", salvage: null },
        scope: PLAN_SCOPE,
      }),
    });

    expect(text).toContain("Nothing was observed on the stream before the stop");
  });
});
