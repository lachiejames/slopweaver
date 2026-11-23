/**
 * The four scoped reads the cold-seat verdict takes AFTER the graft, each over a handful of pids or one tty rather
 * than the whole machine, and each refused WHOLE when the tool exits non-zero: the image behind each shell off
 * `lsof -p` (`./executables.ts`'s `parseExecutables`), the tab's tty's input modes off `stty -g`
 * (`./ttyModes.ts`), every pid holding the tab's tty device open off `lsof /dev/<tty>` (`parseTtyHolders`), and each
 * prompt shell's process group beside its tty's foreground group off `ps -o pgid=,tpgid= -p` (`./processGroups.ts`).
 * The whole-table read they follow is `./inspect.ts`'s `readProcessTableWhole`; the checks they feed are
 * `../../sessions/coldExecutables.ts` and `../../sessions/coldTtyModes.ts`.
 */
import { execFileSync } from "node:child_process";

import { err, ok, type Result } from "../../lib/result.js";
import { parseExecutables, parseTtyHolders } from "./executables.js";
import { isTtyName } from "./processes.js";
import { type ProcessGroup, parseProcessGroups } from "./processGroups.js";
import {
  ProcessTableErrors,
  type ProcessTableExecutablesUnreadableError,
  type ProcessTableProcessGroupsUnreadableError,
  type ProcessTableTtyHoldersUnreadableError,
  type ProcessTableTtyModesUnreadableError,
} from "./processTableErrors.js";
import { parseTtyModes, type TtyModes } from "./ttyModes.js";

/** How long one read may block. A hung `lsof` must not hang the verdict a reseat stands on. */
const READ_TIMEOUT_MS = 30_000;

/** Ample for a few pids' descriptors; the whole-table read in `./inspect.ts` sizes its own. */
const MAX_BUFFER = 32 * 1024 * 1024;

/** Where macOS keeps `lsof`; `/usr/sbin` is not on every spawned process's `PATH`. */
const LSOF = "/usr/sbin/lsof";

/** Where macOS keeps `stty`, by absolute path like `lsof` so no `PATH` picks which one answers. */
const STTY = "/bin/stty";
/**
 * `ps` by absolute path too, never through `PATH`: a wrapper first on the path could answer the group read, and the
 * table read beside it, with a state the kernel does not hold.
 */
const PS = "/bin/ps";

/**
 * Read a tty's input modes, off `stty -f /dev/<tty> -g` (`parseTtyModes`): whether the kernel would hand a typed
 * line to the shell as a line, which no process read shows. A same-owner helper that set `icanon inlcr -icrnl` on
 * the tab's tty and exited leaves every process read a bare prompt while the resume line queues unentered. The read the cold-seat verdict takes AFTER the executables and before the tty
 * holders: `stty -f` opens the device for the one `TIOCGETA` and closes it on exit, so it is never a holder the
 * next read sees, and it reads the modes without touching the input queue. A tty name that is not a `ttys<N>`, a
 * missing device, a timeout or a line that is not a `gfmt1` line is refused whole.
 *
 * @param tty the tab's tty as `ps` names it, `ttys003`
 * @returns the tty's modes, or why the read failed
 */
export function readTtyModes({ tty }: { readonly tty: string }): Result<TtyModes, ProcessTableTtyModesUnreadableError> {
  if (!isTtyName({ tty })) {
    return err(ProcessTableErrors.ttyModesUnreadable({ cause: `${tty} is not a tty name`, tty }));
  }
  try {
    const text = execFileSync(STTY, ["-f", `/dev/${tty}`, "-g"], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: READ_TIMEOUT_MS,
    });
    return parseTtyModes({ text, tty });
  } catch (cause: unknown) {
    return err(ProcessTableErrors.ttyModesUnreadable({ cause, tty }));
  }
}

/**
 * Read the executable behind each of `pids` once, off `lsof -p <pids> -Fpfn` (`parseExecutables`): the image the
 * kernel mapped, which a process cannot name for itself the way it names its argv. The read the cold-seat verdict
 * takes AFTER the graft, over the forest's SHELLS alone, MEASURED at 71ms for two pids. `lsof` exits
 * non-zero when any pid it was given is gone, OR is another user's: a tab's `login` is root's, and asked for it
 * `lsof` printed the shell's block alone and exited 1 (MEASURED, `-p 40159,40171` exit 1, `-p 40171`
 * exit 0). Either is refused whole: a shell that exited between the table read and this one is not confirmed off
 * the others, and a caller passing a root pid refuses every real tab.
 *
 * @param pids the pids, none of which may be absent or another user's
 * @returns each pid's executable, or why the read failed
 */
