/**
 * Which paths on this machine `slopweaver talk file` may read — pure, so the refusal set is a unit test.
 *
 * The owner's ruling is that the console voice is as capable as any Claude session, which reads any file on this
 * machine. So the default is YES, and this module names the one class that stays on the machine: a credential. That is
 * a narrowing of the owner's pick, never a second guess of it — `AGENTS.md`'s one hard line is an actual secret.
 *
 * ## Both the path as asked and the path it resolves to
 *
 * A symlink is followed, the way a Claude session follows one, so a refusal has to hold for both spellings.
 * `~/Downloads/x -> ~/.slopweaver/secrets/token` is caught only on the RESOLVED path; `~/.ssh` kept as a
 * symlink into a dotfiles repository is caught only on the path AS ASKED. The caller checks both.
 *
 * ## Compared folded
 *
 * APFS is case-insensitive by default, so `~/.SSH/id_rsa` opens `~/.ssh/id_rsa`. Every comparison here folds
 * case and Unicode normalisation first, and tests containment by path SEGMENT, never by string prefix — the
 * same `relative()` test `./checkout.ts` makes, so `~/.sshx` is not inside `~/.ssh`.
 */
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

import { type LocalFileError, LocalFileErrors, type LocalRefusalRule } from "./localFileErrors.js";

/** Credential stores under the owner's home directory, each a directory or a single file. */
const HOME_CREDENTIAL_STORES: readonly string[] = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".kube",
  ".password-store",
  ".codex/auth.json",
  ".claude/.credentials.json",
  ".config/gh",
  ".config/gh-personal",
  ".config/gcloud",
  ".config/op",
  ".config/anthropic",
  ".docker/config.json",
  ".pulumi/credentials.json",
  ".supabase",
  ".coderabbit",
  ".copilot",
  ".gsutil",
  ".boto",
  ".terraform.d/credentials.tfrc.json",
  ".vault-token",
  ".config/sops/age",
  "Library/Application Support/sops/age",
  ".config/git/credentials",
  ".netrc",
  ".git-credentials",
  ".npmrc",
  ".yarnrc.yml",
  ".pypirc",
  ".pgpass",
  "Library/Keychains",
];

/**
 * A `.env` file or any copy of one (`.env.local`, `.env-prod`, `.env_prod`, `.env~`, `.env copy`, a duplicate's
 * `.env2` or `.env(1)`), except the ones that exist to be committed as a template.
 */
const ENV_NAME = /^\.env(?:rc)?(?:[-._~ (0-9](?!(?:example|sample|template|dist)$)[^/]*)?$/u;

/** An env file named for what it serves — `~/.work-console-cron.env`, a backed-up `x.envrc`. */
const ENV_SUFFIX = /\.env(?:rc)?$/u;

/** A hygiene denylist or any copy of one, wherever it sits: each holds the owner's private secret strings. */
const DENYLIST_NAME = /^hygiene-denylist/u;

/**
 * A file whose extension says it is source code, where a `key: value` line is far likelier a type or a
 * member than config — the one place `./fileRedaction.ts` lets such a value read.
 */
const SOURCE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kts?|swift|rb|cs|c|h|cc|cpp|hpp|php|scala|dart|vue|svelte|lua)$/u;

/** Key material and keystores, by extension. */
const KEY_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore|keychain-db|ppk|asc|gpg)$/u;

/** An SSH private key's conventional name; its `.pub` half is not one. */
const SSH_KEY_NAME = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$/u;

/**
 * A Codex or Claude login under ANY of their homes, matched on the folded path's last two segments: this
 * machine runs one Codex home per ChatGPT plan (`~/.codex-one`…), so naming `~/.codex` alone missed four.
 */
const LOGIN_TAIL = /(?:^|\/)\.(?:codex[^/]*\/auth\.json|claude[^/]*\/\.credentials\.json)$/u;

/**
 * Expand an absolute or `~/` path the voice asked for into one absolute, normalised path.
 *
 * @param raw the path as the model sent it
 * @param homeDir the owner's home directory, which `~` names
 * @returns the absolute path, or why it is not one this reads
 */
export function expandLocalPath({ raw, homeDir }: { raw: string; homeDir: string }): Result<string, LocalFileError> {
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point
  if (raw.length === 0 || /[\u0000-\u001f\u007f]/u.test(raw)) {
    return err(LocalFileErrors.pathInvalid({ path: raw, why: "it is empty or carries a control character" }));
  }
  if (raw === "~") {
    return ok(normalize(homeDir));
  }
  if (raw.startsWith("~/")) {
    return ok(normalize(join(homeDir, raw.slice(2))));
  }
  if (!isAbsolute(raw)) {
    return err(LocalFileErrors.pathInvalid({ path: raw, why: "give a whole path, starting / or ~/" }));
  }
  return ok(normalize(raw));
}

