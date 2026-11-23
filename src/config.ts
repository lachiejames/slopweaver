/**
 * Runtime configuration resolved from the environment — home directory, target repository, GitHub
 * token. All three follow the zero-config, own-your-data promise: sensible defaults, no file to edit.
 *
 * The GitHub token chain follows the credentials register: an explicit `GITHUB_TOKEN`/`GH_TOKEN` wins, then
 * the state home's stored `github-token`, then the user's existing `gh` CLI login — so most users need no
 * token at all, and a verb given `--home` authenticates as that home's credential. Secrets are read from the
 * state home's `secrets/` directory; nothing here writes one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { stripGitEnv } from "./codex/gitRun.js";
import { slopweaverHome } from "./homeDir.js";
import { isContained } from "./lib/pathContainment.js";
import { err, ok, type Result } from "./lib/result.js";
import { mainCheckoutsFromProfile } from "./profileStore.js";
import { secretFilePath } from "./stateHome.js";

// Re-exported unchanged (moved to `./homeDir.js` to break an import cycle with `stateHome.ts` — see that
// module's own doc comment) so every existing `import { slopweaverHome } from "./config.js"` still works.
export { slopweaverHome } from "./homeDir.js";

/** A GitHub repository coordinate. */
export interface Repository {
  readonly owner: string;
  readonly repo: string;
}

/**
 * Whether to ALSO stream the machine-readable `slopweaver.progress` JSON lane (default OFF). A human
 * watching a crawl wants clean heartbeat/preview lines, not JSON interleaved with them — so the JSON lane
 * is opt-in via `SLOPWEAVER_PROGRESS_JSON` for a programmatic consumer that wants to parse progress.
 *
 * @returns true when the JSON progress lane should be emitted
 */
export function progressJsonEnabled(): boolean {
  return Boolean(process.env["SLOPWEAVER_PROGRESS_JSON"]);
}

/** A remote URL matched as SSH (host alias and `ssh://` included), else as HTTPS, or `null` when it is neither. */
function remoteMatch({ url }: { url: string }): RegExpExecArray | null {
  const ssh = /^(?:ssh:\/\/)?git@[^:/]+[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (ssh !== null) {
    return ssh;
  }
  return /^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
}

/**
 * Parse an `owner/repo` out of a git remote URL. Tolerant of HTTPS, SSH, `ssh://`, and SSH **host
 * aliases** (e.g. `git@github-personal:owner/repo.git`) so a repo cloned through a per-account alias
 * still resolves.
 *
 * @param remoteUrl the raw `git remote get-url` output
 * @returns the parsed repository, or an error when it can't be shaped
 */
export function repositoryFromGitRemote({ remoteUrl }: { remoteUrl: string }): Result<Repository> {
  const match = remoteMatch({ url: remoteUrl.trim() });
  if (match?.[1] == null || match[2] == null) {
    return err([`could not parse owner/repo from git remote: ${remoteUrl}`]);
  }
  return ok({ owner: match[1], repo: match[2] });
}

/**
 * Parse an explicit `owner/repo` string (the `--repo` flag).
 *
 * @param slug the `owner/repo` argument
 * @returns the parsed repository, or an error when malformed
 */
export function parseRepositorySlug({ slug }: { slug: string }): Result<Repository> {
  const parts = slug.trim().split("/");
  if (parts.length !== 2 || parts[0] == null || parts[1] == null || parts[0].length === 0 || parts[1].length === 0) {
    return err([`expected owner/repo, got: ${slug}`]);
  }
  return ok({ owner: parts[0], repo: parts[1] });
}

/**
 * How long one `git remote get-url` may take before it reads as no origin. MEASURED at 60-70ms
 * (`/usr/bin/time -p git -C ~/dev/acme-admin remote get-url origin`), so 3s is forty times that; the bound exists
 * because `handover list --json` asks it of every board path inside the console's 90s deadline, and a checkout
 * whose `.git/config` is a FIFO blocks git forever.
 */
const ORIGIN_READ_TIMEOUT_MS = 3_000;

/**
 * The `origin` repository of one checkout, read from git with no judgement about whether it should be a
 * verb's subject — {@link cwdRepositoryRefusal} is that judgement.
 *
 * Strips every `GIT_*` environment variable before shelling out — see `./codex/gitRun.ts`'s `stripGitEnv`
 * for the incident this guards against: git exports `GIT_DIR`/`GIT_WORK_TREE` into a hook's own process
 * tree, and those override `-C`/`cwd` outright, so an unstripped call reads whichever repo the OUTER git
 * operation (a `pre-push` hook, say) is running against instead of `cwd`.
 */
function originRepository({ cwd }: { cwd: string }): Result<Repository> {
  let remoteUrl: string;
  try {
    remoteUrl = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "pipe", "ignore"],
      // SIGKILL, not the default SIGTERM: a child that traps TERM would outlive the bound.
      killSignal: "SIGKILL",
      timeout: ORIGIN_READ_TIMEOUT_MS,
    }).trim();
  } catch {
    return err(["no `origin` git remote found — pass --repo owner/repo, or run inside a git checkout"]);
  }
  return repositoryFromGitRemote({ remoteUrl });
}

