import { describe, expect, it } from "vitest";
import {
  collectRepeated,
  fullHistoryDiagnostics,
  missingTokenDiagnostics,
  parseRefreshOptions,
  type RefreshResult,
  refreshExitCode,
  selectRefreshSources,
  selectStaleSources,
  summariseRefreshResults,
} from "../../../../../cli/commands/refresh/core.js";
import { RefreshErrors } from "../../../../../cli/commands/refresh/errors.js";
import { githubPageCapOf } from "../../../../../cli/commands/refresh/githubJobs.js";
import { snapshotNarrowingDiagnostics } from "../../../../../cli/commands/refresh/snapshotGuard.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { DEFAULT_GITHUB_PAGE_CAP } from "../../../../../corpus/github/orgApi.js";
import { coverageGap } from "../../../../../corpus/ingestJob.js";
import { FETCHABLE_SOURCES } from "../../../../../integrations/corpusSources.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const result = (over: Partial<RefreshResult>): RefreshResult => ({
  deduped: 0,
  errors: [],
  ok: true,
  projected: 0,
  source: "github",
  warnings: [],
  written: 0,
  ...over,
});

describe("collectRepeated", () => {
  it("collects every occurrence and leaves the rest", () => {
    const out = collectRepeated({ flag: "--source", rest: ["--source", "slack", "--all", "--source", "linear"] });
    expect(out.values).toEqual(["slack", "linear"]);
    expect(out.rest).toEqual(["--all"]);
  });

  it("does not consume a flag-shaped value", () => {
    const out = collectRepeated({ flag: "--source", rest: ["--source", "--all"] });
    expect(out.values).toEqual([]);
    expect(out.rest).toEqual(["--source", "--all"]);
  });
});

describe("parseRefreshOptions", () => {
  it("parses repeated sources and channels preserving order", () => {
    const parsed = parseRefreshOptions({
      rest: ["--source", "slack", "--source", "github", "--slack-channel", "C1", "--slack-channel", "C2"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).sources).toEqual(["slack", "github"]);
    expect(unwrap(parsed).slackChannels).toEqual(["C1", "C2"]);
  });

  it("defaults booleans off and omits absent values", () => {
    const parsed = parseRefreshOptions({ rest: [] });
    expect(unwrap(parsed).allSources).toBe(false);
    expect(unwrap(parsed).all).toBe(false);
    expect(unwrap(parsed).repo).toBeUndefined();
  });

  it("rejects a non-positive --lookback-days", () => {
    const parsed = parseRefreshOptions({ rest: ["--lookback-days", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)[0]).toContain("--lookback-days");
  });
});

describe("selectRefreshSources", () => {
  it("defaults to github-only when nothing is chosen", () => {
    expect(unwrap(selectRefreshSources({ allSources: false, sources: [] }))).toEqual(["github"]);
  });

  it("returns the four org-shared sources for --all-sources, and NOT the mailbox", () => {
    expect(unwrap(selectRefreshSources({ allSources: true, sources: [] }))).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
    ]);
  });

  it("accepts gmail when it is NAMED, which is the whole of the mail opt-in", () => {
    expect(unwrap(selectRefreshSources({ allSources: false, sources: ["gmail"] }))).toEqual(["gmail"]);
  });

  it("UNIONS --all-sources with a source named beside it, rather than discarding the named one", () => {
    // The failure this prevents is silent: before, `--all-sources --source gmail` returned the four org
    // sources and no mail, and reported success.
    expect(unwrap(selectRefreshSources({ allSources: true, sources: ["gmail"] }))).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "gmail",
    ]);
  });

  it("does not duplicate a source named beside --all-sources that the sweep already covers", () => {
    expect(unwrap(selectRefreshSources({ allSources: true, sources: ["slack"] }))).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
    ]);
  });

  it("still rejects an unknown source when --all-sources was also passed", () => {
    const chosen = selectRefreshSources({ allSources: true, sources: ["jira"] });
    expect(chosen.isErr()).toBe(true);
    expect(unwrapErr(chosen).code).toBe("UNKNOWN_SOURCE");
    expect(unwrapErr(chosen).message).toBe(
      "unknown --source: jira (expected github|slack|linear|notion|gmail|calendar|fathom|chatgpt|outlook-calendar)",
    );
  });

  it("names gmail in the unknown-source error, so the surface advertises what it accepts", () => {
    expect(unwrapErr(selectRefreshSources({ allSources: false, sources: ["jira"] })).message).toContain(
      "expected github|slack|linear|notion|gmail",
    );
  });

  it("dedups repeated sources preserving first-seen order", () => {
    expect(unwrap(selectRefreshSources({ allSources: false, sources: ["slack", "github", "slack"] }))).toEqual([
      "slack",
      "github",
    ]);
  });

  it("rejects an unknown source", () => {
    const chosen = selectRefreshSources({ allSources: false, sources: ["jira", "self"] });
    expect(chosen.isErr()).toBe(true);
    expect(unwrapErr(chosen)).toStrictEqual(
      RefreshErrors.unknownSource({ expected: FETCHABLE_SOURCES, unknown: ["jira", "self"] }),
    );
    expect(unwrapErr(chosen).message).toBe(
      "unknown --source: jira, self (expected github|slack|linear|notion|gmail|calendar|fathom|chatgpt|outlook-calendar)",
    );
  });
});

