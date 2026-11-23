/**
 * The pure half of `slopweaver browser shot` — the verb that photographs one page through the Playwright
 * extension relay, in the owner's own Chrome, from a Node process.
 *
 * ## Why the verb exists at all
 *
 * The rule: use slopweaver playwright for everything instead of
 * the Claude-in-Chrome extension. MEASURED: three sessions had reported
 * a screenshot leg BLOCKED because `list_connected_browsers` returned `[]` — the Claude-in-Chrome extension
 * was disconnected — while `browser/playwrightCli.ts` was attached to the same browser and filing PNGs for
 * every atlas walk on the machine.
 *
 * The mechanical reason is that the relay had no route out of a walk. `createPlaywrightCliTransport` was
 * reachable only from an atlas's own `walkRun.ts`, bound to that atlas's declared pages, so a session that
 * simply needed a picture of one address had nothing to call and reached for the extension. Three pieces of
 * canon told it to: `browser/brief.ts` said the extension "is the one route into that browser, and it is
 * reachable from an agent session's tools, never from a Node process"; `datadog shot`'s brief named
 * `computer (screenshot)` and `javascript_tool` by tool name; and `loop-bot`'s visual-evidence reference said
 * "this plugin captures nothing". This verb is what makes all three false, and they were corrected with it.
 *
 * ## It is the transport's read-only call set and nothing more
 *
 * A capture here is `goto`, settle, `screenshot` — the closed set `browser/pageTransport.ts` publishes. No
 * click, no typed text, no page script, so the incident's shape (a missed click that posted under
 * the owner's name) is not available to this verb at any price. That is also its limit, stated rather than
 * discovered: a capture needing a time-range picker moved or a panel marked cannot come from here, which is
 * why `datadog shot monitor` runs its own declared relay arm (`browser/datadogMonitorBacktestSnippet.ts`)
 * rather than this verb.
 *
 * ## A door alone does not refuse a photograph
 *
 * This verb does not refuse a platform just because its register entry carries a door (Datadog's `door: null`
 * excepted): a screenshot verb navigates and photographs and does nothing else, and visiting a website and taking a
 * screenshot counts as a read.
 *
 * The register carries the distinction a door test would ignore. A platform's
 * `BrowserWritePolicy` is the question *"do we intend to write here"*, and every platform the owner has
 * answered yes for — Slack, GitHub, Linear, Notion, Vanta, Datadog — is `read-before-write`. Refusing to
 * photograph one of those was refusing a READ on the strength of a WRITE ruling, which is the exact failure
 * `read-before-write` was itself written to avoid (`admit/browserSurface.ts`).
 *
 * So {@link classifyShotTarget} asks the POLICY rather than the door:
 *
 * - `read-before-write` — photographed. A capture here is still `goto`, settle, `screenshot` and nothing
 *   else, so the incident's shape is no more available on Slack than on Datadog.
 * - `refuse-every-write`, doored — refused, naming the door. Uninhabited in the register today and
 *   deliberately live: a platform that gains a door and must never be driven is one word.
 * - `refuse-every-write`, doorless (every unregistered host) — photographed, as before. It has no door to
 *   name and reads were never the thing an unregistered host was refused.
 *
 * **What this widens, stated rather than discovered.** The question was about Vanta; the fix is category-wide, so
 * a session may now photograph a Slack channel or a GitHub pull request too. That is deliberate — a
 * Vanta-shaped exception would have been a hostname special case, and the register has no such shape — but
 * it is a widening past the question, so the investigation page that carried this change says so where the owner
 * can veto it. The evidence-QUALITY argument is untouched and belongs where it always did: a structured
 * `github read` beats a picture of the same page, and `loop-bot/reference/visual-evidence.md` still says
 * to reach for the verb first. This verb stops being the thing that makes it impossible.
 *
 * ## Two profiles, and the default is the one that waits
 *
 * The incident image was this verb's own output: `goto`, a flat settle, `fullPage: true`, and a picture
 * of `6 service values found` above a panel that had not rendered, at 4032x6722. So the DEFAULT is now
 * **evidence** mode — wait for a closed, source-owned target to render, photograph, crop to the target and
 * its context, frame, caption, and measure — and the old shape survives only as `--raw`, whose output is
 * named diagnostic and carries no record an outbound form would admit. `--settle` belongs to `--raw`
 * alone; on the default path there is no sleep to lengthen, which is the point:
 * `browser/evidenceCaptureSnippet.ts` carries why 20 seconds of settle made the picture worse.
 *
 * No fs, no clock, no network, no browser here; `shotRun.ts` and `shotEvidenceRun.ts` do every read and
 * every write.
 */
