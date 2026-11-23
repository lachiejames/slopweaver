/**
 * Pure parser, usage and door request for `slopweaver github attach`.
 *
 * Two sub-verbs, in the shape `github stack` and `github self-review` already use: `upload` does the work,
 * `status` reports what the owner's own browser currently holds. Splitting them keeps the only external
 * write behind an explicit word rather than behind a bare `attach <file>`, which reads like a local
 * operation.
 *
 * There is no `login` and no `import`, and their absence is the owner's ruling rather than a
 * gap — `docs/browser-route.md`, and what it retired, `docs/browser-route/screenshot-reading-and-retirement.md`. The session is read from the Chrome the owner is already signed in to, so there
 * is nothing to capture once, nothing to paste in, and nothing to re-capture when it lapses.
 */

import { ACKNOWLEDGEMENT_MIN_WORDS, acknowledgementCarriesAReason } from "../../../admit/inventedVisual.js";
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { provesProblem } from "../../../outbound/github/attachEvidence.js";
import type { GithubSessionStatus } from "../../../outbound/github/chromeSession.js";
import type { OrgGrantVerdict } from "../../../outbound/github/orgSso.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";

const GITHUB_ATTACH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["file", "repo", "number", "alt", "proves", "org", "home", "acknowledge"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_ATTACH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_ATTACH_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_ATTACH_FLAGS }),
].map((name) => `--${name}`);

/** The parsed `upload` sub-verb. */
export interface GithubAttachUploadArgs {
  readonly kind: "upload";
  readonly file: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly alt: string | undefined;
  /** One line saying what the picture proves — scanned, and carried into the upload receipt a description cites. */
  readonly proves: string;
  /** The reason the invented-visual gate was waived for this file, when the caller supplied one. */
  readonly acknowledge: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The parsed `status` sub-verb, which addresses a browser rather than a repository. */
interface GithubAttachSessionArgs {
  readonly kind: "status";
  /** The organisation whose SAML grant is read back, when named. */
  readonly org: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Whichever sub-verb was asked for. */
export type GithubAttachArgs = GithubAttachUploadArgs | GithubAttachSessionArgs;

/** Reject a flag that belongs to another sub-verb rather than ignoring it. */
function strayUploadFlags({ values }: { values: Readonly<Record<string, string | boolean>> }): readonly string[] {
  return ["file", "repo", "number", "alt", "proves", "acknowledge"]
    .filter((name) => values[name] !== undefined)
    .map((name) => `--${name} is only meaningful for \`github attach upload\``);
}

/**
 * Parse the attach invocation before resolving any credential.
 *
 * Every usage problem is collected rather than reported one at a time, and a flag naming another
 * sub-verb's input is refused BY NAME instead of silently ignored — an ignored `--file` on a `status` call
 * reads as a no-op run when it was actually a typo for `upload`.
 *
 * @param rest argv after `github attach`
 * @returns the resolved sub-verb and its inputs, or every usage problem
 */
export function parseGithubAttachArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GithubAttachArgs, GithubVerbError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: GITHUB_ATTACH_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const [subVerb, ...extra] = parsed.value.positionals;
  if (subVerb === undefined) {
    return err(GithubVerbErrors.attachSubVerbMissing());
  }
  if (extra.length > 0) {
    return err(GithubVerbErrors.attachExtraArgument({ got: String(extra[0]) }));
  }
  const homeValue = parsed.value.values["home"];
  const home = typeof homeValue === "string" ? homeValue : undefined;
  const json = parsed.value.values["json"] === true;
  if (subVerb === "upload") {
    const orgValue = parsed.value.values["org"];
    return typeof orgValue === "string"
      ? err(GithubVerbErrors.attachOrgOnUpload())
      : parseUploadArgs({ home, json, values: parsed.value.values });
  }
  return parseSessionArgs({ home, json, subVerb, values: parsed.value.values });
}

/**
 * The state home a parsed attach invocation acts on: the `--home` it named, else the resolved default.
 *
 * @param args the parsed invocation, whose `home` is the `--home` value when one was named
 * @param resolveDefault the default home's resolver, called only when no `--home` was named
 * @returns the state home's absolute path
 */
export function attachStateHome({
  args,
  resolveDefault,
}: {
  args: GithubAttachArgs;
  resolveDefault: () => string;
}): string {
  if (args.home === undefined) {
    return resolveDefault();
  }
  return args.home;
}

/**
 * The one sub-verb that addresses a SESSION rather than a repository.
 *
 * Split from {@link parseGithubAttachArgs} so neither half carries the other's branching — the upload
 * address and the status inputs have nothing in common beyond `--home` and `--json`.
 *
 * @param values the tokenised flags
 * @param subVerb the sub-verb word, which may still be unrecognised
 * @param home the resolved state home, if one was named
 * @param json whether machine-readable output was asked for
 * @returns the parsed status sub-verb, or why it is not one
 */
function parseSessionArgs({
  values,
  subVerb,
  home,
  json,
}: {
  values: Readonly<Record<string, string | boolean>>;
  subVerb: string;
  home: string | undefined;
  json: boolean;
}): Result<GithubAttachArgs, GithubVerbError> {
  if (subVerb !== "status") {
    return err(GithubVerbErrors.attachSubVerbUnknown({ got: subVerb }));
  }
  const stray = strayUploadFlags({ values });
  if (stray.length > 0) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: stray }));
  }
  const orgValue = values["org"];
  return ok({ home, json, kind: "status", org: typeof orgValue === "string" ? orgValue : undefined });
}