describe("fullHistoryDiagnostics", () => {
  it("refuses a bare --all and names both escapes", () => {
    const errors = fullHistoryDiagnostics({ acceptFullHistory: false, all: true });
    expect(errors).toEqual([
      "refresh: --all re-crawls every source from 1970-01-01 and ignores every stored cursor (per-source AND per-repo).",
      "refresh: re-run with --accept-full-history to confirm, or pass --since YYYY-MM-DD for a bounded window.",
    ]);
  });

  it("allows --all once --accept-full-history is passed", () => {
    expect(fullHistoryDiagnostics({ acceptFullHistory: true, all: true })).toEqual([]);
  });

  it("is silent when --all was never passed", () => {
    expect(fullHistoryDiagnostics({ acceptFullHistory: false, all: false })).toEqual([]);
  });
});

describe("snapshotNarrowingDiagnostics", () => {
  /** No narrowing flag given — every field absent, as the parser leaves an unpassed flag. */
  const NONE = {};

  it("refuses a narrowing flag beside a snapshot source, naming both and both ways out", () => {
    expect(snapshotNarrowingDiagnostics({ options: { ...NONE, since: "2026-01-01" }, sources: ["chatgpt"] })).toEqual([
      "refresh: chatgpt reads a whole export every run, so --since cannot narrow it.",
      "refresh: drop --since, or refresh chatgpt in a run of its own.",
    ]);
  });

  it("names every narrowing flag given, in a mixed run", () => {
    const lines = snapshotNarrowingDiagnostics({
      options: { fetchCap: 10, lookbackDays: 3, sample: 5, since: "2026-01-01", until: "2026-02-01" },
      sources: ["slack", "chatgpt"],
    });
    expect(lines[0]!).toBe(
      "refresh: chatgpt reads a whole export every run, so --since, --until, --lookback-days, --sample, --fetch-cap cannot narrow it.",
    );
  });

  it("is silent for a bare snapshot run, and for narrowing flags with no snapshot source", () => {
    expect(snapshotNarrowingDiagnostics({ options: NONE, sources: ["chatgpt"] })).toEqual([]);
    expect(
      snapshotNarrowingDiagnostics({ options: { ...NONE, lookbackDays: 3 }, sources: ["slack", "github"] }),
    ).toEqual([]);
  });
});

describe("FETCHABLE_SOURCES and the snapshot source", () => {
  it("fetches chatgpt by name but leaves it out of --all-sources, which sweeps the cursor-driven core", () => {
    expect(FETCHABLE_SOURCES.includes("chatgpt")).toBe(true);
    expect(unwrap(selectRefreshSources({ allSources: false, sources: ["chatgpt"] }))).toEqual(["chatgpt"]);
    expect(unwrap(selectRefreshSources({ allSources: true, sources: [] })).includes("chatgpt")).toBe(false);
  });
});

