/**
 * Pure parser, usage and reports for `slopweaver browser` — the verb that names which of the owner's own
 * Chrome profiles every browser leg reads.
 *
 * It exists because this repository may not name one. The rule
 * (`docs/browser-route.md`): the owner's real work Chrome is the only browser anything here uses, and which of their
 * profiles that is — along with the account behind it — is a private identifier, so it is recorded on the
 * machine and never committed (`docs/browser-route/brief-profile-and-walks.md`). Nothing guesses: a guess that landed on a personal profile would drive the owner's
 * own browsing as if it were work.
 *
 * The same verb owns the PIN, because the pin is the recorded choice made mechanical: a browser leg launches
 * Chrome through a shim carrying `--profile-directory`, so the profile named here is the profile it lands
 * in — rather than whichever one Chrome was last used in. `src/browser/profilePin.ts` measures why.
 *
 * No fs and no keychain here; `profileRun.ts` does every read.
 */
import type { ChromeProfile } from "../../../browser/profileIndex.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type BrowserVerbError, BrowserVerbErrors } from "./errors.js";

/** The sub-verbs `slopweaver browser` accepts. */
const BROWSER_SUBVERBS = [
  "profile",
  "cookies",
  "pin",
  "shot",
  "image-record",
  "annotate",
  "terminal-shot",
  "console-shot",
  "redact",
  "verdicts",
  "break-glass",
  "open",
  "inspect",
  "present",
  "sign-in",
  "read",
  "aim",
  "act",
  "scroll",
  "close",
  "sessions",
] as const;

/** Whichever sub-verb was named. */
export type BrowserSubverb = (typeof BROWSER_SUBVERBS)[number];

/**
 * Every flag this verb accepts. Exported so the help-truth ratchet checks against the real list.
 * @internal
 */
