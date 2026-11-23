/**
 * Collect what one in-process run writes — its stdout whole, the tail of its stderr — instead of letting it reach
 * the process's own streams, so several verbs can run in ONE process and each still answer with its own output
 * (`console batch`, `../cli/commands/console/batch.ts`).
 *
 * The scope is an `AsyncLocalStorage`, never one mutable global: a write is the scope's only when it runs inside that
 * scope's async context, so two scopes alive at once, or a timer an earlier run left behind that fires outside any
 * scope, never write into the wrong run's collection. Every door a write takes in this process is covered: the
 * logger's `out`/`outExact` and `errExact` write descriptors 1 and 2 themselves and consult {@link collectedOut} and
 * {@link collectedErr} first (`./logger.ts`), and `process.stdout.write` and `process.stderr.write` — which
 * `console.log` and every other stream writer reach — are wrapped while any scope is open.
 *
 * What it cannot reach, stated rather than discovered: a module writing descriptor 1 or 2 with its own `writeSync`,
 * or a child process inheriting the descriptors. Either writes straight to the real stream, which is why the batch
 * runs only the verbs on its witnessed list (`../cli/commands/console/batchVerbs.ts`).
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { chunkText, keptTail, type TeeableStream } from "./writeTee.js";

/** One open collection: stdout kept whole, stderr kept as a bounded tail, each stream decoded on its own. */
interface OutputScope {
  readonly out: string[];
  err: string;
  readonly keepErrChars: number;
  readonly outDecoder: TextDecoder;
  readonly errDecoder: TextDecoder;
}

const scopes = new AsyncLocalStorage<OutputScope>();

/** How many scopes are open, so each stream's `write` is wrapped once and put back when the last one closes. */
let openScopes = 0;
let unwrappedStdoutWrite: TeeableStream["write"] | undefined;
let unwrappedStderrWrite: TeeableStream["write"] | undefined;

/**
 * Hand one stdout write to the scope it was made in.
 *
 * @param text the exact bytes the write carried
 * @returns `true` when a scope took it, so the caller writes nothing; `false` outside every scope
 */
export function collectedOut({ text }: { text: string }): boolean {
  const scope = scopes.getStore();
  if (scope === undefined) {
    return false;
  }
  scope.out.push(text);
  return true;
}

/**
 * Hand one stderr write to the scope it was made in, kept to that scope's tail.
 *
 * @param text the exact text the write carried
 * @returns `true` when a scope took it; `false` outside every scope
 */
export function collectedErr({ text }: { text: string }): boolean {
  const scope = scopes.getStore();
  if (scope === undefined) {
    return false;
  }
  scope.err = keptTail({ keepChars: scope.keepErrChars, text: `${scope.err}${text}` });
  return true;
}

/**
 * A stream `write` that hands a write made inside a scope to that scope, and passes any other to `original`.
 *
 * @param stream the stream `original` is called on, so its `this` is the stream's own
 * @param original the stream's real `write`
 * @param collect hands one decoded write to the scope it was made in
 * @returns the wrapper to install in `original`'s place
 */
function collectingWrite({
  stream,
  original,
  collect,
}: {
  stream: NodeJS.WriteStream;
  original: TeeableStream["write"];
  collect: (written: { scope: OutputScope; chunk: unknown }) => void;
}): typeof process.stdout.write {
  return (...args: unknown[]): boolean => {
    const scope = scopes.getStore();
    if (scope === undefined) {
      return Reflect.apply(original, stream, args);
    }
    collect({ chunk: args[0], scope });
    // A caller's completion callback still fires, as the real stream's would.
    const callback = args.find((arg): arg is () => void => typeof arg === "function");
    if (callback !== undefined) {
      queueMicrotask(callback);
    }
    return true;
  };
}

/** Wrap both streams' `write` so a write inside a scope is collected; one wrapper however many scopes are open. */
function openStreams(): void {
  openScopes += 1;
  if (openScopes > 1) {
    return;
  }
  unwrappedStdoutWrite = process.stdout.write;
  unwrappedStderrWrite = process.stderr.write;
  process.stdout.write = collectingWrite({
    collect: ({ scope, chunk }) => {
      scope.out.push(chunkText({ chunk, decoder: scope.outDecoder }));
    },
    original: unwrappedStdoutWrite,
    stream: process.stdout,
  });
  process.stderr.write = collectingWrite({
    collect: ({ scope, chunk }) => {
      collectedErr({ text: chunkText({ chunk, decoder: scope.errDecoder }) });
    },
    original: unwrappedStderrWrite,
    stream: process.stderr,
  });
}

/** Put both streams' `write` back once the last scope has closed. */
function closeStreams(): void {
  openScopes -= 1;
  if (openScopes > 0 || unwrappedStdoutWrite === undefined || unwrappedStderrWrite === undefined) {
    return;
  }
  process.stdout.write = unwrappedStdoutWrite;
  process.stderr.write = unwrappedStderrWrite;
  unwrappedStdoutWrite = undefined;
  unwrappedStderrWrite = undefined;
}

/**
 * Run `run` with everything it writes collected rather than written: its stdout whole, in order, and the last
 * `keepErrChars` characters of its stderr. The streams are put back whether `run` resolves or throws.
 *
 * @param run the work whose output is collected
 * @param keepErrChars how much of the stderr tail is kept, in UTF-16 code units
 * @returns the run's value, everything it wrote to stdout, and the tail of its stderr
 */
export async function collectOutput<T>({
  run,
  keepErrChars,
}: {
  run: () => Promise<T>;
  keepErrChars: number;
}): Promise<{ readonly value: T; readonly out: string; readonly err: string }> {
  const scope: OutputScope = {
    err: "",
    errDecoder: new TextDecoder(),
    keepErrChars,
    out: [],
    outDecoder: new TextDecoder(),
  };
  openStreams();
  try {
    const value = await scopes.run(scope, run);
    // Bytes of a character a run's last byte write left unfinished are its own, so flush them into its output.
    scope.out.push(scope.outDecoder.decode());
    scope.err = keptTail({ keepChars: scope.keepErrChars, text: `${scope.err}${scope.errDecoder.decode()}` });
    return { err: scope.err, out: scope.out.join(""), value };
  } finally {
    closeStreams();
  }
}
