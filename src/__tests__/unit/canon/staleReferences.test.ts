/**
 * The canon stale-reference ratchet.
 *
 * Two describe blocks, same shape as `gateRegistration.test.ts`: the first exercises the PURE tokenizer and
 * resolver on inline fixtures (never touches disk); the second reads this repository's real canon files —
 * `AGENTS.md`, `.claude/rules/*.md`, `skills/*​/**.md`, `docs/*.md` — against the real
 * CLI manifest, and ratchets: every offender it finds today must be named in `KNOWN_STALE`, and every name in
 * `KNOWN_STALE` must still be a real offender, so the list can only shrink as docs get fixed, never grow
 * silently and never rot into naming a reference that was already repaired.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addressesFromManifestModules,
  formatOffender,
  isCanonPath,
  scanCanonFile,
  type VerbAddress,
} from "../../../canon/staleReferences.js";
import type { CommandMeta } from "../../../cli/defineCommand.js";
import { DEFAULT_VERB, type NounManifestModule, type VerbManifestEntry } from "../../../cli/manifest.js";
import { MANIFEST_MODULES } from "../../../cli/manifests/index.js";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { scanTextFiles } from "../../../lib/textFileScan.js";

const ADDRESSES: readonly VerbAddress[] = [
  { noun: "doctor", usage: "usage: slopweaver doctor", verb: DEFAULT_VERB },
  { noun: "doctor", usage: "usage: slopweaver doctor run", verb: "run" },
  {
    noun: "handover",
    usage:
      "usage: slopweaver handover start <slug> [--base <value>] [--branch <value>] [--dir <value>] [--home <value>] [--probe]",
    verb: "start",
  },
  { noun: "handover", usage: "usage: slopweaver handover list [--all] [--base <value>] [--probe]", verb: "list" },
  {
    noun: "cmux",
    usage: "usage: slopweaver cmux send <text> [--workspace <value>]",
    verb: "send",
  },
];

const NEVER_EXISTS = (): boolean => false;
const ALWAYS_EXISTS = (): boolean => true;

describe("isCanonPath", () => {
  it("covers AGENTS.md", () => {
    expect(isCanonPath({ path: "AGENTS.md" })).toBe(true);
  });

  it("covers a rule file", () => {
    expect(isCanonPath({ path: ".claude/rules/testing.md" })).toBe(true);
  });

  it("covers a skill's bundled reference file, not only its SKILL.md", () => {
    expect(isCanonPath({ path: "skills/loop/reference/reviewer.md" })).toBe(true);
  });

  it("covers a skill doc", () => {
    expect(isCanonPath({ path: "skills/store/SKILL.md" })).toBe(true);
  });

  it("covers a docs page", () => {
    expect(isCanonPath({ path: "docs/security.md" })).toBe(true);
  });

  it("excludes source under src/", () => {
    expect(isCanonPath({ path: "src/canon/staleReferences.ts" })).toBe(false);
  });

  it("excludes a non-markdown file inside a skill directory", () => {
    expect(isCanonPath({ path: "skills/store/helper.py" })).toBe(false);
  });

  it("excludes the retired commands/ tree, which no longer exists", () => {
    expect(isCanonPath({ path: "commands/store.md" })).toBe(false);
  });
});

describe("addressesFromManifestModules", () => {
  function fakeMeta({ usage }: { usage: string }): CommandMeta {
    return {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: null,
      parseRejectIsIoFree: true,
      summary: "a fake verb",
      usage,
    };
  }

  function fakeEntry({ usage }: { usage: string }): VerbManifestEntry {
    return { load: () => Promise.resolve(() => 0), meta: fakeMeta({ usage }) };
  }

  it("flattens a noun's verbs into addresses, default verb included", () => {
    const modules: readonly NounManifestModule[] = [
      {
        noun: "doctor",
        summary: "env preflight",
        verbs: {
          [DEFAULT_VERB]: fakeEntry({ usage: "usage: slopweaver doctor" }),
          run: fakeEntry({ usage: "usage: slopweaver doctor run" }),
        },
      },
    ];
    expect(addressesFromManifestModules({ modules })).toEqual([
      { noun: "doctor", usage: "usage: slopweaver doctor", verb: DEFAULT_VERB },
      { noun: "doctor", usage: "usage: slopweaver doctor run", verb: "run" },
    ]);
  });

  it("yields nothing for a barrel with no modules", () => {
    expect(addressesFromManifestModules({ modules: [] })).toEqual([]);
  });
});

describe("scanCanonFile — invocations", () => {
  it("passes a real backticked invocation with an advertised flag", () => {
    const content = "Run `slopweaver handover start <slug> [--branch <value>]` to open a run.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("skips a placeholder-only invocation shape", () => {
    const content = "The address is `slopweaver <noun> <verb>`.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("flags an unknown noun", () => {
    const content = "`slopweaver frobnicate now`";
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      {
        detail: "no noun `frobnicate` in the CLI manifest",
        file: "AGENTS.md",
        kind: "unknown-noun",
        reference: "`slopweaver frobnicate now`",
      },
    ]);
  });

  it("flags an unknown verb on a noun with no default to fall back to", () => {
    const content = "`slopweaver handover explode`";
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      {
        detail: "no verb `explode` on noun `handover`",
        file: "AGENTS.md",
        kind: "unknown-verb",
        reference: "`slopweaver handover explode`",
      },
    ]);
  });

  it("falls back to the default verb when a second word is a positional argument, not a subverb", () => {
    // `connect <github|slack|linear|notion> --check` — the source name is consumed by the DEFAULT verb's own
    // positional argument, not a second verb keyword. Flags are still checked, against the default's usage.
    const connectAddresses: readonly VerbAddress[] = [
      {
        noun: "connect",
        usage: "usage: slopweaver connect <github|slack|linear|notion> --check [--json] [--repo owner/repo]",
        verb: DEFAULT_VERB,
      },
      { noun: "connect", usage: "usage: slopweaver connect <github|slack|linear|notion> --check", verb: "check" },
    ];
    const content = "`slopweaver connect slack --check --json`";
    expect(
      scanCanonFile({ addresses: connectAddresses, content, path: "skills/slack/SKILL.md", pathExists: NEVER_EXISTS }),
    ).toEqual([]);
  });

  it("never flags --help, which every verb accepts without advertising it", () => {
    const content = "`slopweaver handover start --help`";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("never flags a flag that only appears inside a quoted argument to another program", () => {
    const content = '`slopweaver cmux send --workspace <ws> "claude --plugin-dir <dir> --resume <uuid>"`';
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("flags a flag the resolved verb's usage does not advertise", () => {
    const content = "`slopweaver handover start <slug> --nonexistent`";
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      {
        detail: "`--nonexistent` is not in `handover start`'s advertised usage",
        file: "AGENTS.md",
        kind: "unknown-flag",
        reference: "`slopweaver handover start <slug> --nonexistent`",
      },
    ]);
  });

  it("stays silent on a bare noun with no default verb on record", () => {
    const content = "`slopweaver cmux`";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("resolves a bash-fence example line with no backticks", () => {
    const content = ["```bash", "slopweaver handover list            # the board", "```"].join("\n");
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("flags an unknown verb inside a bash-fence example line", () => {
    const content = ["```bash", "slopweaver handover explode   # not a real verb", "```"].join("\n");
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      {
        detail: "no verb `explode` on noun `handover`",
        file: "AGENTS.md",
        kind: "unknown-verb",
        reference: "`slopweaver handover explode   # not a real verb`",
      },
    ]);
  });
});

describe("scanCanonFile — repo paths", () => {
  it("passes an existing path", () => {
    const content = "See `src/canon/staleReferences.ts` for the sweep.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: ALWAYS_EXISTS })).toEqual([]);
  });

  it("flags a missing path", () => {
    const content = "See `src/does/not/exist.ts` for the sweep.";
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      {
        detail: "`src/does/not/exist.ts` does not exist",
        file: "AGENTS.md",
        kind: "missing-path",
        reference: "`src/does/not/exist.ts`",
      },
    ]);
  });

  it("strips a trailing line number before checking", () => {
    const content = "See `src/canon/staleReferences.ts:42` for the sweep.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: ALWAYS_EXISTS })).toEqual([]);
  });

  it("strips a trailing #symbol before checking", () => {
    const content = "See `src/canon/staleReferences.ts#scanCanonFile` for the sweep.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: ALWAYS_EXISTS })).toEqual([]);
  });

  it("recognises a bare known root filename", () => {
    const content = "Read `AGENTS.md` in full.";
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      { detail: "`AGENTS.md` does not exist", file: "AGENTS.md", kind: "missing-path", reference: "`AGENTS.md`" },
    ]);
  });

  // The glob SPAN is never a candidate; the directory it is rooted at is, so this seam resolving only
  // `src/__tests__/unit/` proves nothing else in the span was ever looked up.
  it("never treats a glob as a path, but does resolve the directory it is rooted at", () => {
    const content = "Every `src/__tests__/unit/**/*.test.ts` file mirrors its source.";
    expect(
      scanCanonFile({
        addresses: ADDRESSES,
        content,
        path: "AGENTS.md",
        pathExists: ({ path }) => path === "src/__tests__/unit/",
      }),
    ).toEqual([]);
  });

  it("never treats a URL as a path", () => {
    const content = "See `https://example.com/docs` for background.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("never treats an env var as a path", () => {
    const content = "Set `$SLOPWEAVER_HOME` before running.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("never treats a bare identifier with no directory as a path", () => {
    const content = "`parseProbes` reads the block.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });
});