/**
 * Every Slopweaver home this machine has: the ones named, plus each `~/.slopweaver*` directory beside them.
 * This machine keeps several (an eval home, a second-day home), each with its own `secrets/`.
 *
 * @param homeDir the owner's home directory
 * @param homeEntries the names directly inside the owner's home directory
 * @param named the homes in play — the one in use and the default, either of which can sit outside `~`
 * @returns every home, deduplicated, unresolved
 */
export function slopweaverHomesOf({
  homeDir,
  homeEntries,
  named,
}: {
  homeDir: string;
  homeEntries: readonly string[];
  named: readonly string[];
}): readonly string[] {
  const discovered = homeEntries.filter((name) => /^\.slopweaver/iu.test(name)).map((name) => join(homeDir, name));
  return [...new Set([...named, ...discovered])];
}

/**
 * Every credential store this machine has, as absolute paths.
 *
 * Each login file under every `~/.codex*` and `~/.claude*` home is a store in its own right, not only a path
 * `LOGIN_TAIL` matches: a hard link to one has no path to match, so `./storeLinks.ts` needs it on this list.
 *
 * @param homeDir the owner's home directory
 * @param homeEntries the names directly inside the owner's home directory
 * @param slopweaverHomes every Slopweaver home, from {@link slopweaverHomesOf}; each contributes its `secrets/`
 *   and its hygiene denylist
 * @returns the store paths, unresolved; the caller also passes their resolved spellings
 */
export function credentialStores({
  homeDir,
  homeEntries,
  slopweaverHomes,
}: {
  homeDir: string;
  homeEntries: readonly string[];
  slopweaverHomes: readonly string[];
}): readonly string[] {
  const logins = homeEntries.flatMap((name) => {
    if (/^\.codex/iu.test(name)) {
      return [join(homeDir, name, "auth.json")];
    }
    if (/^\.claude/iu.test(name)) {
      return [join(homeDir, name, ".credentials.json")];
    }
    return [];
  });
  return [
    ...HOME_CREDENTIAL_STORES.map((store) => join(homeDir, store)),
    ...logins,
    ...slopweaverHomes.flatMap((home) => {
      const paths = stateHomePaths({ home });
      return [paths.secrets, paths.hygieneDenylist];
    }),
  ];
}

/**
 * Whether a file's own name marks it as a credential, wherever it sits.
 *
 * @param name the last path segment
 * @returns true for env files, a hygiene denylist or a copy of one, key material and SSH private keys
 */
export function isCredentialName({ name }: { name: string }): boolean {
  const folded = fold({ path: name });
  return [ENV_NAME, ENV_SUFFIX, DENYLIST_NAME, KEY_EXTENSION, SSH_KEY_NAME].some((rule) => rule.test(folded));
}

/**
 * Whether a path names a source file, by extension.
 *
 * @param path the resolved path
 * @returns true for TypeScript, JavaScript, Python, Go and the other languages {@link SOURCE_EXTENSION} lists
 */
export function isSourcePath({ path }: { path: string }): boolean {
  return SOURCE_EXTENSION.test(fold({ path: basename(path) }));
}

/**
 * Which rule refuses any of these spellings of one path, or `undefined` when none does.
 *
 * @param paths the path as asked and the path it resolves to
 * @param stores the credential stores, in every spelling the caller could resolve
 * @returns the first rule tripped, or `undefined`
 */
export function refusalFor({
  paths,
  stores,
}: {
  paths: readonly string[];
  stores: readonly string[];
}): LocalRefusalRule | undefined {
  for (const path of paths) {
    if (stores.some((store) => isWithin({ path, root: store })) || LOGIN_TAIL.test(fold({ path }))) {
      return "credential-store";
    }
    if (isCredentialName({ name: basename(path) })) {
      return "credential-name";
    }
  }
  return undefined;
}

/**
 * Whether `path` is `root` or lies under it, compared folded and by segment.
 *
 * @param path the candidate
 * @param root the store
 * @returns true when the path is the store or inside it
 */
export function isWithin({ path, root }: { path: string; root: string }): boolean {
  const within = relative(fold({ path: root }), fold({ path }));
  if (within === "") {
    return true;
  }
  return !(within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within));
}

/** Case- and normalisation-folded, so APFS's idea of "the same name" is this module's too. */
function fold({ path }: { path: string }): string {
  return path.normalize("NFC").toLowerCase();
}