export function readExecutables({
  pids,
}: {
  readonly pids: readonly number[];
}): Result<ReadonlyMap<number, string>, ProcessTableExecutablesUnreadableError> {
  if (pids.length === 0) {
    return ok(new Map());
  }
  try {
    const text = execFileSync(LSOF, ["-n", "-P", "-p", pids.map(String).join(","), "-Fpfn"], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: READ_TIMEOUT_MS,
    });
    return ok(parseExecutables({ text }));
  } catch (cause: unknown) {
    return err(ProcessTableErrors.executablesUnreadable({ cause, pids }));
  }
}

/**
 * Read every pid holding a tty DEVICE open and on which descriptors, off `lsof -Fpf /dev/<tty>` (`parseTtyHolders`):
 * a descriptor on the tab's tty is how a process reads what is typed there, and fd 0 is the one it reads commands
 * on. A `setsid`'d helper on no controlling tty that kept fd 0 on the tab's tty shows no `ps` column the tab's, and
 * a shell started `exec /bin/zsh -i </tmp/feed` shows every column a prompt shows while its stdin is the FIFO.
 * The read the cold-seat verdict takes AFTER the executables and before
 * the process groups. `lsof` exits 1 when nothing holds the device, and that is refused whole like a tty name that
 * is not a `ttys<N>`, a missing device or a timeout: a tab whose tty nothing holds is a tab whose shell is gone,
 * never one to type into. The listing is complete over the OWNER'S processes only: `lsof` run as the owner lists
 * no descriptor of a root process (the tab's own `login`, measured), so a root-owned reader already holding the
 * tty is a holder this read never sees. That is a stated residue of the whole verdict,
 * not a gap one more read closes: a root process on this machine can write the tty itself, and running the read
 * as root is access the fleet does not hold.
 *
 * @param tty the tab's tty as `ps` names it, `ttys003`
 * @returns each owner-readable pid's descriptors on `/dev/<tty>`, or why the read failed
 */
export function readTtyHolders({
  tty,
}: {
  readonly tty: string;
}): Result<ReadonlyMap<number, readonly number[]>, ProcessTableTtyHoldersUnreadableError> {
  if (!isTtyName({ tty })) {
    return err(ProcessTableErrors.ttyHoldersUnreadable({ cause: `${tty} is not a tty name`, tty }));
  }
  try {
    const text = execFileSync(LSOF, ["-n", "-P", "-Fpf", `/dev/${tty}`], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: READ_TIMEOUT_MS,
    });
    return ok(parseTtyHolders({ text }));
  } catch (cause: unknown) {
    return err(ProcessTableErrors.ttyHoldersUnreadable({ cause, tty }));
  }
}

/**
 * Read each of `pids`' process group and the FOREGROUND group of its controlling tty, off `ps -o pid=,pgid=,tpgid=
 * -p <pids>` (`parseProcessGroups`): a shell whose group is not its tty's foreground group is stopped with `SIGTTIN`
 * the moment it reads, so a typed line queues unread while every other column shows a prompt. The read the cold-seat verdict takes AFTER the tty holders and before the second
 * table read, over the prompt shells alone. `ps -p` exits 1 when any pid it was given is gone, and that is refused
 * whole like the executables read.
 *
 * @param pids the pids, none of which may be absent
 * @returns each pid's group pair, or why the read failed
 */
export function readProcessGroups({
  pids,
}: {
  readonly pids: readonly number[];
}): Result<ReadonlyMap<number, ProcessGroup>, ProcessTableProcessGroupsUnreadableError> {
  if (pids.length === 0) {
    return ok(new Map());
  }
  try {
    const text = execFileSync(PS, ["-o", "pid=,pgid=,tpgid=", "-p", pids.map(String).join(",")], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: READ_TIMEOUT_MS,
    });
    return ok(parseProcessGroups({ text }));
  } catch (cause: unknown) {
    return err(ProcessTableErrors.processGroupsUnreadable({ cause, pids }));
  }
}