describe("missingTokenDiagnostics", () => {
  it("reports every requested non-GitHub source without a token", () => {
    const errors = missingTokenDiagnostics({
      selectedSources: ["github", "slack", "linear", "notion"],
      tokens: { linear: undefined, notion: "n", slack: undefined },
    });
    expect(errors).toEqual([
      "refresh: slack requested but no token (set SLACK_USER_TOKEN (or SLACK_BOT_TOKEN) or $SLOPWEAVER_HOME/secrets/slack-user-token)",
      "refresh: linear requested but no token (set LINEAR_TOKEN or $SLOPWEAVER_HOME/secrets/linear-token)",
    ]);
  });

  it("is empty when every requested source has a token (github never needs one)", () => {
    expect(missingTokenDiagnostics({ selectedSources: ["github"], tokens: {} })).toEqual([]);
  });

  it("does not demand a token for gmail, which authenticates with a stored OAuth grant", () => {
    expect(missingTokenDiagnostics({ selectedSources: ["github", "gmail"], tokens: {} })).toEqual([]);
  });
});

describe("summariseRefreshResults", () => {
  it("emits NOTES before warnings, at `out` level — a note is not a warning", () => {
    const summary = summariseRefreshResults({
      bronzePath: "/h/bronze",
      results: [
        result({
          deduped: 0,
          notes: ["history: wrote 191900 event(s), deduped 0", "spend: 1400 request(s), 2100000 complexity"],
          projected: 1,
          source: "linear",
          warnings: ["heads up"],
          written: 1,
        }),
      ],
    });
    // A lane that fills a store OTHER than bronze — Linear writes its activity history to `corpus/history/` —
    // has to say so, or a store that fills invisibly is indistinguishable from one that never fills. Folding
    // that into `warnings` to get it printed is how a warning channel stops being a signal.
    expect(summary.lines.slice(0, 3)).toEqual([
      { level: "out", text: "  linear: history: wrote 191900 event(s), deduped 0" },
      { level: "out", text: "  linear: spend: 1400 request(s), 2100000 complexity" },
      { level: "warn", text: "  linear: heads up" },
    ]);
  });

  it("prints a failed lane's notes too, so the spend up to the failure is still reported", () => {
    const summary = summariseRefreshResults({
      bronzePath: "/h/bronze",
      results: [result({ errors: ["boom"], notes: ["spend: 12 request(s)"], ok: false, source: "linear" })],
    });
    expect(summary.lines[0]).toEqual({ level: "out", text: "  linear: spend: 12 request(s)" });
    expect(summary.anyFailed).toBe(true);
  });

  it("emits warnings, the wrote-line, and the trailing bronze path in order", () => {
    const summary = summariseRefreshResults({
      bronzePath: "/h/bronze",
      results: [result({ deduped: 2, projected: 5, source: "github", warnings: ["heads up"], written: 3 })],
    });
    expect(summary.lines).toEqual([
      { level: "warn", text: "  github: heads up" },
      { level: "out", text: "github: wrote 3 new, deduped 2 (from 5 projected)" },
      { level: "out", text: "→ /h/bronze" },
    ]);
    expect(summary.totalWritten).toBe(3);
    expect(summary.anyFailed).toBe(false);
  });

  it("marks a failed source and emits its errors instead of a wrote-line", () => {
    const summary = summariseRefreshResults({
      bronzePath: "/h/bronze",
      results: [result({ errors: ["boom"], ok: false, source: "slack" })],
    });
    expect(summary.anyFailed).toBe(true);
    expect(summary.totalWritten).toBe(0);
    expect(summary.lines).toEqual([
      { level: "error", text: "  slack: boom" },
      { level: "out", text: "→ /h/bronze" },
    ]);
  });
});