import { classifyBrowserUrl, type RegisteredPlatform } from "../../../admit/browserSurface.js";
import type { BrowserTransportError } from "../../../browser/pageTransport.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import {
  type EvidenceTarget,
  inferEvidenceTarget,
  parseEvidenceTarget,
} from "../../../visualEvidence/evidenceTarget.js";
import { type BrowserVerbDooredProviderError, BrowserVerbErrors } from "./errors.js";
import { validReadinessTimeoutMs, validSettleMs, validUrl } from "./shotFlags.js";

/**
 * What a capture leg hit, named — never a silence.
 *
 * The row this verb closes asked for exactly this: *"whatever this row lands should still make a session's
 * capture leg name which of the remaining states it hit, since that is the one a composer reports to the
 * owner."* Before it, a composer saw the same nothing whether no browser was connected, the relay was held
 * by another walk, or a capture wedged — and could not say which in its answer.
 */
export type ShotOutcome =
  /** Raw mode: bytes came back and were written to `--out`. Not attachment-ready — no record exists. */
  | "photographed"
  /**
   * Evidence mode: the target rendered, the crop was taken, framed, captioned and measured, and the final
   * PNG is at `--out` with its capture record written. `readback-pending` — a visible session still has
   * to look at it and run `browser image-record` before any form will carry it.
   */
  | "captured"
  /** Evidence mode: the readiness wait expired, or Node's own re-judgement of the observation refused. */
  | "target-not-ready"
  /** Evidence mode: the page moved between the observation the shutter fired on and the one after it. */
  | "page-moved"
  /** Evidence mode: the address is not one any adapter covers, and no `--target` named one. */
  | "unsupported-target"
  /** Evidence mode: a crop, a pixel scan or an annotation refused; the raw capture is kept beside `--out`. */
  | "crop-refused"
  /**
   * Evidence mode: everything rendered and cropped, and the final bytes fail the prominence policy. A
   * FAILED image record is written for them, so they can never be attached; `--out` still holds them so
   * a session can see what was refused.
   */
  | "evidence-unfit"
  /** Evidence mode: the picture exists and its record could not be written, so it is not attachment-ready. */
  | "record-failed"
  /** The page was reached and described, but the browser returned no PNG for it. */
  | "reached-not-photographed"
  /** The address could not be loaded at all. */
  | "navigation-failed"
  /** Nothing was attached: no consent token, no recorded profile, or another walk holds the machine's relay. */
  | "relay-unavailable"
  /** The browser went away mid-capture. */
  | "session-lost"
  /** The page settled on a different origin — typically a sign-in redirect. */
  | "off-lease-origin"
  /**
   * The address belongs to a doored provider registered `refuse-every-write`, so nothing was opened.
   *
   * The name predates the rule that makes the POLICY rather than the door decide this, and it
   * is kept because a composer reads it and an outcome vocabulary that renames itself under a caller is
   * worse than one whose name is a little historical. {@link classifyShotTarget} carries the current test.
   */
  | "doored-provider"
  /** `--out` is inside a git checkout, where a commit could carry the picture into a pull request; nothing was opened. */
  | "output-in-checkout";

/** Which of the two profiles a shot runs, with that profile's own knobs and no other's. */
export type ShotMode =
  | {
      readonly kind: "evidence";
      /** The closed target, or `null` to infer it from the address at run time. */
      readonly target: EvidenceTarget | null;
      readonly readinessTimeoutMs: number;
      /** An optional first caption line — the claim the picture backs. */
      readonly caption: string | null;
    }
  | { readonly kind: "raw"; readonly settleMs: number };

/**
 * The target an evidence shot waits for and crops to: the one `--target` named, else the one its address
 * implies — a mode with no target is one that asked for the inference.
 *
 * @param mode the evidence profile's own knobs
 * @param url the address being photographed
 * @returns the target, or `null` when none was named and no adapter covers the address
 */
