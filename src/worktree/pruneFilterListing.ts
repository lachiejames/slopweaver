/**
 * Pure readers of the two listings that say whether a git read could run a filter: `check-attr -z --all` and
 * `config --list -z`.
 *
 * Split out of `pruneGit.ts` when that file passed the size ratchet. These parse text and run nothing; the reads
 * that produce the text, and the decision built on it (`filterWouldRun`), stay at the git edge.
 */

/**
 * Which of the listed paths carry a `filter` attribute at all, from `check-attr -z --all` output.
 *
 * Pure. Each record is `<path> NUL <attribute> NUL <value> NUL`, and `--all` lists only what a path's
 * attribute files actually assign, so ANY `filter` record counts, whatever its value. Asking for `filter`
 * by name cannot be read that way: git answers `unspecified` for an absent attribute, and a driver may be
 * NAMED `unspecified` — the p3 Codex pass hid a lossy one behind exactly that name. `unset` (`-filter`)
 * counts too: comparing an unfiltered file's raw bytes costs a hash and finds it equal. A path git names that
 * was never asked for is `null`, because the runner's trim can shorten the first one.
 *
 * @param asked the paths handed to `check-attr`
 * @param listing its NUL-separated output
 * @returns the paths with any `filter` record, or `null` when the output names a path nobody asked about
 */
export function filterAttributed({
  asked,
  listing,
}: {
  asked: readonly string[];
  listing: string;
}): readonly string[] | null {
  const fields = listing.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % 3 !== 0) {
    return null;
  }
  const known = new Set(asked);
  const out = new Set<string>();
  for (let index = 0; index < fields.length; index += 3) {
    const file = fields[index]!;
    if (!known.has(file)) {
      return null;
    }
    if (fields[index + 1] === "filter") {
      out.add(file);
    }
  }
  return [...out];
}

/**
 * Every value a `filter` record carries in a `check-attr -z --all` listing — the drivers the paths name.
 *
 * Pure. `set` and `unset` are kept as names: a driver may be called either, and holding a tree over a
 * `-filter` path that shares its name with a configured driver is the safe direction.
 *
 * @param listing the NUL-separated output, already validated by {@link filterAttributed}
 * @returns the driver names
 */
export function filterDriversIn({ listing }: { listing: string }): ReadonlySet<string> {
  const fields = listing.split("\0");
  const out = new Set<string>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 1] === "filter") {
      out.add(fields[index + 2]!);
    }
  }
  return out;
}

/** A config key naming a command git runs over a file's bytes as `status` reads them. */
const FILTER_COMMAND_KEY = /^filter\.(.+)\.(clean|process)$/i;

/**
 * The drivers a `git config --list -z` listing gives a clean or process command.
 *
 * Pure. Each record is `<key>\n<value>`, or a bare `<key>` for a valueless one, so the key is everything
 * before the first newline; git lowercases a key's section and variable but keeps the driver's own case.
 *
 * @param listing the NUL-separated config listing
 * @returns each driver with a `filter.<driver>.clean` or `filter.<driver>.process` key
 */
export function commandDrivers({ listing }: { listing: string }): ReadonlySet<string> {
  return new Set(
    listing.split("\0").flatMap((record) => {
      const driver = FILTER_COMMAND_KEY.exec(record.split("\n")[0]!)?.[1];
      return driver === undefined ? [] : [driver];
    }),
  );
}