/** `--proves` as typed, and every reason it cannot stand: required, one line, short. */
function provesFrom({ values }: { values: Readonly<Record<string, string | boolean>> }): {
  readonly proves: string | undefined;
  readonly problems: readonly string[];
} {
  const value = values["proves"];
  if (typeof value !== "string") {
    return { problems: ['--proves "<one line: what the picture proves>" is required'], proves: undefined };
  }
  const problem = provesProblem({ proves: value });
  return { problems: problem === null ? [] : [problem], proves: value };
}

/** The `upload` branch's own inputs, split out so neither half carries the other's shape. */
function parseUploadArgs({
  values,
  home,
  json,
}: {
  values: Readonly<Record<string, string | boolean>>;
  home: string | undefined;
  json: boolean;
}): Result<GithubAttachArgs, GithubVerbError> {
  const fileValue = values["file"];
  const file = typeof fileValue === "string" ? fileValue : undefined;
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  const numberValue = values["number"];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  const { proves, problems: provesProblems } = provesFrom({ values });
  const errors = [
    ...(file === undefined ? ["--file <path> is required"] : []),
    ...(repo === undefined ? ["--repo owner/name is required"] : []),
    ...(Number.isInteger(number) && number > 0
      ? []
      : ["--number must be a positive whole number — the pull request or issue the upload is for"]),
    ...provesProblems,
  ];
  if (errors.length > 0 || file === undefined || repo === undefined || proves === undefined) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: errors }));
  }
  const altValue = values["alt"];
  const ackValue = values["acknowledge"];
  const acknowledge = typeof ackValue === "string" ? ackValue : undefined;
  if (acknowledge !== undefined && !acknowledgementCarriesAReason({ reason: acknowledge })) {
    return err(GithubVerbErrors.acknowledgementTooShort({ got: acknowledge, minWords: ACKNOWLEDGEMENT_MIN_WORDS }));
  }
  return ok({
    acknowledge,
    alt: typeof altValue === "string" ? altValue : undefined,
    dryRun: values["dry-run"] === true,
    file,
    home,
    json,
    kind: "upload",
    number,
    owner: repo.owner,
    proves,
    repo: repo.repo,
  });
}

/**
 * The alt text an embed carries: `--alt` when the caller gave one, else the uploaded file's own name.
 *
 * @param args the parsed upload inputs
 * @param uploadName the name GitHub recorded for the uploaded asset
 * @returns the alt text for the embed's markdown
 */
export function embedAltText({ args, uploadName }: { args: GithubAttachUploadArgs; uploadName: string }): string {
  const alt = args.alt;
  if (alt === undefined) {
    return uploadName;
  }
  return alt;
}

/** Why a session is unusable, as the status line prints it — `unknown` when the read named no reason. */
function unusableDetail({ status }: { status: GithubSessionStatus }): string {
  const detail = status.detail;
  if (detail === undefined) {
    return "unknown";
  }
  return detail;
}

/** The account github.com names the browser as, or a phrase saying the read named none. */
function signedInAs({ status }: { status: GithubSessionStatus }): string {
  const login = status.login;
  if (login === undefined) {
    return "an account it does not name";
  }
  return login;
}

