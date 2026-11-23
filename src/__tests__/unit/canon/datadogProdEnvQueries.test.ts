import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  datadogProdCommandSpans,
  type ProdEnvQueryHit,
  singleSpellingProdQueries,
} from "../../../canon/datadogProdEnvQueries.js";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { scanTextFiles } from "../../../lib/textFileScan.js";

describe("singleSpellingProdQueries", () => {
  it("flags a production-only Datadog instruction", () => {
    const content = "- **Telemetry**: `slopweaver datadog apm 'env:production status:error' --from 14d`, then";
    expect(singleSpellingProdQueries({ content, path: "skills/x.md" })).toEqual([
      {
        command: "slopweaver datadog apm 'env:production status:error' --from 14d",
        context: "Telemetry: slopweaver datadog apm 'env:production status:error' --from 14d, then",
        path: "skills/x.md",
      },
    ]);
  });

  it("flags the other half too: env:prod alone drops every backend", () => {
    const content = "`slopweaver datadog logs 'env:prod service:jobs-api'`";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:prod service:jobs-api'",
    ]);
  });

  it("passes the logs-search OR form", () => {
    const content = "`slopweaver datadog errors --query 'env:(prod OR production)' --from 7d`";
    expect(singleSpellingProdQueries({ content, path: "a.md" })).toEqual([]);
  });

  it("passes the metrics tag-scope OR form, two bare clauses", () => {
    const content = "`slopweaver datadog metrics 'avg:x{(env:prod OR env:production)}'`";
    expect(singleSpellingProdQueries({ content, path: "a.md" })).toEqual([]);
  });

  it("reads a span the doc wrapped across two lines as one command", () => {
    const content = "measured with `slopweaver datadog apm 'env:production status:error' --from 7d --by\nteam`.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog apm 'env:production status:error' --from 7d --by team",
    ]);
  });

  it("keeps pairing backticks after a code fence's odd three-backtick run", () => {
    const content = "```bash\nyarn lint\n```\n\nThen `slopweaver datadog apm 'env:production'` there.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog apm 'env:production'",
    ]);
  });

  it("keeps pairing backticks when prose follows a closing fence with no blank line", () => {
    const content = "```bash\nyarn lint\n```\nThen `slopweaver datadog apm 'env:production' --from 1d`.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog apm 'env:production' --from 1d",
    ]);
  });

  it("reads a fenced command line as an instruction too", () => {
    const content = "Run:\n\n```bash\nslopweaver datadog logs 'env:production status:error' --from 1h\n```";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:production status:error' --from 1h",
    ]);
  });

  it("reads a shorter fence run inside a longer fence as content, never as the close", () => {
    const content = "````text\n```\nslopweaver datadog logs 'env:production'\n```\n````\n";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:production'",
    ]);
  });

  it("closes a tilde fence only on tildes", () => {
    const content =
      "~~~\n```\nslopweaver datadog logs 'env:prod'\n~~~\nAfter `slopweaver datadog logs 'env:production'`.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:prod'",
      "slopweaver datadog logs 'env:production'",
    ]);
  });

  it("reads a command behind an env prefix or a prompt", () => {
    const content =
      "`DD_SITE=datadoghq.com slopweaver datadog logs 'env:production'`\n\n```\n$ slopweaver datadog logs 'env:prod'\n```";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "DD_SITE=datadoghq.com slopweaver datadog logs 'env:production'",
      "$ slopweaver datadog logs 'env:prod'",
    ]);
  });

  it("splits chained shell commands, so two single spellings never cancel out", () => {
    const content = "```bash\nslopweaver datadog logs 'env:prod'; slopweaver datadog logs 'env:production' | head\n```";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:prod'",
      "slopweaver datadog logs 'env:production'",
    ]);
  });

  it("never splits on a separator inside a quoted query", () => {
    const content = "`slopweaver datadog logs 'env:(prod OR production) msg:\"a;b\"' && echo ok`";
    expect(singleSpellingProdQueries({ content, path: "a.md" })).toEqual([]);
  });

  it("keeps a backslash-escaped quote inside its double-quoted argument", () => {
    const content = 'Run `slopweaver datadog logs "message:\\"failed|retry\\" env:prod"`.';
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      'slopweaver datadog logs "message:\\"failed|retry\\" env:prod"',
    ]);
  });

  it("reads a span wrapped between the verb's own words, continuation indent and all", () => {
    const content = "Run `slopweaver\n  datadog logs 'env:production'` now.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:production'",
    ]);
  });

  it("reads a line-start triple-backtick span as a span, never a fence opener", () => {
    const content = "```slopweaver datadog logs 'env:prod'```\n\nThen `slopweaver datadog logs 'env:production'`.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:prod'",
      "slopweaver datadog logs 'env:production'",
    ]);
  });

  it("reads a fence a list item indents past three spaces", () => {
    const content = "100. Run this:\n\n     ```bash\n     slopweaver datadog logs 'env:prod status:error'\n     ```\n";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs 'env:prod status:error'",
    ]);
  });

  it("reads a double-backtick span holding a shorter run as one span", () => {
    const content = "Run ``slopweaver datadog logs `saved-query` env:prod`` now, then `yarn lint`.";
    expect(singleSpellingProdQueries({ content, path: "a.md" }).map((hit) => hit.command)).toEqual([
      "slopweaver datadog logs `saved-query` env:prod",
    ]);
  });

  it("still flags a span whose prose calls it measured — only the exact allowlist exempts", () => {
    const content = "Measured 3 Oct 2026: `slopweaver datadog apm 'env:production' --from 1d`.";
    expect(singleSpellingProdQueries({ content, path: "a.md" })).toHaveLength(1);
  });

  it("ignores a staging or Pulumi-stack env, which is not a production spelling", () => {
    const content = "`slopweaver datadog logs 'env:staging'` and `slopweaver datadog logs 'env:prod-uk'`";
    expect(datadogProdCommandSpans({ content })).toEqual([]);
  });

  it("ignores a code span that is not a slopweaver datadog command", () => {
    expect(datadogProdCommandSpans({ content: "`env:production`" })).toEqual([]);
  });
});

