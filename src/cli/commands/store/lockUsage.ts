/**
 * The usage strings `store lock` and `store start` print and their manifest quotes — a leaf, so the manifest
 * barrel stays metadata-only (`manifestBarrelClosure.test.ts`).
 */

/** `store lock`'s usage. */
export const LOCK_USAGE =
  "usage: slopweaver store lock [--rotate] [--workdir <checkout>] [--home <dir>] [--json]\n" +
  "  Closes the local Supabase stack's password doors from this Mac: the verbs log in as their own role with a\n" +
  "  random password (written to secrets/store-url, never printed), every other login from the Mac is refused,\n" +
  "  sessions that came in before are ended, and the API roles lose their table rights in the store. Before the\n" +
  "  role is first created it retains a local copy of the store under store-lock/backups/ and proves it restores.\n" +
  "  Idempotent; `store start` runs it on every start. --rotate replaces a password another home may hold.\n" +
  "  See skills/store/reference/local-lock.md.";

/** `store start`'s usage. */
export const START_USAGE =
  "usage: slopweaver store start [--rotate] [--workdir <checkout>] [--home <dir>] [--json]\n" +
  "  Starts the local Supabase stack through the pinned CLI, then runs `store lock` on it. `yarn store:start`\n" +
  "  runs this, so the stack never comes up with its default password open to the Mac for longer than the start.";