describe("a source that failed on a coverage gap after writing rows", () => {
  const gap = "slack channel C_HANG was abandoned as stalled and not read this run; the next pass retries it whole";
  const partial = result({
    deduped: 1,
    errors: [gap],
    gaps: [coverageGap({ message: gap })],
    ok: false,
    projected: 8,
    source: "slack",
    warnings: [],
    written: 7,
  });

  it("names the gap AND the rows that did land, so neither half reads as the whole story", () => {
    const summary = summariseRefreshResults({ bronzePath: "/h/bronze", results: [partial] });
    expect(summary.lines).toEqual([
      { level: "error", text: `  slack: ${gap}` },
      { level: "out", text: "slack: wrote 7 new, deduped 1 (from 8 projected)" },
      { level: "out", text: "→ /h/bronze" },
    ]);
    expect(summary.anyFailed).toBe(true);
  });

  it("exits with an error rather than 0, however many rows the other conversations wrote", () => {
    const summary = summariseRefreshResults({ bronzePath: "/h/bronze", results: [partial] });
    expect(refreshExitCode({ anyFailed: summary.anyFailed, totalWritten: summary.totalWritten })).toBe(EXIT_ERROR);
  });
});

describe("refreshExitCode", () => {
  it("is error when any source failed", () => {
    expect(refreshExitCode({ anyFailed: true, totalWritten: 9 })).toBe(EXIT_ERROR);
  });

  it("is expected-empty when nothing was written", () => {
    expect(refreshExitCode({ anyFailed: false, totalWritten: 0 })).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("is OK when records were written", () => {
    expect(refreshExitCode({ anyFailed: false, totalWritten: 4 })).toBe(EXIT_OK);
  });
});

describe("parseRefreshOptions (PR4.2 org-mode flags)", () => {
  it("parses --all-repos with include/exclude globs, org, and caps", () => {
    const parsed = unwrap(
      parseRefreshOptions({
        rest: [
          "--source",
          "github",
          "--all-repos",
          "--github-org",
          "acme",
          "--include-repo",
          "app-*",
          "--include-repo",
          "lib-*",
          "--exclude-repo",
          "*-archive",
          "--repo-cap",
          "50",
          "--slack-membership-cap",
          "20",
        ],
      }),
    );
    expect(parsed.allRepos).toBe(true);
    expect(parsed.githubOrg).toBe("acme");
    expect(parsed.includeRepos).toEqual(["app-*", "lib-*"]);
    expect(parsed.excludeRepos).toEqual(["*-archive"]);
    expect(parsed.repoCap).toBe(50);
    expect(parsed.slackMembershipCap).toBe(20);
  });

  it("defaults org-mode flags off (single-repo behaviour preserved)", () => {
    const parsed = unwrap(parseRefreshOptions({ rest: [] }));
    expect(parsed.allRepos).toBe(false);
    expect(parsed.includeRepos).toEqual([]);
    expect(parsed.repoCap).toBeUndefined();
  });

  it("parses --github-page-cap into a positive integer, undefined by default", () => {
    expect(unwrap(parseRefreshOptions({ rest: ["--github-page-cap", "60"] })).githubPageCap).toBe(60);
    expect(unwrap(parseRefreshOptions({ rest: [] })).githubPageCap).toBeUndefined();
  });

  it("resolves the page ceiling from --github-page-cap, else the org lanes' default", () => {
    expect(githubPageCapOf({ options: unwrap(parseRefreshOptions({ rest: ["--github-page-cap", "60"] })) })).toBe(60);
    expect(githubPageCapOf({ options: unwrap(parseRefreshOptions({ rest: [] })) })).toBe(DEFAULT_GITHUB_PAGE_CAP);
  });

  it("rejects a non-positive --github-page-cap", () => {
    expect(unwrapErr(parseRefreshOptions({ rest: ["--github-page-cap", "0"] }))[0]).toContain(
      "--github-page-cap must be a positive integer",
    );
  });

  it("rejects a non-positive --repo-cap", () => {
    expect(unwrapErr(parseRefreshOptions({ rest: ["--repo-cap", "0"] }))[0]).toContain(
      "--repo-cap must be a positive integer",
    );
  });

  it("parses --fetch-cap into a positive integer, undefined by default", () => {
    expect(unwrap(parseRefreshOptions({ rest: ["--fetch-cap", "5"] })).fetchCap).toBe(5);
    expect(unwrap(parseRefreshOptions({ rest: [] })).fetchCap).toBeUndefined();
  });

  it("rejects a non-positive --fetch-cap", () => {
    expect(unwrapErr(parseRefreshOptions({ rest: ["--fetch-cap", "-1"] }))[0]).toContain(
      "--fetch-cap must be a positive integer",
    );
  });
});

describe("parseRefreshOptions --refetch-unchanged", () => {
  it("is off by default, so a widened --since skips what bronze already holds", () => {
    expect(unwrap(parseRefreshOptions({ rest: [] })).refetchUnchanged).toBe(false);
  });

  it("is on when asked for, forcing the full re-walk", () => {
    expect(unwrap(parseRefreshOptions({ rest: ["--refetch-unchanged"] })).refetchUnchanged).toBe(true);
  });
});

describe("parseRefreshOptions notion cap flags", () => {
  const NOTION = ["--source", "notion"];

  it("defaults to the shipped caps when no flag names one", () => {
    const caps = unwrap(parseRefreshOptions({ rest: NOTION })).notionCaps;
    expect(caps.maxBlockDepth).toBe(6);
    expect(caps.itemCallBudget).toBe(400);
    expect(caps.itemTimeBudgetMs).toBe(undefined);
  });

  it("lifts both caps when a per-item time bound comes with them", () => {
    const caps = unwrap(
      parseRefreshOptions({
        rest: [...NOTION, "--notion-block-depth", "50", "--notion-item-calls", "5000", "--notion-item-time", "30m"],
      }),
    ).notionCaps;
    expect(caps.maxBlockDepth).toBe(50);
    expect(caps.itemCallBudget).toBe(5000);
    expect(caps.itemTimeBudgetMs).toBe(1_800_000);
  });

  it("REFUSES a lifted request budget with no time bound, because the run would have no upper bound", () => {
    const parsed = parseRefreshOptions({ rest: [...NOTION, "--notion-item-calls", "5000"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("needs --notion-item-time alongside it");
  });

  it("REFUSES a lifted depth cap with no time bound", () => {
    const parsed = parseRefreshOptions({ rest: [...NOTION, "--notion-block-depth", "50"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("needs --notion-item-time alongside it");
  });

  it("REFUSES a cap flag with no notion in the selection, rather than silently running GitHub", () => {
    const parsed = parseRefreshOptions({ rest: ["--notion-item-time", "30m"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("only means anything with `--source notion`");
  });

  it("accepts a LOWERED cap on its own — narrowing a bound never needs a time bound", () => {
    const caps = unwrap(parseRefreshOptions({ rest: [...NOTION, "--notion-item-calls", "50"] })).notionCaps;
    expect(caps.itemCallBudget).toBe(50);
    expect(caps.itemTimeBudgetMs).toBe(undefined);
  });
});

describe("selectStaleSources", () => {
  const NOW = "2026-09-04T00:00:00.000Z";
  const cursorsFrom = (map: Readonly<Record<string, string>>) => {
    return ({ source }: { source: string }): string | undefined => map[source];
  };

  it("keeps a source whose cursor is past the threshold and drops one inside it", () => {
    const verdicts = selectStaleSources({
      cursors: cursorsFrom({ notion: "2026-08-23T05:31:00.000Z", slack: "2026-09-02T15:56:06.000Z" }),
      nowIso: NOW,
      sources: ["slack", "notion"],
      staleAfterMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(verdicts.map((v) => v.behind)).toEqual([false, true]);
    expect(verdicts[0]!.line).toBe(
      "refresh slack · current · cursor 2026-09-02T15:56:06.000Z is 1.3d old, inside 7d — skipped",
    );
    expect(verdicts[1]!.line).toBe(
      "refresh notion · BEHIND · cursor 2026-08-23T05:31:00.000Z is 11.8d old, refreshing",
    );
  });

  it("reads a cursor AHEAD of now as current, and never prints a negative age", () => {
    // An empty fetch advances the cursor to its window's `until`, which is tomorrow's date — so this is the
    // ordinary shape of a quiet source, not a corrupt one.
    const verdicts = selectStaleSources({
      cursors: cursorsFrom({ gmail: "2026-09-05" }),
      nowIso: NOW,
      sources: ["gmail"],
      staleAfterMs: 4 * 60 * 60 * 1000,
    });
    expect(verdicts[0]!.behind).toBe(false);
    expect(verdicts[0]!.line).toBe("refresh gmail · current · cursor 2026-09-05 is 0.0m old, inside 4h — skipped");
  });

  it("treats a source with no stored cursor as behind at any threshold", () => {
    const verdicts = selectStaleSources({
      cursors: cursorsFrom({}),
      nowIso: NOW,
      sources: ["gmail"],
      staleAfterMs: 365 * 24 * 60 * 60 * 1000,
    });
    expect(verdicts[0]!.behind).toBe(true);
    expect(verdicts[0]!.line).toBe("refresh gmail · BEHIND · no stored cursor — refreshing");
  });

  it("treats an unreadable cursor as behind rather than as evidence of freshness", () => {
    const verdicts = selectStaleSources({
      cursors: cursorsFrom({ linear: "sometime last week" }),
      nowIso: NOW,
      sources: ["linear"],
      staleAfterMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(verdicts[0]!.behind).toBe(true);
    expect(verdicts[0]!.line).toBe("refresh linear · BEHIND · cursor sometime last week is unreadable — refreshing");
  });

  it("preserves selection order and reports every source, skipped ones included", () => {
    const verdicts = selectStaleSources({
      cursors: cursorsFrom({ github: NOW, linear: NOW, slack: NOW }),
      nowIso: NOW,
      sources: ["github", "slack", "linear"],
      staleAfterMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(verdicts.map((v) => v.source)).toEqual(["github", "slack", "linear"]);
  });
});

describe("parseRefreshOptions --if-stale", () => {
  it("parses the flag and its threshold together, alongside an explicit selection", () => {
    const options = unwrap(parseRefreshOptions({ rest: ["--if-stale", "--all-sources", "--stale-after", "4h"] }));
    expect(options.ifStale).toBe(true);
    expect(options.staleAfterMs).toBe(4 * 60 * 60 * 1000);
  });

  it("refuses a bare number, which under the flag this replaced would have meant DAYS", () => {
    expect(unwrapErr(parseRefreshOptions({ rest: ["--if-stale", "--all-sources", "--stale-after", "4"] }))).toEqual([
      "--stale-after must be a duration with a unit — `30m`, `4h` or `7d` — got `4`. A bare number is refused rather than guessed at.",
    ]);
  });

  it("refuses a BARE --if-stale, which would inherit the implicit GitHub default and hide every other source", () => {
    expect(unwrapErr(parseRefreshOptions({ rest: ["--if-stale"] }))).toEqual([
      "--if-stale needs an explicit source selection: on its own it would inherit the implicit GitHub default " +
        "and silently leave every other source ageing. For a scheduled tick, run " +
        "`slopweaver refresh --if-stale --all-sources --source gmail`; for one source, add `--source <name>`.",
    ]);
  });

  it("accepts --if-stale with a single named source", () => {
    expect(unwrap(parseRefreshOptions({ rest: ["--if-stale", "--source", "slack"] })).ifStale).toBe(true);
  });

  it("refuses a threshold given without --if-stale rather than ignoring it", () => {
    expect(unwrapErr(parseRefreshOptions({ rest: ["--stale-after", "4h"] }))).toEqual([
      "--stale-after only means anything with --if-stale",
    ]);
  });

  it("leaves ifStale false and the threshold unset on a bare refresh", () => {
    const options = unwrap(parseRefreshOptions({ rest: [] }));
    expect(options.ifStale).toBe(false);
    expect(options.staleAfterMs).toBeUndefined();
  });
});
