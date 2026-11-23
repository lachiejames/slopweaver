/**
 * The executable behind a pid, decoded off `lsof -p <pids> -Fpfn`: the one column a process cannot set for itself.
 * A process names its own argv — `execve("/tmp/zsh", ["/bin/zsh"])` lists as `/bin/zsh` in `ps -o args=` and in
 * `ps -o comm=` alike, MEASURED on macOS (`/bin/sleep` spawned with `argv0: "/bin/zsh"` printed
 * `/bin/zsh` in both columns) — while the first `txt` file `lsof` lists for it is the image the kernel mapped,
 * `/bin/sleep`, which only another exec changes (a stdin-reading program at `/tmp/zsh` started with `/bin/zsh` as its
 * argv[0] passes every check keyed on the argv). The read is `./coldReads.ts`'s
 * `readExecutables`; this file is the decoder, pure. Beside it, the pids holding a tty DEVICE open and on which
 * descriptors, off `lsof -Fpf /dev/<tty>` (`parseTtyHolders`, read by `readTtyHolders`): a process on no controlling
 * tty can still hold the tab's tty as a descriptor and read what is typed at it, and a shell on the tty can hold it
 * on every descriptor but its stdin, which no `ps` column shows.
 */

/**
 * Decode a `lsof -Fpfn` listing into each pid's executable. MEASURED: each process is one block opened
 * by a `p<pid>` line, then `f<fd>` and `n<name>` pairs, the first `ftxt`/`n` pair being the executable (`p70456`,
 * `fcwd`, `n/Users/…`, `ftxt`, `n/bin/sleep`, `ftxt`, `n/usr/lib/dyld`, `f0`, `n/dev/null`, …). A pid with no
 * `txt` file in its block, or no block at all, has no entry: the caller refuses it rather than guessing.
 *
 * @param text the raw listing
 * @returns each pid's executable path, for the pids the listing holds one for
 */
export function parseExecutables({ text }: { readonly text: string }): ReadonlyMap<number, string> {
  const executables = new Map<number, string>();
  let pid: number | undefined;
  let awaitingImage = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = /^p\d+$/u.test(line) ? Number(line.slice(1)) : undefined;
      awaitingImage = false;
      continue;
    }
    if (line.startsWith("f")) {
      awaitingImage = line === "ftxt" && pid !== undefined && !executables.has(pid);
      continue;
    }
    if (line.startsWith("n") && awaitingImage && pid !== undefined) {
      executables.set(pid, line.slice(1));
      awaitingImage = false;
    }
  }
  return executables;
}

/**
 * Decode a `lsof -Fpf /dev/<tty>` listing into each pid holding that device open and WHICH descriptors it holds it
 * on: one `p<pid>` line per process, then one `f<fd>` line per descriptor. MEASURED on cmux 0.65.2: a
 * bare tab's tty is held by its shell alone (`p40171`, fds 0, 1, 2, 10, 14), its `login` holding no descriptor on
 * it, and a live tab's by its shell (`f0`, `f10`, `f14`), its `claude` and that `claude`'s shells. The descriptor
 * is the point: a shell started `exec /bin/zsh -i </tmp/feed` keeps fds 1 and 2 on
 * the tab's tty and reads its commands from the FIFO, so a typed line queues on the tty and reaches no reader. A
 * line that is neither a `p<pid>` nor a numeric `f<fd>` line is skipped, and a pid listed twice keeps every fd.
 *
 * @param text the raw listing
 * @returns each pid's descriptors on the device, in listing order
 */
export function parseTtyHolders({ text }: { readonly text: string }): ReadonlyMap<number, readonly number[]> {
  const holders = new Map<number, number[]>();
  let fds: number[] | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      fds = openBlock({ holders, line });
    } else if (/^f\d+$/u.test(line) && fds !== undefined) {
      fds.push(Number(line.slice(1)));
    }
  }
  return holders;
}

/**
 * Open the block a `p` line starts: the descriptor list of the pid it names, created on its first listing, or no
 * block at all when the line is not a `p<pid>` line, so the `f` lines under it attach to nothing.
 *
 * @param holders every pid's descriptors so far; a new pid is added here
 * @param line the `p` line
 * @returns the list the block's `f` lines push into, or `undefined` for a line naming no pid
 */
function openBlock({ holders, line }: { holders: Map<number, number[]>; line: string }): number[] | undefined {
  if (!/^p\d+$/u.test(line)) {
    return undefined;
  }
  const pid = Number(line.slice(1));
  const known = holders.get(pid);
  if (known !== undefined) {
    return known;
  }
  const fds: number[] = [];
  holders.set(pid, fds);
  return fds;
}