/**
 * The offline half of `attach status` as the lines it prints: one line when the browser holds no usable
 * github.com session, else which account it is signed in as and when its auth cookies lapse.
 *
 * @param status what the browser currently holds
 * @returns the lines to print, in order
 */
export function offlineStatusLines({ status }: { status: GithubSessionStatus }): readonly string[] {
  if (!status.present || !status.usable) {
    return [`${status.source} holds no usable github.com session: ${unusableDetail({ status })}`];
  }
  return [
    `${status.source} is signed in to github.com as ${signedInAs({ status })}`,
    status.expiresAtIso === undefined
      ? "its auth cookies carry no expiry, so GitHub ends the session on its own schedule — it works until it does not"
      : `its auth cookies expire ${status.expiresAtIso}${status.sessionScoped ? ", and one is session-scoped, so it may lapse sooner" : ""}`,
  ];
}

/**
 * The one line every offline `status` owes the reader about what it did NOT check.
 *
 * `status` used to end on "parsing is not liveness", which is true and still leaves the reader with a green
 * exit code and no idea that a second, invisible authorisation decides whether any upload works. Naming the
 * flag that settles it turns a caveat into an action.
 */
const ORG_GRANT_CAVEAT =
  "reading the jar is not liveness, and it says NOTHING about a SAML org grant — pass --org <slug> to ask GitHub";

/**
 * Everything `attach status` prints with no organisation to probe: the offline half, then — when the session
 * is usable — the caveat naming the org grant it did not check.
 *
 * @param status what the browser currently holds
 * @returns the lines to print, in order
 */
export function statusOnlyLines({ status }: { status: GithubSessionStatus }): readonly string[] {
  const lines = offlineStatusLines({ status });
  if (!status.present || !status.usable) {
    return lines;
  }
  return [...lines, ORG_GRANT_CAVEAT];
}

/**
 * The one line `attach status --org` refuses with when GitHub did not confirm the session's SAML grant.
 *
 * @param org the organisation the probe asked about
 * @param verdict what GitHub answered, short of a grant
 * @returns the refusal naming what is wrong and the step that fixes it
 */
export function orgGrantRefusal({
  org,
  verdict,
}: {
  org: string;
  verdict: Exclude<OrgGrantVerdict, "granted">;
}): string {
  return verdict === "signed-out"
    ? `GitHub answered ${org} as an anonymous visitor — your browser's github.com cookies are dead`
    : `your browser is signed in but NOT SAML-authorised for ${org}, so every upload there is refused; press its ` +
        `single sign-on prompt with \`slopweaver browser sign-in --provider github --org ${org}\`, or in your Chrome if that look finds it yours`;
}

/**
 * The external-write door request for one attachment upload.
 *
 * `credential: "web-session"` sits in the artifact bag rather than being expressed as a new door concept,
 * and that is the deliberate answer to "how does a browser-session write fit a token-shaped door". It does
 * not need to fit: the door polices what an action does to the WORLD — `effect: "external-write"` — and
 * has never modelled how a caller authenticated. Teaching it about credential kinds would add a dimension
 * no gate reads, to distinguish two actions the door must treat identically.
 *
 * What the artifact bag does NOT do is reach the ledger. `admit/ledger.ts` records the action label, the
 * effect, the status and the findings, and deliberately nothing else — "audit without dumping the
 * artifact", with only an opaque `duplicateKey` hash allowed through. So the credential kind is here for a
 * GATE to read, not for an auditor: the ledger line for this verb reads `verb:github.attach`, and that is
 * the whole record. Stating it plainly because the opposite is the natural assumption, and this comment
 * asserted it before the test that reads a real ledger back proved otherwise.
 *
 * `createsWorkItem` is false: an uploaded asset is inert until somebody embeds it, so it puts nothing on
 * anyone's queue. The `pr update` that embeds the URL is the call that does, and it declares that itself.
 *
 * @param args the parsed upload inputs
 * @param home the Slopweaver state home whose door records the write
 * @param byteLength the exact number of bytes the upload will send
 * @param contentType the content type the upload declares
 * @returns the exact external-write request admitted by the door
 */
export function attachDoorRequest({
  args,
  home,
  byteLength,
  contentType,
}: {
  args: GithubAttachUploadArgs;
  home: string;
  byteLength: number;
  contentType: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "attach" },
    artifact: {
      byteLength,
      contentType,
      credential: "web-session",
      id: `${args.owner}/${args.repo}#${String(args.number)}`,
      path: args.file,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