export function evidenceShotTarget({
  mode,
  url,
}: {
  mode: Extract<ShotMode, { kind: "evidence" }>;
  url: string;
}): EvidenceTarget | null {
  if (mode.target === null) {
    return inferEvidenceTarget({ url });
  }
  return mode.target;
}

/**
 * The platform name this verb takes the relay lease under.
 *
 * Named for the verb rather than for a provider, because a refusal on the other side prints it and the
 * reader needs to know a one-off capture is holding the tab, not an atlas they could go and look at.
 *
 * @internal
 */
export const SHOT_LEASE_PLATFORM = "browser shot";

/**
 * Which named state a transport failure is.
 *
 * @param error the typed transport failure
 * @returns the outcome a composer reports
 */
export function outcomeOf({ error }: { error: BrowserTransportError }): ShotOutcome {
  if (error.code === "SESSION_LOST") {
    return "session-lost";
  }
  if (error.code === "NAVIGATION_FAILED") {
    return "navigation-failed";
  }
  if (error.code === "OFF_LEASE_ORIGIN") {
    return "off-lease-origin";
  }
  return "relay-unavailable";
}

/** The validated invocation. */
export interface BrowserShotOptions {
  readonly url: string;
  readonly out: string;
  readonly mode: ShotMode;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Whether an address may be photographed at all, and what to use instead when it may not.
 *
 * Judged on the platform's write POLICY, not on whether it has a door — see this module's header for the
 * owner ruling that moved it. A photograph is a read, and a read was never what a `read-before-write`
 * ruling withheld.
 *
 * @param url the address the caller asked for
 * @returns nothing when the shot may proceed, or the refusal naming the provider and its door
 */
export function classifyShotTarget({ url }: { url: string }): Result<null, BrowserVerbDooredProviderError> {
  return shotRefusalFor({ platform: classifyBrowserUrl({ url }) });
}

/**
 * The same judgement, over a platform rather than an address.
 *
 * Split out because the refusing arm is currently UNINHABITED by the register — every doored platform in it
 * is `read-before-write` — so a test driven through {@link classifyShotTarget} alone could only ever
 * exercise the allowing arm, and a refusal nothing can reach reports clean whether or not it works. This
 * takes the platform directly, so the refusal has a witness that can fire.
 *
 * @param platform the register's entry for the address, or `undefined` when it names none
 * @returns nothing when the shot may proceed, or the refusal naming the provider and its door
 */
export function shotRefusalFor({
  platform,
}: {
  platform: RegisteredPlatform | undefined;
}): Result<null, BrowserVerbDooredProviderError> {
  if (platform == null || platform.policy === "read-before-write" || platform.door == null) {
    return ok(null);
  }
  return err(BrowserVerbErrors.dooredProvider({ door: platform.door, provider: platform.provider }));
}

/**
 * Resolve the `--raw` profile: its settle, and a refusal for every evidence flag beside it.
 *
 * @param settle the raw `--settle` value
 * @param evidenceFlags the evidence-only flags as passed, each refused by name when present
 * @returns the raw mode, or every rejection
 */
function resolveRawMode({
  settle,
  evidenceFlags,
}: {
  settle: string | undefined;
  evidenceFlags: readonly (readonly [string, string | undefined])[];
}): Result<ShotMode> {
  const problems = evidenceFlags
    .filter(([, value]) => value !== undefined)
    .map(([flag]) => `${flag} belongs to the default evidence capture and means nothing under --raw`);
  const resolvedSettle = validSettleMs({ raw: settle });
  if (resolvedSettle.isErr()) {
    problems.push(resolvedSettle.error.message);
  }
  if (problems.length > 0 || resolvedSettle.isErr()) {
    return err(problems);
  }
  return ok({ kind: "raw", settleMs: resolvedSettle.value });
}

/**
 * Resolve the default evidence profile: the target, the readiness wait and the caption, refusing `--settle`.
 *
 * @param settle the raw `--settle` value — raw mode's flag, refused here
 * @param target the raw `--target` value
 * @param readinessTimeout the raw `--readiness-timeout` value
 * @param caption the raw `--caption` value
 * @returns the evidence mode, or every rejection
 */
function resolveEvidenceMode({
  settle,
  target,
  readinessTimeout,
  caption,
}: {
  settle: string | undefined;
  target: string | undefined;
  readinessTimeout: string | undefined;
  caption: string | undefined;
}): Result<ShotMode> {
  const problems: string[] = [];
  if (settle !== undefined) {
    problems.push(
      "--settle is the --raw profile's flag; the default capture waits for the target to render rather than " +
        "for a clock, and lengthening a sleep is what produced the incident image (use --readiness-timeout)",
    );
  }
  const resolvedTarget = target === undefined ? ok(null) : parseEvidenceTarget({ text: target });
  if (resolvedTarget.isErr()) {
    problems.push(...visualEvidenceErrorLines({ error: resolvedTarget.error }));
  }
  const timeout = validReadinessTimeoutMs({ raw: readinessTimeout });
  if (timeout.isErr()) {
    problems.push(timeout.error.message);
  }
  if (caption?.trim() === "") {
    problems.push("--caption cannot be blank");
  }
  if (problems.length > 0 || timeout.isErr() || resolvedTarget.isErr()) {
    return err(problems);
  }
  const mode = { kind: "evidence", readinessTimeoutMs: timeout.value, target: resolvedTarget.value } as const;
  if (caption === undefined) {
    // No `--caption`: the picture carries no first caption line.
    return ok({ ...mode, caption: null });
  }
  return ok({ ...mode, caption });
}

/**
 * Resolve which profile a shot runs, from the flags that belong to each.
 *
 * @param raw whether `--raw` was passed
 * @param settle the raw `--settle` value — raw mode's flag, refused on the default path
 * @param target the raw `--target` value
 * @param readinessTimeout the raw `--readiness-timeout` value
 * @param caption the raw `--caption` value
 * @returns the mode, or every rejection
 */
function resolveShotMode({
  raw,
  settle,
  target,
  readinessTimeout,
  caption,
}: {
  raw: boolean;
  settle: string | undefined;
  target: string | undefined;
  readinessTimeout: string | undefined;
  caption: string | undefined;
}): Result<ShotMode> {
  if (raw) {
    return resolveRawMode({
      evidenceFlags: [
        ["--target", target],
        ["--readiness-timeout", readinessTimeout],
        ["--caption", caption],
      ],
      settle,
    });
  }
  return resolveEvidenceMode({ caption, readinessTimeout, settle, target });
}

/**
 * Resolve `browser shot`'s own flags, accumulating every rejection rather than stopping at the first.
 *
 * @param url the raw `--url` value
 * @param out the raw `--out` value
 * @param settle the raw `--settle` value, raw mode only
 * @param raw whether the diagnostic raw profile was asked for
 * @param target the raw `--target` value, evidence mode only
 * @param readinessTimeout the raw `--readiness-timeout` value, evidence mode only
 * @param caption the raw `--caption` value, evidence mode only
 * @param json whether machine-readable output was asked for
 * @param home the state home override, when one was passed
 * @returns the validated invocation, or every rejection
 */
export function resolveShotOptions({
  url,
  out,
  settle,
  raw = false,
  target,
  readinessTimeout,
  caption,
  json,
  home,
}: {
  url: string | undefined;
  out: string | undefined;
  settle: string | undefined;
  raw?: boolean;
  target?: string | undefined;
  readinessTimeout?: string | undefined;
  caption?: string | undefined;
  json: boolean;
  home: string | undefined;
}): Result<BrowserShotOptions> {
  const problems: string[] = [];
  let address: string | null = null;
  if (url === undefined) {
    problems.push("`browser shot` needs --url <address>, e.g. --url https://us3.datadoghq.com/dashboard/abc");
  } else {
    const parsed = validUrl({ url });
    if (parsed.isErr()) {
      problems.push(parsed.error.message);
    } else {
      address = parsed.value;
    }
  }
  if (out === undefined) {
    problems.push("`browser shot` needs --out <file.png>, the path the picture is written to");
  } else if (!out.endsWith(".png")) {
    problems.push(`--out takes a .png path, got '${out}'`);
  }
  const mode = resolveShotMode({ caption, raw, readinessTimeout, settle, target });
  if (mode.isErr()) {
    problems.push(...mode.error);
  }
  if (problems.length > 0 || address === null || out === undefined || mode.isErr()) {
    return err(problems);
  }
  return ok({ home, json, mode: mode.value, out, url: address });
}

/** What an evidence capture reports beside the common fields, when it got as far as observing a target. */
export interface ShotEvidenceReport {
  readonly target: string;
  readonly captureId: string | null;
  /** The whole-page capture kept beside `--out` for diagnosis, or `null` when none was taken. */
  readonly rawPath: string | null;
  readonly rawSize: string | null;
  readonly cropRect: string | null;
  readonly finalSize: string | null;
  readonly finalDigest: string | null;
  readonly targetState: string | null;
  readonly summary: string | null;
  readonly timeRange: string | null;
  readonly elapsedMs: number | null;
  readonly legibility: string | null;
  readonly issues: readonly string[];
}

/** What one capture attempt produced, as the verb reports it. */
export interface ShotReport {
  readonly outcome: ShotOutcome;
  readonly url: string;
  /** Where the browser actually settled, when it settled anywhere. */
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly statusCode: number | null;
  /** The file the picture was written to, or `null` when no picture exists. */
  readonly path: string | null;
  readonly bytes: number | null;
  /** Why there is no picture, or `null` when there is one. */
  readonly because: string | null;
  /** Evidence mode's own account; `null` under `--raw` and before a target was observed. */
  readonly evidence: ShotEvidenceReport | null;
}

/**
 * Render a report for a reader.
 *
 * The outcome is named on its own line in every arm, including the successful one, because the whole point
 * of the verb is that a composer can quote which state its capture leg reached.
 *
 * @param report what the attempt produced
 * @returns the lines to print
 */
export function renderShotReport({ report }: { report: ShotReport }): readonly string[] {
  const lines = [`browser shot: ${report.outcome} — ${report.url}`];
  if (report.finalUrl !== null && report.finalUrl !== report.url) {
    lines.push(`  settled on ${report.finalUrl}`);
  }
  if (report.title !== null && report.title !== "") {
    lines.push(`  title: ${report.title}`);
  }
  if (report.path !== null && report.bytes !== null) {
    lines.push(`  wrote ${String(report.bytes)} byte(s) to ${report.path}`);
  }
  if (report.because !== null) {
    lines.push(`  ${report.because}`);
  }
  if (report.outcome === "photographed") {
    lines.push("  raw profile: this picture carries no record, so no outbound form will attach it");
  }
  if (report.evidence !== null) {
    lines.push(...renderEvidenceLines({ evidence: report.evidence }));
  }
  return lines;
}

/** The raw picture's size and path, `?` for a size never measured, or `null` when no raw picture was kept. */
function rawPictureFact({ evidence }: { evidence: ShotEvidenceReport }): string | null {
  if (evidence.rawPath === null) {
    return null;
  }
  if (evidence.rawSize === null) {
    return `? at ${evidence.rawPath}`;
  }
  return `${evidence.rawSize} at ${evidence.rawPath}`;
}

/** The evidence block, one measured fact per line. */
function renderEvidenceLines({ evidence }: { evidence: ShotEvidenceReport }): readonly string[] {
  const lines = [`  target: ${evidence.target}`];
  const facts: readonly (readonly [string, string | number | null])[] = [
    ["state", evidence.targetState],
    ["summary", evidence.summary],
    ["time range", evidence.timeRange],
    ["waited", evidence.elapsedMs === null ? null : `${String(evidence.elapsedMs)}ms`],
    ["raw", rawPictureFact({ evidence })],
    ["crop", evidence.cropRect],
    ["final", evidence.finalSize],
    ["digest", evidence.finalDigest],
    ["legibility", evidence.legibility],
    ["capture record", evidence.captureId],
  ];
  for (const [label, value] of facts) {
    if (value !== null) {
      lines.push(`  ${label}: ${String(value)}`);
    }
  }
  for (const issue of evidence.issues) {
    lines.push(`  ! ${issue}`);
  }
  if (evidence.captureId !== null) {
    lines.push(
      "  readback-pending: open the final PNG, then `slopweaver browser image-record --form <json>` naming " +
        `captureId ${evidence.captureId} — no outbound form attaches it before that`,
    );
  }
  return lines;
}
