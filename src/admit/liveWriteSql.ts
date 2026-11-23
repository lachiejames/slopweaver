/**
 * Which database-client invocations WRITE — the SQL half of the bot-turn live-write guard
 * (`./liveWriteInfra.ts` is the infrastructure half). The rule: the bot does not take actions on staging or
 * prod, and reading and reporting is the safe lane.
 *
 * ## Read by allowlist, never by a list of writes
 *
 * A SQL statement is a read only when it OPENS with a read (`SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `TABLE`,
 * `VALUES`, `DESCRIBE`, `USE`, a session `SET`, a psql describe command) AND no write keyword appears in it
 * outside a literal, a quoted name or a comment. Anything else is a write. A list of write keywords was what
 * this file first held, and a review broke it in one move (`COMMENT ON TABLE`): the set of
 * statements that change a database is open, the set that only read it is small.
 *
 * What this still cannot see, stated: a read-shaped call to a function with side effects
 * (`SELECT pg_terminate_backend(…)`, `SELECT setval(…)`), and a MongoDB write spelled some way
 * {@link MONGO_WRITE} does not know — the mongo shell's input is JavaScript, which has no read-only prefix.
 *
 * Pure: a program's name, its argument words and what its stdin reads in; a finding or nothing out.
 */
import type { LiveWriteFinding } from "./liveWriteTypes.js";

/** What a SQL client's stdin reads, when the walk could see it. */
export type ClientStdin = { readonly kind: "heredoc"; readonly body: string } | { readonly kind: "file" } | undefined;

/**
 * A string literal (PostgreSQL's `$tag$…$tag$` and `E'…'` included), a quoted identifier or a comment — text
 * that is data or a name, never a statement. Whether a backslash escapes a quote is the DIALECT's: always in
 * an `E'…'` string, in every string for MySQL and ClickHouse, and never in a standard PostgreSQL one — read
 * that way there, `'x\'; DELETE …` would swallow the write after it.
 */
const SQL_INERT = {
  backslash:
    /\$(\w*)\$[\s\S]*?\$\1\$|'(?:[^'\\]|''|\\[\s\S])*'|"(?:[^"\\]|""|\\[\s\S])*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\//g,
  standard:
    /\$(\w*)\$[\s\S]*?\$\1\$|(?<![\w$])[Ee]'(?:[^'\\]|''|\\[\s\S])*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\//g,
} as const;

/**
 * How a read statement may open. `SET` reads only as a session setting — never `GLOBAL`, `PERSIST`, `@@`, a
 * role or a password. A psql backslash command reads only when it describes (`\d…`, `\l`); `\copy`, `\i`
 * and `\!` do not open a read.
 */
const SQL_READ_START =
  /^(?:select|with|show|explain|table|values|describe|desc|use|exists|set\s+(?!(?:global|persist\w*|role|password|session\s+authorization)\b|@@)|\\(?:d\w*\+?|l\+?|x|timing|conninfo|echo|pset|encoding)(?:\s|$))/i;

/**
 * A write hiding inside a read-shaped statement: a data-modifying CTE, `SELECT … INTO`, a `FOR UPDATE` lock,
 * or an `EXPLAIN ANALYZE` that runs the write it explains. Only these, because the statement already opened
 * with a read — a bare `replace(…)` or `create_at` column must not flip it.
 */
const SQL_WRITE = /\b(?:insert|update|delete|merge|upsert|into|truncate)\b/i;

/**
 * An `EXPLAIN` that only plans: no `ANALYZE` (or `ANALYSE`) anywhere in it, so the statement it explains never
 * runs and its write keywords are the plan's subject, not an act.
 */
const SQL_PLAN_ONLY = /^explain\b(?![\s\S]*\banaly[sz]e\b)/i;

/**
 * Whether SQL text carries a write: true unless every statement opens with a read and none carries a write
 * keyword once literals, quoted names and comments are blanked — so `SELECT 'update' AS op` stays a read and
 * `COMMENT ON TABLE` is a write without being listed.
 *
 * @param sql the statement text, one statement or several
 * @param escapes whether the dialect's plain strings take a backslash escape (`backslash`) or only `E'…'` does
 * @returns whether any statement is not a plain read
 */
