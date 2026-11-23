/**
 * Read a known set of files concurrently, then hand a synchronous scanner a reader over what was read.
 *
 * A whole-tree scan (`scanTextFiles` over every tracked file) spent most of its time in `readFileSync`, one
 * blocking open and read after another. Issued concurrently, the same reads overlap on libuv's thread pool.
 * MEASURED on a 15-core Mac at load average ~27: the 19,869 tracked code files of this tree read in
 * 5.0-7.2s one `readFileSync` at a time against 1.3s through concurrent `readFile`. Repro: time a loop of
 * `readFileSync` over `git ls-files '*.ts'` against `Promise.all` of `readFile` over the same list, in one script.
 *
 * The scanner keeps its fail-closed contract: a path whose read failed is not dropped, its reader THROWS the very
 * error the read raised, so `scanTextFiles` still records it unreadable, with the same errno as before.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** How many reads are in flight at once: enough to keep the thread pool busy, few enough to hold descriptors low. */
const IN_FLIGHT = 32;

/**
 * Read every path under a root concurrently, and answer a reader that serves what was read.
 *
 * @param root the directory every path is relative to
 * @param paths the root-relative paths to read, each as UTF-8 text
 * @returns a reader that answers a path's text, rethrows the error its read raised, and throws for a path this
 *   call was never asked to read rather than reading it late
 */
export async function readTextAhead({
  root,
  paths,
}: {
  root: string;
  paths: readonly string[];
}): Promise<(args: { path: string }) => string> {
  const texts = new Map<string, string>();
  const failures = new Map<string, unknown>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const path = paths[next]!;
      next += 1;
      try {
        texts.set(path, await readFile(join(root, path), "utf8"));
      } catch (error) {
        failures.set(path, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, paths.length) }, () => worker()));
  return ({ path }) => {
    const text = texts.get(path);
    if (text !== undefined) {
      return text;
    }
    if (failures.has(path)) {
      throw failures.get(path);
    }
    throw new Error(`${path} was not among the paths read ahead`);
  };
}
