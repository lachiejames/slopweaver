/**
 * `parseExecutables`: the image behind each pid off an `lsof -Fpfn` listing, the first `txt` file of each block and
 * nothing else.
 */
import { describe, expect, it } from "vitest";

import { parseExecutables, parseTtyHolders } from "../../../../live/standing/executables.js";

/**
 * MEASURED on macOS: `/bin/sleep` spawned with `argv0: "/bin/zsh"` (pid 70456) beside the node that
 * spawned it (pid 70344), `lsof -p 70456,70344 -Fpfn`. The cwd comes first in each block, then the image, then dyld.
 */
const MEASURED = [
  "p70344",
  "fcwd",
  "n/Users/ada/dev/slopweaver",
  "ftxt",
  "n/Users/ada/.proto/tools/node/24.21.0/bin/node",
  "ftxt",
  "n/Users/ada/dev/slopweaver/node_modules/fsevents/fsevents.node",
  "ftxt",
  "n/usr/lib/dyld",
  "f0",
  "n/dev/null",
  "p70456",
  "fcwd",
  "n/Users/ada/dev/slopweaver",
  "ftxt",
  "n/bin/sleep",
  "ftxt",
  "n/usr/lib/dyld",
  "f0",
  "n/dev/null",
  "f1",
  "n/dev/null",
  "",
].join("\n");

describe("parseExecutables", () => {
  it("reads each block's first txt file as its pid's image, never the cwd, a later library or a descriptor", () => {
    expect([...parseExecutables({ text: MEASURED })]).toEqual([
      [70344, "/Users/ada/.proto/tools/node/24.21.0/bin/node"],
      [70456, "/bin/sleep"],
    ]);
  });

  it("holds no entry for a pid whose block lists no txt file, nor for an empty listing", () => {
    const noImage = ["p77", "fcwd", "n/", "f0", "n/dev/null", ""].join("\n");

    expect([[...parseExecutables({ text: noImage })], [...parseExecutables({ text: "" })]]).toEqual([[], []]);
  });

  it("ignores an n line that follows no ftxt, and a p line that is not a pid", () => {
    const stray = ["n/bin/zsh", "pabc", "ftxt", "n/bin/zsh", "p5", "f0", "n/dev/null", "ftxt", "n/bin/bash", ""].join(
      "\n",
    );

    expect([...parseExecutables({ text: stray })]).toEqual([[5, "/bin/bash"]]);
  });
});

/**
 * MEASURED: `lsof -n -P -Fpf /dev/ttys003` on a live tab, its shell (913), its `claude` (914) and a shell
 * under that (61403), each block one `p` line then its `f` lines; a bare tab's `/dev/ttys005` listed its shell alone
 * on fds 0, 1, 2, 10 and 14.
 */
const HELD = ["p913", "f0", "f10", "f14", "p914", "f0", "f1", "f2", "f5", "p61403", "f0", "f1", ""].join("\n");

describe("parseTtyHolders", () => {
  it("reads each block's pid and the descriptors under it, in listing order", () => {
    expect([...parseTtyHolders({ text: HELD })]).toEqual([
      [913, [0, 10, 14]],
      [914, [0, 1, 2, 5]],
      [61403, [0, 1]],
    ]);
  });

  it("keeps every fd of a repeated pid, skips a p or f line that is not numeric, and reads an empty listing as no holder", () => {
    const odd = ["p5", "f0", "fcwd", "pabc", "f9", "p5", "f1", "p7", ""].join("\n");

    expect([[...parseTtyHolders({ text: odd })], [...parseTtyHolders({ text: "" })]]).toEqual([
      [
        [5, [0, 1]],
        [7, []],
      ],
      [],
    ]);
  });
});