export function sqlWrites({ sql, escapes }: { sql: string; escapes: keyof typeof SQL_INERT }): boolean {
  const statements = sql
    .replace(SQL_INERT[escapes], " ")
    .split(/;|\n(?=\s*\\)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  return statements.some(
    (statement) => !SQL_PLAN_ONLY.test(statement) && (!SQL_READ_START.test(statement) || SQL_WRITE.test(statement)),
  );
}

/** The flags that carry inline SQL for each client, the flags that run a SQL file, and its string escapes. */
const SQL_CLIENTS: Readonly<
  Record<
    string,
    { readonly inline: readonly string[]; readonly file: readonly string[]; readonly escapes: keyof typeof SQL_INERT }
  >
> = {
  "clickhouse-client": { escapes: "backslash", file: [], inline: ["--query", "-q"] },
  cqlsh: { escapes: "standard", file: ["-f", "--file"], inline: ["-e", "--execute"] },
  mariadb: { escapes: "backslash", file: [], inline: ["-e", "--execute"] },
  mongosh: { escapes: "standard", file: ["--file", "-f"], inline: ["--eval"] },
  mysql: { escapes: "backslash", file: [], inline: ["-e", "--execute"] },
  psql: { escapes: "standard", file: ["-f", "--file"], inline: ["-c", "--command"] },
  sqlcmd: { escapes: "standard", file: ["-i"], inline: ["-Q", "-q"] },
};

/**
 * A MongoDB shell write: a collection or database mutator, a raw command, an aggregation that writes its
 * output, or a replica-set or sharding helper other than a status read.
 */
const MONGO_WRITE =
  /\.(?:insert|update|delete|drop|replace|remove|bulkWrite|createIndex|rename|findAndModify|findOneAnd|runCommand|adminCommand|createCollection|createUser|grant|revoke|shutdownServer|fsync|killOp|setProfilingLevel)\w*\s*\(|\$(?:out|merge)\b|\b(?:rs|sh)\.(?!status\b|conf\b|print)\w+\s*\(/;

/** The value an option carries — `-c X`, `-cX`, `--command=X`, `--command X` — for each spelling in `flags`. */
function optionValues({ args, flags }: { args: readonly string[]; flags: readonly string[] }): readonly string[] {
  return args.flatMap((word, index) =>
    flags.flatMap((flag) => {
      if (word === flag) return index + 1 < args.length ? [args[index + 1]!] : [];
      if (flag.startsWith("--") && word.startsWith(`${flag}=`)) return [word.slice(flag.length + 1)];
      return !flag.startsWith("--") && word.startsWith(flag) && word.length > flag.length
        ? [word.slice(flag.length)]
        : [];
    }),
  );
}

/** The operation that makes one database-client invocation a write, or `undefined`. */
function clientOperation({
  name,
  args,
  stdin,
}: {
  name: string;
  args: readonly string[];
  stdin: ClientStdin;
}): string | undefined {
  const client = SQL_CLIENTS[name]!;
  const writes = ({ text }: { text: string }): boolean =>
    name === "mongosh" ? MONGO_WRITE.test(text) : sqlWrites({ escapes: client.escapes, sql: text });
  if (optionValues({ args, flags: client.inline }).some((text) => writes({ text }))) return "a write statement";
  if (optionValues({ args, flags: client.file }).length > 0 || stdin?.kind === "file") return "a SQL file";
  return stdin?.kind === "heredoc" && writes({ text: stdin.body }) ? "a write statement on stdin" : undefined;
}

/**
 * The write one database-client invocation would make: inline SQL that writes, a SQL file it runs, or stdin
 * that does either. A client with no statement and no stdin is interactive and has written nothing yet.
 *
 * @param name the program's own name
 * @param args the words after the program, redirections removed
 * @param stdin what the segment's stdin reads, when it is a heredoc body or a file
 * @returns `not-a-client` for any other program, else the finding or `undefined`
 */
export function sqlClientFinding({
  name,
  args,
  stdin,
}: {
  name: string;
  args: readonly string[];
  stdin: ClientStdin;
}): LiveWriteFinding | "not-a-client" | undefined {
  if (!Object.hasOwn(SQL_CLIENTS, name)) return "not-a-client";
  const operation = clientOperation({ args, name, stdin });
  return operation === undefined ? undefined : { kind: "live-write", operation, tool: name };
}