/**
 * The three positions a dead path actually hid in, every one of them outside an inline code
 * span and every one of them invisible to this sweep at the time — see `prosePathTokens`.
 */
describe("scanCanonFile — repo paths outside an inline code span", () => {
  it("flags a missing path inside a fenced block", () => {
    const content = ["```", "src/gone/              # a directory this repo does not have", "```"].join("\n");
    const offenders = scanCanonFile({
      addresses: ADDRESSES,
      content,
      path: "docs/architecture.md",
      pathExists: NEVER_EXISTS,
    });
    expect(offenders).toEqual([
      {
        detail: "`src/gone/` does not exist",
        file: "docs/architecture.md",
        kind: "missing-path",
        reference: "`src/gone/`",
      },
    ]);
  });

  it("flags a missing path written bare in prose, with no backticks at all", () => {
    const content = "A separate session from the bot's own loop (skills/gone/SKILL.md) by design.";
    const offenders = scanCanonFile({
      addresses: ADDRESSES,
      content,
      path: "skills/recipe-scheduler/SKILL.md",
      pathExists: NEVER_EXISTS,
    });
    expect(offenders).toEqual([
      {
        detail: "`skills/gone/SKILL.md` does not exist",
        file: "skills/recipe-scheduler/SKILL.md",
        kind: "missing-path",
        reference: "`skills/gone/SKILL.md`",
      },
    ]);
  });

  it("flags a missing path inside a multi-word backticked span, which PATH_LIKE rejects on its own", () => {
    const content = "| Every skill | `ls skills/gone/` — each file's front matter is what a host lists |";
    const offenders = scanCanonFile({
      addresses: ADDRESSES,
      content,
      path: "docs/README.md",
      pathExists: NEVER_EXISTS,
    });
    expect(offenders).toEqual([
      {
        detail: "`skills/gone/` does not exist",
        file: "docs/README.md",
        kind: "missing-path",
        reference: "`skills/gone/`",
      },
    ]);
  });

  it("reports one missing path once, however many times the file names it", () => {
    const content = "`src/gone/x.ts` is the file; src/gone/x.ts is where it lives.";
    const offenders = scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS });
    expect(offenders).toEqual([
      {
        detail: "`src/gone/x.ts` does not exist",
        file: "AGENTS.md",
        kind: "missing-path",
        reference: "`src/gone/x.ts`",
      },
    ]);
  });

  it("strips a sentence-ending full stop before resolving", () => {
    const content = "The whole map is in docs/architecture.md.";
    expect(
      scanCanonFile({
        addresses: ADDRESSES,
        content,
        path: "AGENTS.md",
        pathExists: ({ path }) => path === "docs/architecture.md",
      }),
    ).toEqual([]);
  });

  it("never flags the prefix a glob truncated, which is no directory", () => {
    const content = "A main-checkout guard family (hooks/pretooluse-main-checkout-*.ts) protects the pinned checkout.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("never flags the prefix an angle placeholder truncated", () => {
    const content = "Its own worktree (.claude/worktrees/recipe-child-<slug>), which is what makes that safe.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("still flags the directory a brace expansion is rooted at, because a trailing slash ends a path", () => {
    const content = "| B | Streaming lifecycle | src/gone/{contract,lifecycle}.ts |";
    const offenders = scanCanonFile({
      addresses: ADDRESSES,
      content,
      path: "docs/x.md",
      pathExists: ({ path }) => path !== "src/gone/",
    });
    expect(offenders).toEqual([
      { detail: "`src/gone/` does not exist", file: "docs/x.md", kind: "missing-path", reference: "`src/gone/`" },
    ]);
  });

  it("never flags a path inside a double-quoted argument to another program", () => {
    const content = 'Cross-reference `ps aux | grep "bin/gone"` by worktree path.';
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });

  it("never flags a slash-bearing token rooted outside this repository's own top-level directories", () => {
    const content = "The layout is corpus/members/ under $SLOPWEAVER_HOME, and the placeholder is owner/repo.";
    expect(scanCanonFile({ addresses: ADDRESSES, content, path: "AGENTS.md", pathExists: NEVER_EXISTS })).toEqual([]);
  });
});

