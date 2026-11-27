/**
 * The one repository a salvage's history check, scan, push and read-back may all reach, or why there is not exactly
 * one — split out of `./salvagePush` so the history check (`./salvageTrunkHistory`) reads the trunk from the same
 * bound url the push later sends to, without the two modules importing each other.
 */
import type { GithubPushEdges } from "../admit/githubPush.js";
import { err, ok, type Result } from "../lib/result.js";
import { type SalvageDestinationError, SalvageDestinationErrors } from "./salvageErrors.js";
import { HOOKS_OFF } from "./salvageHooksOff.js";

/** An ssh or https url, or git's scp-like `user@host:path` — each binds a host by its key or certificate. */
const AUTHENTICATED_URL = /^(?:(?:ssh|https|git\+ssh|ssh\+git):\/\/[^/\s]+\/|[^/\s@:]+@[^/\s:]+:(?!\/))/i;

/** What git says about a remote's urls and the configuration and environment that could re-route them. */
interface DestinationFacts {
  /** The remote's name, for the refusal. */
  readonly remote: string;
  /** `remote get-url`'s answer. */
  readonly fetchUrl: string;
  /** `remote get-url --push --all`'s answer, one url a line. */
  readonly pushUrls: string;
  /** `git remote`'s answer, one configured remote name a line. */
  readonly remotes: string;
  /** `git config --list`'s answer, one `key=value` a line. */
  readonly config: string;
  /** The environment the reads and the push inherit, read for `GIT_SSH_COMMAND`, `GIT_SSH` and `GIT_SSL_NO_VERIFY`. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/**
 * The one literal url every read and the push name, bound so that string reaches one repository, or why it cannot be.
 *
 * Pure. `git push <remote>` sends to EVERY push url, `ls-remote <remote>` and the read-back ask the fetch url,
 * so anything but one push url equal to the fetch url is a destination nothing can be bound to. Two more
 * shapes make one literal string reach two repositories, and both refuse: a url that is itself
 * a configured remote's NAME, which git resolves back through that remote's own fetch and push urls, and any
 * `url.<base>.pushInsteadOf` or `insteadOf`: `remote get-url` answers with one rewrite applied, and git
 * applies every rule AGAIN to that literal when the scan and push name it, so a chain turns an ssh url the
 * check accepted into a local path. A configured ssh COMMAND refuses too — `core.sshCommand` in
 * that config, or `GIT_SSH_COMMAND` or `GIT_SSH` in the environment the push inherits: it carries every
 * connection, so a wrapper holding state routes the scan's `ls-remote` and fetch to one repository and the
 * push and read-back to another. One written AFTER this read and before the push is outside it:
 * a writer of this repository's config already runs its own code in the push through `credential.helper`, so
 * the binding is to the configuration read here. The ssh client's OWN config (`~/.ssh/config`'s
 * `ProxyCommand`, `HostName`) is outside git and outside this check the same way: its writer runs code as
 * the owner already.
 *
 * **A certificate binds only while git checks it.** `http.sslVerify`, plain or url-scoped, set to anything but
 * `true`, `yes`, `on` or `1` (or given bare, which git reads as true), or `GIT_SSL_NO_VERIFY` present at all
 * lets anything on the path, a configured `http.proxy` included, answer
 * the scan from one repository and the push from another, so either refuses. It FAILS CLOSED
 * rather than listing git's false spellings, because git parses any integer, `00` and `0k` included, and a
 * list of false words missed one; a true spelled `2` refuses too, which costs a salvage, never a secret. The trust store
 * git verifies against is the residue: a CA the user or the system installed is trusted exactly as git
 * trusts it.
 *
 * It does not ask whether the url names a HOST: {@link oneDestination} adds that, for the push.
 *
 * @returns the url, or the refusal
 */
function boundDestination({
  remote,
  fetchUrl,
  pushUrls,
  remotes,
  config,
  environment,
}: DestinationFacts): Result<string, SalvageDestinationError> {
  const urls = pushUrls.split("\n").filter((line) => line.trim() !== "");
  if (urls.length !== 1 || urls[0]!.trim() !== fetchUrl.trim()) {
    return err(SalvageDestinationErrors.pushUrlMismatch({ count: urls.length, remote }));
  }
  const url = urls[0]!.trim();
  if (remotes.split("\n").some((name) => name.trim() === url)) {
    return err(SalvageDestinationErrors.urlIsRemoteName({ remote }));
  }
  if (config.split("\n").some((line) => /^url\..*\.(?:push)?insteadof=/i.test(line))) {
    return err(SalvageDestinationErrors.insteadOf());
  }
  const sshInEnvironment = ["GIT_SSH_COMMAND", "GIT_SSH"].some((name) => {
    const value = environment[name];
    return value !== undefined && value !== "";
  });
  if (sshInEnvironment || config.split("\n").some((line) => /^core\.sshcommand=/i.test(line))) {
    return err(SalvageDestinationErrors.sshCommand());
  }
  // git reads GIT_SSL_NO_VERIFY by presence, so an empty value switches verification off too.
  const unverified =
    environment["GIT_SSL_NO_VERIFY"] !== undefined ||
    config.split("\n").some((line) => {
      const setting = /^http\.(?:.*\.)?sslverify(?:=(.*))?$/i.exec(line.trim());
      return setting?.[1] !== undefined && !/^(?:true|yes|on|1)$/i.test(setting[1]);
    });
  if (unverified) {
    return err(SalvageDestinationErrors.tlsUnverified());
  }
  return ok(url);
}

/**
 * The one repository a salvage's scan, push and read-back may all reach: a {@link boundDestination} url that also
 * names a HOST, over ssh or https.
 *
 * Pure. One string is one repository only when something outside the filesystem binds it: a host key or a TLS
 * certificate. A local path — bare, `file://`, or a symlink to either — is re-pointable between the scan and the
 * push, so the scan reads one repository and the push publishes into another with every string, environment and
 * config unchanged. `git://` and `http://` authenticate no host, and `ext::` runs a command, so all of them refuse
 * too. A host binds the SERVER, not the repository behind the path: one deleted, transferred or recreated at the same
 * path between the scan and the push receives objects the scan read against another. That is the third residue, and
 * like a force-push over the default branch it takes an admin of the destination repository.
 *
 * @returns the url, or the refusal
 */
export function oneDestination(facts: DestinationFacts): Result<string, SalvageDestinationError> {
  return boundDestination(facts).andThen((url) =>
    AUTHENTICATED_URL.test(url)
      ? ok(url)
      : err(SalvageDestinationErrors.unauthenticatedDestination({ remote: facts.remote })),
  );
}

/**
 * Read the facts a destination is judged on, once, and judge them.
 *
 * @param deps the git edges
 * @param path the worktree
 * @param remote the remote's name
 * @param judge {@link boundDestination} or {@link oneDestination}
 * @returns the url, or why no one repository could be named
 */
function readDestination({
  deps,
  path,
  remote,
  judge,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
  judge: (facts: DestinationFacts) => Result<string, SalvageDestinationError>;
}): Result<string, SalvageDestinationError> {
  try {
    // Read in this order: the fetch url first, the one every later read is compared against.
    return judge({
      fetchUrl: deps.readGit({ args: [...HOOKS_OFF, "remote", "get-url", remote], cwd: path }),
      pushUrls: deps.readGit({ args: [...HOOKS_OFF, "remote", "get-url", "--push", "--all", remote], cwd: path }),
      remote,
      remotes: deps.readGit({ args: [...HOOKS_OFF, "remote"], cwd: path }),
      config: deps.readGit({ args: [...HOOKS_OFF, "config", "--list"], cwd: path }),
      environment: process.env,
    });
  } catch (error: unknown) {
    return err(SalvageDestinationErrors.unreadable({ cause: error, remote }));
  }
}

/**
 * The bound url the history check asks for the remote's live trunk: the url the push must later resolve to again.
 *
 * @param deps the git edges
 * @param path the worktree
 * @param remote the remote's name
 * @returns the url, or why no one repository could be named
 */
export function resolveBoundUrl({
  deps,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
}): Result<string, SalvageDestinationError> {
  return readDestination({ deps, judge: boundDestination, path, remote });
}

/**
 * The url a salvage's scan, push and read-back all name, resolved at the push, or why there is none.
 *
 * @param deps the git edges
 * @param path the worktree
 * @param remote the remote's name
 * @returns the url, or why no one repository could be named
 */
export function resolveDestination({
  deps,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
}): Result<string, SalvageDestinationError> {
  return readDestination({ deps, judge: oneDestination, path, remote });
}