export const BROWSER_FLAGS: FlagSpec = {
  boolean: ["list", "json", "blocked", "raw", "focus", "no-focus", "full-page", "up"],
  string: [
    "set",
    "origin",
    "home",
    "url",
    "out",
    "settle",
    "reason",
    "limit",
    "form",
    "target",
    "readiness-timeout",
    "caption",
    "session",
    "do",
    "value",
    "observation",
    "download-dir",
    "expect-name",
    "expect-focus",
    "page",
    "pages",
    "destination",
    "provider",
    "org",
    "under",
    "find",
    "walk",
  ],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const BROWSER_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: BROWSER_FLAGS }),
  ...booleanFlagsOf({ spec: BROWSER_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. */
export interface BrowserOptions {
  readonly subverb: BrowserSubverb;
  /**
   * `image-record`, `annotate`, `terminal-shot` and `redact` only: the form file — for `image-record` the image and
   * what was seen in it, for `annotate` the source, the out path and the boxes to draw, for `terminal-shot` the text
   * file and the lines to keep, for `redact` the captured PNG and the rectangles to burn.
   */
  readonly form: string | undefined;
  readonly list: boolean;
  readonly set: string | undefined;
  readonly origin: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
  /** `shot` only: the page to photograph. */
  readonly url: string | undefined;
  /** `present` only: a page named rather than addressed — validated in `src/browser/present.ts`. */
  readonly destination: string | undefined;
  /** `shot` and `console-shot` only: where the picture is written. */
  readonly out: string | undefined;
  /** `console-shot` only: the registered click-through to photograph, validated in `./consoleShotRun.ts`. */
  readonly walk: string | undefined;
  /** `shot --raw` only: how long to sleep after load, as typed — validated in `shotCore.ts`. */
  readonly settle: string | undefined;
  /** `shot` only: the diagnostic whole-page profile. */
  readonly raw: boolean;
  /**
   * `shot`'s closed target or `act`'s element, as typed — one flag, validated by whichever sub-verb reads it
   * (`shotCore.ts` or `./actionCore.ts`). They share it because no invocation is ever both.
   */
  readonly target: string | undefined;
  /** `shot` only: the readiness wait, as typed — validated in `shotCore.ts`. */
  readonly readinessTimeout: string | undefined;
  /** `shot` only: a first caption line. */
  readonly caption: string | undefined;
  /** `verdicts` only: how many of the most recent rows to print; `undefined` takes the report's default. */
  readonly limit: number | undefined;
  /** `verdicts` only: keep refusals and waived refusals, drop the plain allows. */
  readonly blocked: boolean;
  /** `break-glass` only: why the door could not be used instead. */
  readonly reason: string | undefined;
  /** `read`/`act`/`close` only: the interaction session to drive. */
  readonly session: string | undefined;
  /** `act` only: which interaction to perform, as typed — validated in `./actionCore.ts`. */
  readonly doKind: string | undefined;
  /** `act` only: the text, option, key, URL or file the interaction carries. */
  readonly value: string | undefined;
  /** `act` only: the `read` this action was decided against. */
  readonly observation: string | undefined;
  /** `act --do download` only: the directory the browser puts downloads in. */
  readonly downloadDir: string | undefined;
  /** `act --do download` only: the filename to expect. */
  readonly expectName: string | undefined;
  /** `act --do type|press` only: the element the caller says holds the cursor. */
  readonly expectFocus: string | undefined;
  /**
   * `break-glass`'s ONE page a waiver covers on the read-only rail, or `present`'s local page slug, opened through
   * the console — validated in `src/browser/present.ts`. They share it because no invocation is ever both.
   */
  readonly page: string | undefined;
  /**
   * `aim` only: ALSO put the page's own focus on the target.
   *
   * Opt-in HERE and default-on for `act`, and the asymmetry is the point rather than an oversight.
   * `browser aim` is undoored on the stated grounds that it
   * performs no write, and a focus fires the page's own focus and blur handlers — so defaulting it here
   * would make a standing claim false rather than merely widen a mark.
   */
  readonly focus: boolean;
  /** `act` only: mark with the highlight ALONE. Focus is the default on an act. */
  readonly noFocus: boolean;
  /** `aim`/`act` only: photograph the whole scrollable page beside the viewport pictures. */
  readonly fullPage: boolean;
  /** `scroll` only: how many screens to move, as typed — validated in `./actionCore.ts`. */
  readonly pages: string | undefined;
  /** `scroll` only: walk up the page rather than down. */
  readonly up: boolean;
  /** `sign-in` only: the provider to look at, as typed — validated in `./signInRun.ts`. */
  readonly provider: string | undefined;
  /** `sign-in --provider github` only: the organisation whose SSO grant is read; defaults to the repository owner. */
  readonly org: string | undefined;
  /** `read` only: the ref whose subtree to print from the session's latest look, taking no new one. */
  readonly under: string | undefined;
  /** `read` only: the text to search the session's latest look for, taking no new one. */
  readonly find: string | undefined;
}

/** The sub-verbs that read a `--form`, each with the refusal naming its own form's shape. */
const FORM_MISSING: Partial<Record<BrowserSubverb, () => BrowserVerbError>> = {
  annotate: BrowserVerbErrors.annotateFormMissing,
  "image-record": BrowserVerbErrors.formMissing,
  redact: BrowserVerbErrors.redactFormMissing,
  "terminal-shot": BrowserVerbErrors.terminalShotFormMissing,
};

/**
 * The one flag a sub-verb cannot run without, when it is missing.
 *
 * Five sub-verbs have such a flag (`cookies`' `--origin`, and the `--form` of {@link FORM_MISSING}'s four) and the
 * rest have none. It is a function rather than blocks inside the parser so that the parser reads as parse, check,
 * build. Each message names the flag AND an example of it, because a caller who forgot one wants the shape
 * rather than the rule.
 *
 * @param subverb which sub-verb was named
 * @param origin `--origin`, which `cookies` cannot run without
 * @param form `--form`, which `image-record`, `annotate`, `terminal-shot` and `redact` cannot run without
 * @param rawLimit `--limit` exactly as typed, so a non-number can be quoted back
 * @returns the problem to report, or `null` when nothing required is missing
 */
function requiredFlagProblem({
  subverb,
  origin,
  form,
  rawLimit,
}: {
  subverb: BrowserSubverb;
  origin: string | undefined;
  form: string | undefined;
  rawLimit: string | undefined;
}): BrowserVerbError | null {
  if (subverb === "cookies" && origin === undefined) {
    return BrowserVerbErrors.originMissing();
  }
  const formMissing = FORM_MISSING[subverb];
  if (formMissing !== undefined && form === undefined) {
    return formMissing();
  }
  const positiveLimit = Number.isInteger(Number(rawLimit)) && Number(rawLimit) >= 1;
  if (rawLimit !== undefined && !positiveLimit) {
    return BrowserVerbErrors.limitNotPositive({ got: rawLimit });
  }
  return null;
}

/**
 * The flags `browser` was given and the sub-verb it names, or the first problem with either.
 *
 * @param rest the argv tail after `slopweaver browser`
 * @returns the sub-verb and the parsed flag values
 */
function subverbAndFlags({
  rest,
}: {
  rest: readonly string[];
}): Result<{ readonly subverb: BrowserSubverb; readonly values: ParsedFlags["values"] }, BrowserVerbError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: BROWSER_FLAGS });
  if (parsed.isErr()) {
    return err(BrowserVerbErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const subverb = positionals[0];
  if (!isBrowserSubverb(subverb)) {
    return err(BrowserVerbErrors.subverbMissing({ choices: BROWSER_SUBVERBS, got: subverb }));
  }
  return ok({ subverb, values });
}

/**
 * Parse `browser <sub-verb> [...]`.
 *
 * @param rest the argv tail after `slopweaver browser`
 * @returns the resolved options, or the first usage problem found
 */
export function parseBrowserArgs({ rest }: { rest: readonly string[] }): Result<BrowserOptions, BrowserVerbError> {
  const head = subverbAndFlags({ rest });
  if (head.isErr()) {
    return err(head.error);
  }
  const { subverb, values } = head.value;
  const text = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" && values[name] !== "" ? values[name] : undefined;
  const origin = text({ name: "origin" });
  const form = text({ name: "form" });
  const rawLimit = text({ name: "limit" });
  const problem = requiredFlagProblem({ form, origin, rawLimit, subverb });
  if (problem !== null) {
    return err(problem);
  }
  return ok({
    blocked: values["blocked"] === true,
    caption: text({ name: "caption" }),
    destination: text({ name: "destination" }),
    doKind: text({ name: "do" }),
    downloadDir: text({ name: "download-dir" }),
    expectFocus: text({ name: "expect-focus" }),
    expectName: text({ name: "expect-name" }),
    find: text({ name: "find" }),
    // Two flags, each default right for what its verb CLAIMS: focus is on for `act` unless
    // --no-focus; `aim` keeps --focus opt-in, being undoored as performing no write, which a focus (firing the
    // page's focus and blur handlers) would make false.
    focus: values["focus"] === true,
    noFocus: values["no-focus"] === true,
    form,
    fullPage: values["full-page"] === true,
    home: text({ name: "home" }),
    json: values["json"] === true,
    limit: rawLimit === undefined ? undefined : Number(rawLimit),
    list: values["list"] === true,
    observation: text({ name: "observation" }),
    org: text({ name: "org" }),
    origin,
    out: text({ name: "out" }),
    page: text({ name: "page" }),
    pages: text({ name: "pages" }),
    provider: text({ name: "provider" }),
    raw: values["raw"] === true,
    readinessTimeout: text({ name: "readiness-timeout" }),
    reason: text({ name: "reason" }),
    session: text({ name: "session" }),
    set: text({ name: "set" }),
    settle: text({ name: "settle" }),
    subverb,
    target: text({ name: "target" }),
    under: text({ name: "under" }),
    up: values["up"] === true,
    url: text({ name: "url" }),
    value: text({ name: "value" }),
    walk: text({ name: "walk" }),
  });
}

/**
 * Whether a positional names one of this verb's sub-verbs.
 *
 * Read off {@link BROWSER_SUBVERBS} rather than written out, so a sixth one is one entry rather than two.
 *
 * Positional because TypeScript error TS1230 forbids destructuring in a type predicate — the compiler's
 * decision, per `.claude/rules/typescript-patterns.md`.
 *
 * @returns whether it is a sub-verb
 */
function isBrowserSubverb(value: string | undefined): value is BrowserSubverb {
  return BROWSER_SUBVERBS.some((verb) => verb === value);
}

/**
 * Render Chrome's own profile index.
 *
 * The account email is printed because it is the only thing that tells the two apart for a reader — Chrome's
 * display names are frequently identical across profiles, and the directory name says nothing at all.
 *
 * @param profiles what Chrome's index carries
 * @param recorded the directory currently recorded, when there is one
 * @returns the lines to print
 */
export function renderProfileList({
  profiles,
  recorded,
}: {
  profiles: readonly ChromeProfile[];
  recorded: string | undefined;
}): readonly string[] {
  return profiles.map((profile) => {
    const mark = profile.directory === recorded ? " <- recorded" : "";
    const account = profile.accountEmail;
    if (account === undefined) {
      return `  ${profile.directory}  ${profile.name}  (no account)${mark}`;
    }
    return `  ${profile.directory}  ${profile.name}  ${account}${mark}`;
  });
}

/**
 * What `browser profile --set` prints once the choice is written: the directory, the account it is signed
 * in as, and the store revision that now holds it. A profile with no signed-in account says so — `no account`
 * in prose, `account: null` in JSON — because that is the profile a reader most needs to notice they picked.
 *
 * @param profile the profile Chrome's index listed under the directory that was recorded
 * @param revision the store row's revision after the write
 * @param json whether machine-readable output was asked for
 * @returns the one line, or JSON document, to print
 */
export function recordedProfileLine({
  profile,
  revision,
  json,
}: {
  profile: ChromeProfile;
  revision: number;
  json: boolean;
}): string {
  const account = profile.accountEmail;
  const where = `in the store (revision ${String(revision)})`;
  if (account === undefined) {
    return json
      ? JSON.stringify({ account: null, profileDirectory: profile.directory, revision }, null, 2)
      : `recorded ${profile.directory} (no account) ${where}`;
  }
  return json
    ? JSON.stringify({ account, profileDirectory: profile.directory, revision }, null, 2)
    : `recorded ${profile.directory} (${account}) ${where}`;
}
