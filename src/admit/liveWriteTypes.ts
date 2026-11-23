/**
 * The vocabulary the bot-turn live-write guard speaks in, apart from the walk (`./liveWrite.ts`) and the two
 * tool tables (`./liveWriteMigrations.ts`, `./liveWriteInfra.ts`) so each of them can name a finding without
 * importing another.
 */

/**
 * What one command would do that a bot turn never does: run a migration (any database, the rule is to never run
 * a migration at all), or change a live system — a deploy, an infrastructure mutation, a SQL write.
 */
type LiveWriteKind = "migration" | "live-write";

/** One finding: which kind, the program that would do it, and the operation that makes it a write. */
export interface LiveWriteFinding {
  readonly kind: LiveWriteKind;
  /** The program's own name — `prisma`, `kubectl`, `yarn` for a package script. */
  readonly tool: string;
  /** The words that made it a write — `migrate deploy`, `apply`, `script db:migrate`. */
  readonly operation: string;
}

/** The classifier's decision over a whole command line. */
export type LiveWriteVerdict = { readonly kind: "allowed" } | (LiveWriteFinding & { readonly segment: string });
