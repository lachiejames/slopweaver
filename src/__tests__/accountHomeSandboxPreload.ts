/**
 * The preload that carries a test file's ACCOUNT-home sandbox into every Slopweaver process it spawns.
 *
 * `accountDefaultHome()` (`src/homeDir.ts`) reads the password database, so no environment variable moves it, and
 * `setup-ambient-home.ts` sandboxes it in a process-only slot. A slot cannot cross `exec`: without this file, every
 * `bin/slopweaver` child the subprocess lane spawned resolved the operator's real `~/.slopweaver`, read their protect
 * registry and took the profile lock there. So that setup file puts `--import=<this file's URL>?home=<sandbox>` on
 * `NODE_OPTIONS` (`accountHomeSandboxChild.ts` builds it), which every child spawned with an inherited environment
 * carries, and every Node process in the child's tree that can run Slopweaver code — tsx's wrapper, the CLI tsx
 * starts, a built `dist-cli` entry — runs this first and fills the same registered-symbol slot. A launcher probe that
 * clears `NODE_OPTIONS` on purpose runs no Slopweaver code, so it needs none.
 *
 * The path rides this module's own URL, never a variable, so production code reads nothing new: a command line that
 * wanted to move the anchor this way already has to preload code of its own, which `NODE_OPTIONS` always allowed.
 *
 * No imports and erasable syntax only, because the tsx wrapper process has no loader yet: Node's own type stripping
 * runs it there. Silent on success, since a byte of output would break every exact stdout or stderr assertion. A
 * missing, repeated, relative or NUL-bearing path throws, and so does a slot that will not keep the path, so a
 * malformed wiring fails the child loudly rather than letting it fall back to the real home.
 *
 * What it guards is the WIRING's shape, never a hostile earlier preload: a module that runs first and replaces
 * `URL`, `Object.defineProperty` or `process` itself already owns the whole process, and no check written here could
 * outlast it. A stale slot accessor is the one earlier-preload shape it does handle, because that is a slot's own state.
 */

const ACCOUNT_HOME_SANDBOX_SLOT: unique symbol = Symbol.for("slopweaver.accountDefaultHome.sandbox");

/** `process` as this preload writes it, the same shape `homeDir.ts` reads. */
type AccountHomeSandboxHost = typeof process & { [ACCOUNT_HOME_SANDBOX_SLOT]?: unknown };

const given: readonly string[] = new URL(import.meta.url).searchParams.getAll("home");

if (given.length !== 1) {
  throw new Error(
    `accountHomeSandboxPreload: expected exactly one ?home=<dir> on its import URL and found ${String(given.length)}, so this process would resolve the real account home`,
  );
}

const sandbox: string = given[0]!;

if (!sandbox.startsWith("/") || sandbox.includes("\u0000")) {
  throw new Error(
    "accountHomeSandboxPreload: the ?home= on its import URL is not an absolute path without a NUL, so this process would resolve the real account home",
  );
}

// Defined rather than assigned, so an accessor an earlier preload left on the slot is replaced rather than handed the
// value; then read back, so a slot that still cannot hold it fails here instead of answering the real home later.
// Writable and configurable, as a plain assignment would leave it, so `homeDir.ts` can still repoint or clear it.
Object.defineProperty(process, ACCOUNT_HOME_SANDBOX_SLOT, {
  configurable: true,
  enumerable: true,
  value: sandbox,
  writable: true,
});
if ((process as AccountHomeSandboxHost)[ACCOUNT_HOME_SANDBOX_SLOT] !== sandbox) {
  throw new Error(
    "accountHomeSandboxPreload: the account-home sandbox slot did not keep the path it was given, so this process would resolve the real account home",
  );
}
