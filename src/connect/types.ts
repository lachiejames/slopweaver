/**
 * The shared shape of a `connect <source> --check` preflight report, plus the two pure report-finalisers
 * every per-source classifier ends on. A report is a deterministic, value-free description of what a token
 * can reach: whether auth succeeded, which scopes/capabilities are present, and whether a 1-item read saw
 * real data. It NEVER carries a token, a cache or a raw payload — only capability verdicts and hints, which
 * for a mailbox (Gmail, Outlook) name the account the grant bound to — so `--json` is safe to print into the
 * (transcript-visible) slash-command output.
 *
 * Pure: no I/O. The effectful probes live in the per-source modules; here is only the type + the ok-rule.
 */

import type {
  ConnectSource as DerivedConnectSource,
  ConnectTarget as DerivedConnectTarget,
} from "../integrations/corpusSources.js";

/**
 * The sources a preflight can run against that also ingest — derived from the integration registry
 * (`src/integrations/corpusSources.ts`), a type-only import, so this module never loads it.
 *
 * `gmail` is the odd one and its own module says why: the other four ask "does this token work", while a
 * user-consented grant can work perfectly and still be narrower than the verbs need — so its report is
 * mostly a per-capability scope breakdown rather than a single pass/fail.
 */
export type ConnectSource = DerivedConnectSource;

/**
 * Everything `connect --check` can preflight: every integration whose manifest has a `connect` feature. The ones
 * with no corpus row (Datadog, Outlook) are LIVE connectors — read at question time, never crawled into bronze —
 * so each is a preflight target but not a {@link ConnectSource}, which `onboard plan` turns into a
 * `refresh --source` command.
 */
export type ConnectTarget = DerivedConnectTarget;

/** One capability's verdict: present, present-but-reduced, or absent (a hard gap that fails the check). */
export type CapabilityStatus = "ok" | "warning" | "missing";

/** One named capability the source needs, with its verdict and a human hint (never a value). */
export interface ConnectCapability {
  /** Stable id the slash command / tests branch on (e.g. `auth`, `scope:users:read.email`, `read-probe`). */
  readonly id: string;
  readonly status: CapabilityStatus;
  /** A short why/how — the hint to fix a gap. Never contains a token, email, or raw payload. */
  readonly detail: string;
}

/**
 * The ONE sanctioned voice for a read-probe verdict — PR5.4.
 *
 * A `connect --check` probe fetches a 1-item sample purely to prove the token can reach data. Every
 * connector used to render that as a bare `read probe saw 1 member(s), 1 channel(s)`, which reads as a
 * COVERAGE statistic: it looks like the corpus knows about one person and one channel. That single line
 * nearly ended adoption of a corpus holding tens of thousands of records.
 *
 * The rule this encodes: **a diagnostic must never print a bare count that could be read as a total.** Say
 * what the number is (a probe sample size), say what it is not (coverage), and name the verb that actually
 * measures coverage. `--check` and `audit` answer different questions and must stop competing.
 *
 * @param sampled the per-lane sample descriptions, already pluralised by the caller (e.g. `1 member(s)`)
 * @returns the capability detail string
 */
export function probeScopeDetail({ sampled }: { sampled: readonly string[] }): string {
  return `scope check only — the probe sampled ${sampled.join(", ")}. These are PROBE SAMPLE SIZES, not corpus coverage; run \`slopweaver audit\` for coverage.`;
}

/** A whole source's preflight verdict. `ok` ⇒ every required capability present + reachable. */
export interface ConnectCheckReport {
  readonly source: ConnectTarget;
  readonly ok: boolean;
  readonly tokenPresent: boolean;
  readonly capabilities: readonly ConnectCapability[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  /**
   * Present ONLY on a synthetic report from `src/connect/fixture.ts` — a live preflight never sets this.
   * Untyped against a specific scenario union here to avoid a dependency from this module onto the fixture
   * module; the fixture module's own scenario type is a subtype of the `string` below.
   */
  readonly fixture?: { readonly scenario: string };
}

/**
 * Finalise a report: `ok` iff the token is present, no capability is `missing`, and no hard error was
 * recorded. A `warning` capability (reduced breadth) still passes — the user can proceed knowingly. Pure.
 *
 * @param tokenPresent whether a token was resolved for the source
 * @param capabilities the per-capability verdicts
 * @param warnings reduced-breadth notes
 * @param errors hard failures (auth unreachable, etc.)
 * @returns the finalised report with `ok` computed
 */
export function finaliseReport({
  source,
  tokenPresent,
  capabilities,
  warnings = [],
  errors = [],
}: {
  source: ConnectTarget;
  tokenPresent: boolean;
  capabilities: readonly ConnectCapability[];
  warnings?: readonly string[];
  errors?: readonly string[];
}): ConnectCheckReport {
  const hasMissing = capabilities.some((c) => c.status === "missing");
  return {
    capabilities,
    errors,
    ok: tokenPresent && errors.length === 0 && !hasMissing,
    source,
    tokenPresent,
    warnings,
  };
}

/**
 * The report for a source with no token configured — a single `missing` auth capability carrying the hint
 * on how to set it. Pure.
 *
 * @param hint how to provide the token (env var / `secrets set` name)
 * @returns a not-ok, no-token report
 */
export function noTokenReport({ source, hint }: { source: ConnectTarget; hint: string }): ConnectCheckReport {
  return finaliseReport({
    capabilities: [{ detail: hint, id: "auth", status: "missing" }],
    errors: [`no ${source} token configured`],
    source,
    tokenPresent: false,
  });
}
