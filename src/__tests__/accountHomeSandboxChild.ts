/**
 * How a spawned child gets this test file's ACCOUNT-home sandbox: a `NODE_OPTIONS` token importing
 * `accountHomeSandboxPreload.ts` with the sandbox path on its URL. `setup-ambient-home.ts` composes it onto the
 * worker's own `NODE_OPTIONS`, so a child spawned with an inherited environment already carries it; a spawn that
 * builds a MINIMAL environment (`{ HOME, PATH }` and little else) spreads {@link accountSandboxChildEnv} into it,
 * since it would otherwise start a CLI that resolves the operator's real `~/.slopweaver`.
 */

/** The preload's own location, resolved once: the URL each composed token copies and adds its query to. */
const PRELOAD_URL = new URL("./accountHomeSandboxPreload.ts", import.meta.url);

/**
 * An `--import=` of an account-home preload carrying a query — this checkout's, or another checkout's, as a worker
 * launched from inside an earlier test's child inherits.
 */
const SANDBOX_TOKEN = /^--import=file:\/\/\S*\/accountHomeSandboxPreload\.ts\?/;

/**
 * The `NODE_OPTIONS` value a child needs: whatever was already there, minus any account-home preload it already
 * carried, then one `--import=` of the preload carrying `home` in its query. Dropping an inherited one is what stops a
 * worker started from inside another test's child from answering that test's sandbox, or two. `URLSearchParams`
 * encodes a space, `%` and `+`, so the token holds no literal whitespace for Node's space-separated parser to split.
 *
 * @param home the absolute sandbox directory the child's `accountDefaultHome()` must answer
 * @param inherited the value already set, its other options kept first so an earlier preload still runs before this one
 * @returns the composed value
 */
export function accountHomeSandboxNodeOptions({
  home,
  inherited,
}: {
  home: string;
  inherited: string | undefined;
}): string {
  const url = new URL(PRELOAD_URL.href);
  url.searchParams.set("home", home);
  const kept = splitOptions({ value: inherited }).filter((option) => !SANDBOX_TOKEN.test(option));
  return [...kept, `--import=${url.href}`].join(" ");
}

/**
 * A `NODE_OPTIONS` value's space-separated options, none empty.
 *
 * @param value the variable as read, absent included
 * @returns its options, in order
 */
function splitOptions({ value }: { value: string | undefined }): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value.split(/\s+/).filter((option) => option !== "");
}

/**
 * The one preload token in a `NODE_OPTIONS` value, or every one when a value carries several.
 *
 * @param value a `NODE_OPTIONS` value, absent included
 * @returns the `--import=` tokens naming an account-home preload, any checkout's, in order
 */
export function accountHomeSandboxTokens({ value }: { value: string | undefined }): readonly string[] {
  return splitOptions({ value }).filter((option) => SANDBOX_TOKEN.test(option));
}

/**
 * The fragment a minimal child environment spreads in: ONLY the preload token the setup file composed onto the
 * worker's `NODE_OPTIONS`, never the rest of it — a minimal environment chose to inherit nothing else, and a token an
 * agent host injected (cmux's guard, say) would then reach a child without the variables that let the launcher strip
 * it. Read on every call rather than cached, because the unit lane reuses a fork across files and a cached value
 * would name a previous file's removed sandbox.
 *
 * @returns `NODE_OPTIONS` holding the one preload token; throws when no setup file installed exactly one, rather than
 *   letting a child start against the real account home
 */
export function accountSandboxChildEnv(): { readonly NODE_OPTIONS: string } {
  const tokens = accountHomeSandboxTokens({ value: process.env["NODE_OPTIONS"] });
  if (tokens.length !== 1) {
    throw new Error(
      `accountSandboxChildEnv: NODE_OPTIONS carries ${String(tokens.length)} account-home sandbox preloads, not one — is setup-ambient-home.ts in this lane's setupFiles?`,
    );
  }
  return { NODE_OPTIONS: tokens[0]! };
}