describe("formatOffender", () => {
  it("renders the file and detail as one line", () => {
    expect(
      formatOffender({
        offender: {
          detail: "no noun `frobnicate` in the CLI manifest",
          file: "AGENTS.md",
          kind: "unknown-noun",
          reference: "`slopweaver frobnicate now`",
        },
      }),
    ).toBe("AGENTS.md: no noun `frobnicate` in the CLI manifest");
  });
});

/**
 * Offenders the first real sweep found and left unfixed, each with why. A PR that adds a new offender not
 * already named here fails the "real canon files" test below; a PR that fixes one of these must delete its
 * entry — the second half of the ratchet, checked by the "only shrink" test.
 */
const KNOWN_STALE: readonly { readonly line: string; readonly reason: string }[] = [
  {
    line: "skills/loop/reference/reviewer-packet.md: `skills/loop/reference/run.ts` does not exist",
    reason:
      "informal shorthand for 'this verb's own run module' — several run.ts files exist in this repo and " +
      "the doc does not say which; needs a human to pick the real target rather than a guessed rename. The " +
      "shorthand travelled with the packet section into its own reference file and is unchanged",
  },
  {
    line: "docs/agent-docs-practice.md: `.claude/agents/` does not exist",
    reason:
      "Claude Code's OWN convention directories, tabulated in a DATED research record (2026-08-24) of how " +
      "each host discovers agent docs. This install has never had them — `.claude/` here holds `rules/` and " +
      "nothing else — so the row describes the host, not a pointer into this repository",
  },
  {
    line: "docs/agent-docs-practice.md: `.claude/commands/` does not exist",
    reason: "same host-convention table — see the `.claude/agents/` entry above",
  },
  {
    line: "docs/agent-docs-practice.md: `.claude/skills/` does not exist",
    reason: "same host-convention table — see the `.claude/agents/` entry above",
  },
  {
    line: "docs/routing-preflight-proof.md: `src/live/turn/query.ts` does not exist",
    reason:
      "a frozen proof record citing a record-identity collision at `src/live/turn/query.ts:140` as the tree " +
      "stood when the proof was taken; the module has since moved. Same class as the integration-coverage.md " +
      "entries — rewriting a captured proof's citations falsifies what was actually measured",
  },
  {
    line: "skills/orchestrate/reference/opening-a-run.md: `docs/new-doc.md` does not exist",
    reason:
      "an illustrative placeholder in the `doneWhen` syntax example, captioned '# a file that will exist'. " +
      "The block teaches the three probe shapes, so a real path there would be read as the probe to copy",
  },
  {
    line: "skills/orchestrate/reference/opening-a-run.md: `src/old/path.ts` does not exist",
    reason: "see the docs/new-doc.md entry above — the same `doneWhen` example, the `absent:` line",
  },
  {
    line: "skills/orchestrate/reference/opening-a-run.md: `src/thing/newFile.ts` does not exist",
    reason: "see the docs/new-doc.md entry above — the same `doneWhen` example, the `present:` line",
  },
  {
    line: "docs/codex-orchestration.md: `--properties-file` is not in `codex review`'s advertised usage",
    reason:
      "already tracked as a known gap in docs/codex-plan-convergence/concurrency-bounds-and-open-findings.md itself ('codex review --help " +
      "under-reports its own flags') — fixing REVIEW_USAGE is out of this ticket's scope",
  },
  {
    line: "docs/integration-coverage.md: `src/llm/claudeCli.ts` does not exist",
    reason:
      "a frozen point-in-time coverage measurement, not live instructions — src/llm was removed by the " +
      "no-headless-model refactor after this report was written; rewriting its numbers would falsify history",
  },
  {
    line: "docs/integration-coverage.md: `src/llm` does not exist",
    reason: "see the src/llm/claudeCli.ts entry above — same frozen measurement report",
  },
  {
    line: "docs/security/slack-write-path.md: no noun `did` in the CLI manifest",
    reason:
      "a hard-wrapped prose sentence ('...anything slopweaver did not post...') happens to put a lowercase " +
      "'slopweaver' at the start of a wrapped line — a real limitation of the bare-line heuristic, not a stale " +
      "reference",
  },
  {
    line: "docs/slack-assistant-surface/multi-human-and-decomposition.md: `src/live/assistant/threadMeta.ts` does not exist",
    reason:
      "a forward-looking 'Owns (new files)' design table, not a description of what shipped — some rows built " +
      "under different names (`src/live/turn/status.ts` → `liveStatus.ts`) and this one may not have built at " +
      "all; needs the doc's own author to reconcile plan vs reality, not a guessed rename",
  },
  {
    line: "docs/slack-assistant-surface/multi-human-and-decomposition.md: `src/live/turn/status.ts` does not exist",
    reason: "see the threadMeta.ts entry above — same design table; the real file is `src/live/turn/liveStatus.ts`",
  },
  {
    line: "docs/slack-assistant-surface/multi-human-and-decomposition.md: `src/live/assistant/` does not exist",
    reason: "see the threadMeta.ts entry above — the same design table, the directory the row is rooted at",
  },
  {
    line: "docs/slack-assistant-surface/multi-human-and-decomposition.md: `src/live/assistant/events/` does not exist",
    reason: "see the threadMeta.ts entry above — same design table, the container-events row",
  },
  {
    line: "docs/slack-assistant-surface/multi-human-and-decomposition.md: `src/live/turn/stream/` does not exist",
    reason: "see the threadMeta.ts entry above — same design table, the streaming-lifecycle row",
  },
  {
    line: "docs/slack-assistant-surface/multi-human-and-decomposition.md: `src/retrieval/slackSearch/` does not exist",
    reason: "see the threadMeta.ts entry above — same design table, the real-time-search row",
  },
];

describe("the real canon files", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..", "..");
  const addresses = addressesFromManifestModules({ modules: MANIFEST_MODULES });

  function realOffenders(): readonly string[] {
    const paths = workingTreeFilesOf({ root }).filter((path) => isCanonPath({ path }));
    const result = scanTextFiles({
      paths,
      readText: ({ path }) => readFileSync(join(root, path), "utf8"),
      scan: ({ content, path }) =>
        scanCanonFile({
          addresses,
          content,
          path,
          pathExists: ({ path: candidate }) => existsSync(join(root, candidate)),
        }),
    });
    expect(result.unreadable).toEqual([]);
    expect(result.scanned > 0).toBe(true);
    return result.hits.map((offender) => formatOffender({ offender })).toSorted();
  }

  it("finds no offender outside the known-stale allowlist", () => {
    const known = new Set(KNOWN_STALE.map((entry) => entry.line));
    const unratcheted = realOffenders().filter((line) => !known.has(line));
    expect(unratcheted).toEqual([]);
  });

  it("carries no known-stale entry that has already been fixed", () => {
    const offenders = new Set(realOffenders());
    const fixed = KNOWN_STALE.map((entry) => entry.line).filter((line) => !offenders.has(line));
    expect(fixed).toEqual([]);
  });
});