/**
 * The `origin` repository of one checkout, exported for the one caller that has to ask which repository a
 * PATH is rather than which repository a verb's subject should be.
 *
 * `vulnerability-fix topup` knows a slug and needs the local checkout to open a worktree in, which is the opposite
 * direction from every other caller here. It is a thin re-export rather than a second reader so both
 * directions keep the same `GIT_*`-stripping and the same refusal.
 *
 * @param cwd the checkout to read
 * @returns its `origin` repository, or why it could not be read
 */
export function originRepositoryOf({ cwd }: { cwd: string }): Result<Repository> {
  return originRepository({ cwd });
}

/** A path through its symlinks, or merely absolute when it does not exist. */
function canonicalPath({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The `owner/repo` spelling of a repository. */
function repositorySlug({ repository }: { repository: Repository }): string {
  return `${repository.owner}/${repository.repo}`;
}

/**
 * Why a repository read from `cwd`'s `origin` must NOT become a verb's subject, or `undefined` when it may.
 * Pure — a comparison over already-canonical paths and already-resolved repositories.
 *
 * Two refusals, both from the same measured incident (`cwd-resolved-repo-turns-a-watcher-into-a-liar`):
 * the state home is itself a git checkout of a private state repository with no open pull requests, so a
 * watcher script running in a cwd nobody chose read `totalCount 0` from it on every cycle for three days and
 * recorded the zero as a search-index transient. The verb printed the repository it had resolved in every one
 * of those responses and nobody read it, so more printing is not the fix — refusing is.
 *
 * - **Under the state home.** Nothing under `$SLOPWEAVER_HOME` is ever the checkout a verb means, whatever
 *   git says its `origin` is.
 * - **Not a declared main checkout's repository.** When `profile.json` declares main checkouts, their
 *   `origin` slugs are the only repositories a cwd may stand for; anything else is a cwd nobody chose. An
 *   install that declares nothing has nothing to compare against and is allowed through — a fresh onboard
 *   resolves its first repository this way, before any profile exists.
 *
 * @param cwd the canonical working directory the repository was read from
 * @param home the canonical state home
 * @param repository what `cwd`'s `origin` resolved to
 * @param declared the repositories the declared main checkouts resolve to
 * @returns the refusal, naming what was resolved and the two remedies, or undefined when the repository stands
 */
export function cwdRepositoryRefusal({
  cwd,
  home,
  repository,
  declared,
}: {
  cwd: string;
  home: string;
  repository: Repository;
  declared: readonly Repository[];
}): string | undefined {
  const slug = repositorySlug({ repository });
  const remedy = "pass --repo owner/repo, or run from the checkout you mean";
  if (isContained({ candidate: cwd, root: home })) {
    return (
      `refusing ${slug}, resolved from cwd ${cwd}: that is under the Slopweaver state home ${home}, ` +
      `whose own \`origin\` is never a verb's subject — ${remedy}`
    );
  }
  const sameRepository = (candidate: Repository): boolean =>
    candidate.owner.toLowerCase() === repository.owner.toLowerCase() &&
    candidate.repo.toLowerCase() === repository.repo.toLowerCase();
  if (declared.length > 0 && !declared.some(sameRepository)) {
    const names = declared.map((candidate) => repositorySlug({ repository: candidate })).join(", ");
    return (
      `refusing ${slug}, resolved from cwd ${cwd}: it is not a declared main checkout's repository ` +
      `(${names}) — ${remedy}`
    );
  }
  return undefined;
}

/**
 * Resolve the target repo from `origin`'s git remote in `cwd`, then refuse it when `cwd` is somewhere a
 * verb's subject can never be — see {@link cwdRepositoryRefusal} for the two refusals and the incident.
 *
 * @param cwd the checkout to read the remote from (defaults to the process cwd)
 * @param home the state home whose `profile.json` declares the main checkouts a cwd may stand for
 *   (defaults to the ambient one; a verb given `--home` passes it so the judgement reads the same profile
 *   the verb does)
 * @returns the repository, or an error when there's no usable `origin` remote or the cwd is refused
 */
export function resolveRepository({
  cwd = process.cwd(),
  home = slopweaverHome(),
}: {
  cwd?: string;
  home?: string;
} = {}): Result<Repository> {
  const repository = originRepository({ cwd });
  if (repository.isErr()) {
    return repository;
  }
  const canonicalCwd = canonicalPath({ path: cwd });
  const checkouts = mainCheckoutsFromProfile({ home });
  // A cwd standing inside a declared checkout is that checkout's own repository by construction, so its
  // origin is the declared one without a second git read per declared path — the session-start leg resolves
  // every declared checkout this way, and paid N git reads per checkout before this short-circuit existed.
  const standingInDeclared = checkouts.some((checkout) =>
    isContained({ candidate: canonicalCwd, root: canonicalPath({ path: checkout.path }) }),
  );
  const declared = standingInDeclared
    ? [repository.value]
    : checkouts.flatMap((checkout) => {
        const resolved = declaredOrigin({ path: checkout.path });
        return resolved.isOk() ? [resolved.value] : [];
      });
  const refusal = cwdRepositoryRefusal({
    cwd: canonicalCwd,
    declared,
    home: canonicalPath({ path: home }),
    repository: repository.value,
  });
  return refusal === undefined ? repository : err([refusal]);
}

/**
 * A declared checkout's `origin`, memoised per path for the life of the process: a declared path's remote
 * does not change under a running verb, and a verb that resolves several repositories (the session-start
 * leg, a hook that runs once per command segment) would otherwise re-read every declared remote per call.
 */
const declaredOrigins = new Map<string, Result<Repository>>();

/** The memoised `origin` of one declared checkout path. */
function declaredOrigin({ path }: { path: string }): Result<Repository> {
  const known = declaredOrigins.get(path);
  if (known !== undefined) {
    return known;
  }
  const resolved = originRepository({ cwd: path });
  declaredOrigins.set(path, resolved);
  return resolved;
}

/**
 * How long `gh auth token` may take before it reads as no gh login. MEASURED at 0.18s
 * (`/usr/bin/time -p gh auth token > /dev/null`). What it can wait on is the macOS keychain, where gh keeps the
 * token: a keychain dialog behind another window blocks it forever, and every GitHub verb resolves its token
 * here. Two minutes, the bound `src/browser/cookieJar.ts` puts on its own keychain read, because a dialog the
 * owner DOES see and answers is a legitimate run: ten seconds (`GH_AUTH_TIMEOUT_MS`, the environment snapshot's
 * bound) would kill a read that worked on main. Past it the read answers no token exactly as an
 * absent gh login does, instead of the whole verb hanging on a window nobody sees. It is the LAST tier, so a
 * stored `github-token` never waits on the keychain at all.
 */
const GH_TOKEN_READ_TIMEOUT_MS = 2 * 60_000;

/** `gh auth token`, or undefined if the gh CLI is absent / not logged in / did not answer in time. */
function tokenFromGhCli(): string | undefined {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // SIGKILL, as the origin read above: a child that traps TERM would outlive the bound.
      killSignal: "SIGKILL",
      timeout: GH_TOKEN_READ_TIMEOUT_MS,
    }).trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The GitHub token, in the credentials register's order (`src/secrets/credentials/connectors.ts`): an
 * explicit `GITHUB_TOKEN`/`GH_TOKEN` wins, then the state home's `secrets/github-token`, then the `gh` CLI
 * login as the zero-capture fallback. Undefined means "unauthenticated" — fine for public repos (lower rate
 * limits); the refresh verb hints `gh auth login` when a private fetch 404/403s.
 *
 * The stored file sits ABOVE the gh login so that `home` chooses the credential. A verb given `--home`
 * resolves its token from the SAME state home it reads and writes its ledgers in; were gh read first, any
 * machine with a gh login would PATCH as that account under `--home B` and record the write under B — or refuse
 * a pull request it should have accepted, because the authorship check compared the wrong account. Omitting
 * `home` reads the ambient home.
 *
 * @param home the state home whose stored `github-token` to read, defaulting to the ambient one
 * @param env the environment to resolve `GITHUB_TOKEN`/`GH_TOKEN` from — a test asserting "unauthenticated"
 *   injects `{}` here instead of relying on the ambient shell (defaults to `process.env`)
 * @param readGhToken the last-tier `gh auth token` reader, injectable so a test proves the order without
 *   shelling the real `gh` (defaults to the bounded subprocess read)
 * @returns the token, or undefined when unauthenticated
 */
export function githubToken({
  home,
  env,
  readGhToken = tokenFromGhCli,
}: {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
  readGhToken?: () => string | undefined;
} = {}): string | undefined {
  const fromEnv = tokenFromEnv({ envNames: ["GITHUB_TOKEN", "GH_TOKEN"], ...(env !== undefined ? { env } : {}) });
  if (fromEnv != null) {
    return fromEnv;
  }
  const fromFile = tokenFromHomeFile({ secretName: "github-token", ...(home === undefined ? {} : { home }) });
  if (fromFile != null) {
    return fromFile;
  }
  return readGhToken();
}

/** Read a secret file under `$SLOPWEAVER_HOME/secrets` directly (no env names), trimmed; undefined if absent/blank. */
function tokenFromHomeFile({ secretName, home }: { secretName: string; home?: string }): string | undefined {
  return tokenFromEnvOrHomeFile({ envNames: [], secretName, ...(home === undefined ? {} : { home }) });
}

/**
 * Resolve a source token: the first non-empty env var in `envNames`, else the contents of a local
 * secret file under `$SLOPWEAVER_HOME`. The file path lets a user keep an own-your-data token off the
 * environment; it is never scaffolded, printed, synced, or committed. Contents are trimmed; a blank
 * value is treated as absent. Never logs the token.
 *
 * @param envNames the environment variable names to try, in precedence order
 * @param secretName the secret filename under `$SLOPWEAVER_HOME/secrets` (e.g. `slack-user-token`)
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param env the environment to read `envNames` from — a test that wants "no token in the environment"
 *   injects `{}` here rather than relying on the ambient shell (defaults to `process.env`)
 * @returns the resolved token, or undefined when neither env nor file yields one
 */
export function tokenFromEnvOrHomeFile({
  envNames,
  secretName,
  home = slopweaverHome(),
  env = process.env,
}: {
  envNames: readonly string[];
  secretName: string;
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  const fromEnv = tokenFromEnv({ envNames, env });
  if (fromEnv != null) {
    return fromEnv;
  }
  try {
    const fromFile = readFileSync(secretFilePath({ home, name: secretName }), "utf8").trim();
    return fromFile.length > 0 ? fromFile : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Scan `envNames` in precedence order for the first non-empty value, trimmed. The env-only half of
 * {@link tokenFromEnvOrHomeFile}'s lookup, pulled out so {@link githubToken} — which puts a `gh auth token`
 * tier after its stored file, a shape the shared env-then-file lookup has no slot for — can take the same
 * injectable `env` without forcing a `secretName` on a lookup that has none.
 *
 * @param envNames the environment variable names to try, in precedence order
 * @param env the environment to read `envNames` from (defaults to `process.env`)
 * @returns the first non-empty, trimmed value, or undefined when none of `envNames` is set
 */
function tokenFromEnv({
  envNames,
  env = process.env,
}: {
  envNames: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  for (const name of envNames) {
    const fromEnv = env[name];
    if (fromEnv != null && fromEnv.trim().length > 0) {
      return fromEnv.trim();
    }
  }
  return undefined;
}

/**
 * The Slack USER token (`xoxp-`): `SLACK_USER_TOKEN`, else `$SLOPWEAVER_HOME/secrets/slack-user-token`.
 * A user token can list + read history of every public channel the user can access (even un-joined) plus
 * their private channels — the breadth the "read all my tools" ingest needs. It is ALSO the token that
 * posts as the owner (`slopweaver slack post --as me`).
 *
 * `home` is a parameter for the same reason {@link slackBotToken}'s is, and it was added for the same
 * defect: a zero-arg resolver silently reads the DEFAULT home's secret, so an `--as me` send under
 * `--home /elsewhere` would take its token from one home and write its ledger and reservations to
 * another. Two homes, one send — the kind of mismatch a green unit suite never notices.
 *
 * @param home the Slopweaver home to read the secret file under (defaults to {@link slopweaverHome})
 * @param env the environment to resolve `SLACK_USER_TOKEN` from, per {@link tokenFromEnvOrHomeFile}
 * @returns the token, or undefined when unconfigured
 */
export function slackUserToken({
  home,
  env,
}: {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
} = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["SLACK_USER_TOKEN"],
    secretName: "slack-user-token",
    ...(home !== undefined ? { home } : {}),
    ...(env !== undefined ? { env } : {}),
  });
}

/**
 * The Slack BOT token (`xoxb-`): `SLACK_BOT_TOKEN`, else `$SLOPWEAVER_HOME/secrets/slack-bot-token`. A bot
 * token only reads channels the bot was invited to; it's the read-fallback and the token that POSTS
 * (`slopweaver slack post --as bot`).
 *
 * **Every caller must come through here.** A write path that read `process.env` directly would ignore the
 * secrets store, so a user who ran `slopweaver secrets set slack-bot-token` successfully would still be told
 * to export an env var — which is exactly the defect this signature exists to prevent.
 *
 * @param home the Slopweaver home to read the secret file under (defaults to {@link slopweaverHome}) — a
 *   `--home` invocation must resolve its token from the SAME home as its ledger and reservations
 * @param env the environment to resolve `SLACK_BOT_TOKEN` from, per {@link tokenFromEnvOrHomeFile} — a test
 *   asserting "no bot token configured" injects `{}` here instead of relying on the ambient shell
 * @returns the token, or undefined when unconfigured
 */
export function slackBotToken({
  home,
  env,
}: {
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
} = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["SLACK_BOT_TOKEN"],
    secretName: "slack-bot-token",
    ...(home !== undefined ? { home } : {}),
    ...(env !== undefined ? { env } : {}),
  });
}

/**
 * The Slack APP-LEVEL token (`xapp-`): `SLACK_APP_TOKEN`, else `$SLOPWEAVER_HOME/secrets/slack-app-token`.
 *
 * A third Slack credential, and it authenticates the APP rather than an identity in the workspace: it is the
 * only token `apps.connections.open` accepts, and therefore the only way `slopweaver listen` can receive a
 * tag at all. Neither the bot nor the user token can stand in for it, which is why it is resolved by its own
 * function with its own env name instead of being folded into either.
 *
 * `home` is a parameter for the same reason {@link slackBotToken}'s is: a `--home` invocation must resolve
 * every credential from the SAME home as the ledger its effects are recorded in.
 *
 * @param home the Slopweaver home to read the secret file under (defaults to {@link slopweaverHome})
 * @returns the token, or undefined when unconfigured
 */
export function slackAppToken({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["SLACK_APP_TOKEN"],
    secretName: "slack-app-token",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The Linear token: `LINEAR_API_KEY`/`LINEAR_TOKEN`, else `$SLOPWEAVER_HOME/secrets/linear-token`.
 *
 * `home` is a parameter for the same reason {@link slackBotToken}'s is, and it became load-bearing when the
 * write lane arrived: a `--home` invocation resolves its ownership ledger and its door record from the home
 * it was given, so a token resolver that always used the DEFAULT home would pair one home's credential with
 * another home's records. That is not a cosmetic mismatch — the ledger is the only proof of what slopweaver
 * created, so writing with the wrong key against the right ledger corrupts the ownership evidence itself.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the token, or undefined when unconfigured
 */
export function linearToken({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["LINEAR_API_KEY", "LINEAR_TOKEN"],
    secretName: "linear-token",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The Notion token: `NOTION_TOKEN`/`NOTION_API_KEY`, else `$SLOPWEAVER_HOME/secrets/notion-token`.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the token, or undefined when unconfigured
 */
export function notionToken({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["NOTION_TOKEN", "NOTION_API_KEY"],
    secretName: "notion-token",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The Fathom API key: `FATHOM_API_KEY`, else `$SLOPWEAVER_HOME/secrets/fathom-api-key`.
 *
 * `home` is a parameter for the same reason {@link linearToken}'s is — a `--home` invocation must pair one
 * home's credential with that home's bronze store, never with the default home's.
 *
 * There is no browser fallback and deliberately no way to obtain this without the owner: the key is minted
 * by hand in Fathom's settings, and the owner's Chrome holds no `fathom.video` session for a cookie lane to read
 * (measured: 2,489 cookies in the profile, zero for that host). Reproduce:
 * `slopweaver browser profile --list` names the profile, and every `fathom.video` URL answers a redirect to
 * `/users/sign_in` for an anonymous reader.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the key, or undefined when unconfigured
 */
export function fathomApiKey({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["FATHOM_API_KEY"],
    secretName: "fathom-api-key",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The Cloudflare API token: `CLOUDFLARE_API_TOKEN`/`CF_API_TOKEN`, else
 * `$SLOPWEAVER_HOME/secrets/cloudflare-token`. A single Bearer token (Cloudflare's own REST API shape),
 * unlike Vanta's OAuth client-credentials pair — one credential covers every scoped permission the token
 * was minted with.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the token, or undefined when unconfigured
 */
export function cloudflareToken({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"],
    secretName: "cloudflare-token",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The 1Password Events API bearer token: `ONEPASSWORD_EVENTS_TOKEN`, else
 * `$SLOPWEAVER_HOME/secrets/onepassword-events-token`.
 *
 * Read-only by construction: no endpoint reachable with this token returns an item's contents. The atlas's
 * other half, the `op` session, signs in from {@link onepasswordAtlasPassword}.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the token, or undefined when unconfigured
 */
export function onepasswordEventsToken({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["ONEPASSWORD_EVENTS_TOKEN"],
    secretName: "onepassword-events-token",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The dedicated atlas account's 1Password password: `$SLOPWEAVER_HOME/secrets/onepassword-atlas-password`
 * only, never an environment variable.
 *
 * What lets `onepassword sync` sign in without a terminal. The account is CLI-only — the desktop app refuses
 * a second account on the same team — and a session `op signin` mints idles out long
 * before the next scheduled resync, so the durable credential is the password itself. It is the whole
 * account on this machine, which is why the sync only ever uses it through the closed `op` allowlist.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the password, or undefined when unconfigured
 */
export function onepasswordAtlasPassword({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: [],
    secretName: "onepassword-atlas-password",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The Hex API token: `HEX_API_TOKEN`, else `$SLOPWEAVER_HOME/secrets/hex-api-token`.
 *
 * A personal API token minted by the owner in Hex's own settings — the one credential the READ integration
 * (`src/hex/`) and the atlas's workspace-entity fill resolve. Hex offers no read-only scope at mint, so the
 * token carries the minting user's whole role; what keeps every call a read is `src/hex/client.ts`, which
 * admits no HTTP method but `GET`. The `env` seam exists so a test can prove "no token anywhere" without
 * depending on the ambient shell.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @param env the environment to read `HEX_API_TOKEN` from (defaults to `process.env`)
 * @returns the token, or undefined when unconfigured
 */
export function hexApiToken({ home, env }: { home?: string; env?: Readonly<Record<string, string | undefined>> } = {}):
  string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["HEX_API_TOKEN"],
    secretName: "hex-api-token",
    ...(home !== undefined ? { home } : {}),
    ...(env !== undefined ? { env } : {}),
  });
}