/**
 * Single-spelling spans that are dated measurements quoting the exact command they were measured with.
 * Rewriting one would falsify the number recorded beside it, so each is held exactly — path and whole
 * command — never by a pattern a new instruction could also match. `measured` is the recorded measurement's own
 * words in the span's paragraph, its figure stated as the class it shows, so prose rewritten around the same span
 * into an instruction stops matching.
 */
const DATED_MEASUREMENTS: readonly { readonly path: string; readonly command: string; readonly measured: string }[] = [
  {
    command: "slopweaver datadog errors --query env:production --from 1d --state for-review",
    measured: "the For Review state at its cap",
    path: "skills/automation/reference/error-tracking-batch.md",
  },
  {
    command: "slopweaver datadog apm 'env:production status:error -@error.type:*' --from 7d",
    measured: "over half of production error spans over seven days carried no",
    path: "skills/automation/reference/error-tracking-batch.md",
  },
  {
    command: "slopweaver datadog apm 'env:production status:error' --from 7d --by team",
    measured: "a single team: span among hundreds of thousands of production error spans over 7 days",
    path: "skills/automation/reference/finding-card.md",
  },
  {
    command: "slopweaver datadog apm 'env:prod status:error' --from 14d --by service",
    measured: "env:production alone drops every error span the prod services emit",
    path: "skills/automation/reference/organisation-hunt-lenses.md",
  },
];

/**
 * A hit's comparable identity, plus whether its paragraph still records the number it measured.
 *
 * @param hit the hit's path, command and paragraph
 * @param measured the allowlist's words for that number, or null when the hit is not allowlisted
 * @returns the path, the command and whether the measurement's words stand beside it
 */
function heldAs({ hit, measured }: { hit: ProdEnvQueryHit; measured: string | null }): {
  path: string;
  command: string;
  besideItsNumber: boolean;
} {
  const besideItsNumber = measured !== null && hit.context.includes(measured);
  return { besideItsNumber, command: hit.command, path: hit.path };
}

describe("the real skills and docs", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const paths = workingTreeFilesOf({ root }).filter(
    (path) => (path.startsWith("skills/") || path.startsWith("docs/")) && path.endsWith(".md"),
  );
  const readText = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");
  // One pass over the tree, shared: rendering every doc is the cost, so no test pays it twice.
  const scanned = scanTextFiles({
    paths,
    readText,
    scan: ({ path, content }) => [
      {
        hits: singleSpellingProdQueries({ content, path }),
        spans: datadogProdCommandSpans({ content }),
      },
    ],
  });
  const spans = scanned.hits.flatMap((file) => file.spans);
  const hits = scanned.hits.flatMap((file) => file.hits);

  it("reads every selected doc, and selects some", () => {
    expect(scanned.unreadable).toEqual([]);
    expect(scanned.scanned).toBeGreaterThan(0);
  });

  it("finds production-scoped Datadog commands at all, and at least one naming both spellings", () => {
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.filter((span) => span.spellings.length === 2).length).toBeGreaterThan(0);
  });

  it("tells no session to run a single-spelling production query outside the dated measurements", () => {
    const held = hits.map((hit) => {
      const entry = DATED_MEASUREMENTS.find((row) => row.path === hit.path && row.command === hit.command);
      if (entry === undefined) {
        return heldAs({ hit, measured: null });
      }
      return heldAs({ hit, measured: entry.measured });
    });
    expect(held.toSorted((left, right) => left.command.localeCompare(right.command))).toEqual(
      DATED_MEASUREMENTS.map((row) => ({ besideItsNumber: true, command: row.command, path: row.path })).toSorted(
        (left, right) => left.command.localeCompare(right.command),
      ),
    );
  });

  it("stops holding a measured span once its prose is rewritten into an instruction", () => {
    const entry = DATED_MEASUREMENTS[0]!;
    const rewritten = `Run \`${entry.command}\` to read today's list.`;
    const [hit] = singleSpellingProdQueries({ content: rewritten, path: entry.path });
    expect(heldAs({ hit: hit!, measured: entry.measured }).besideItsNumber).toBe(false);
  });
});
