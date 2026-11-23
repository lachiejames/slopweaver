/**
 * A path walked the way the kernel resolves it, for two questions a `stat` cannot answer. Which symbolic links does a
 * path pass through, and when did each last change: a link created or retargeted at an older target swaps what the
 * path holds while the target's own times stay old. And is a path that
 * `stat` calls `ENOENT` genuinely not there, or behind a link that dangles: `stat` reports both the same, and a
 * dangling `~/.claude` read as a machine with no memories at all.
 *
 * The walk goes one component at a time from a directory known to be link-free, never by normalising text:
 * `path.resolve` collapses `pivot/..` before `pivot` is followed, so a retargeted `pivot` the kernel does traverse went
 * unseen.
 */
import { lstatSync, readlinkSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, parse, sep } from "node:path";

/**
 * How many links one walk follows before it refuses, as the kernel refuses with `ELOOP`. Linux's own limit; darwin's
 * is lower, and a path past it already failed the caller's own `stat` before this ran.
 */
const MAX_LINK_HOPS = 40;

/** One component still to walk, and whether it came from a link's target rather than the path as written. */
interface Step {
  readonly part: string;
  readonly inLinkTarget: boolean;
}

/** How a walk ended: every component resolved, a component of the path itself missing, or a link's target missing. */
type WalkEnd = "resolved" | "absent" | "dangling";

/**
 * A path's components as steps, empty and `.` ones dropped and `..` kept for the walk to take physically.
 *
 * @param path the path to split
 * @param inLinkTarget whether these components are a link's target
 * @returns its steps, in order
 */
function stepsOf({ path, inLinkTarget }: { path: string; inLinkTarget: boolean }): Step[] {
  return path
    .split(sep)
    .filter((part) => part !== "" && part !== ".")
    .map((part) => ({ inLinkTarget, part }));
}

/**
 * `lstat` a component, a missing one answered rather than thrown.
 *
 * @param path the component's physical path
 * @returns its stats, or undefined when nothing is there
 * @throws on any failure but `ENOENT` — `ENOTDIR` and `EACCES` say a path will not read, never that it is absent
 */
function lstatOrMissing({ path }: { path: string }): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** A walk in progress: where it stands, what is left to take, and the ctime of every link followed so far. */
interface WalkState {
  /** Always a physical, link-free directory, so `..` from it is the kernel's `..`. */
  current: string;
  readonly remaining: Step[];
  readonly times: number[];
}

/**
 * Follow the link at `candidate`: record its ctime and splice its target's components in where it stood.
 *
 * @param candidate the link's physical path
 * @param ctimeMs the link's own ctime
 * @param path the path being walked, for the refusal
 * @param state the walk, advanced in place
 * @throws when the walk has already followed {@link MAX_LINK_HOPS} links
 */
function followLink({
  candidate,
  ctimeMs,
  path,
  state,
}: {
  candidate: string;
  ctimeMs: number;
  path: string;
  state: WalkState;
}): void {
  if (state.times.length === MAX_LINK_HOPS) {
    throw new Error(`ELOOP: more than ${String(MAX_LINK_HOPS)} links on ${path}`);
  }
  state.times.push(ctimeMs);
  const target = readlinkSync(candidate);
  state.remaining.unshift(...stepsOf({ inLinkTarget: true, path: target }));
  if (isAbsolute(target)) {
    state.current = parse(target).root;
  }
}

/**
 * Take one step of a walk.
 *
 * @param path the path being walked, for a refusal
 * @param state the walk, advanced in place
 * @param step the component to take
 * @returns how the walk ended when this step ends it, otherwise undefined
 * @throws when the component cannot be `lstat`ed, sits under a non-directory, or is one link too many
 */
function takeStep({ path, state, step }: { path: string; state: WalkState; step: Step }): WalkEnd | undefined {
  if (step.part === "..") {
    state.current = dirname(state.current);
    return undefined;
  }
  const candidate = join(state.current, step.part);
  const stat = lstatOrMissing({ path: candidate });
  if (stat === undefined) {
    return step.inLinkTarget ? "dangling" : "absent";
  }
  if (stat.isSymbolicLink()) {
    followLink({ candidate, ctimeMs: stat.ctimeMs, path, state });
    return undefined;
  }
  const underAFile = !stat.isDirectory() && state.remaining.length > 0;
  if (underAFile) {
    throw new Error(`ENOTDIR: ${candidate} is not a directory, on ${path}`);
  }
  state.current = candidate;
  return undefined;
}

/**
 * Walk a path from the root, a link's target spliced in where the link stood.
 *
 * @param path the path, a relative one taken from the working directory
 * @returns each link's own ctime in walk order, and how the walk ended
 * @throws when a component cannot be `lstat`ed, sits under a non-directory, or the walk follows more than
 *   {@link MAX_LINK_HOPS} links
 */
function walk({ path }: { path: string }): { readonly times: readonly number[]; readonly end: WalkEnd } {
  const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
  const { root } = parse(absolute);
  const state: WalkState = {
    current: root,
    remaining: stepsOf({ inLinkTarget: false, path: absolute.slice(root.length) }),
    times: [],
  };
  for (let step = state.remaining.shift(); step !== undefined; step = state.remaining.shift()) {
    const end = takeStep({ path, state, step });
    if (end !== undefined) {
      return { end, times: state.times };
    }
  }
  return { end: "resolved", times: state.times };
}

/**
 * The status-change instant of every link the kernel traverses to reach a path, a link only another link's target
 * passes through included.
 *
 * @param path the path whose links are wanted, a relative one taken from the working directory
 * @returns each link's own ctime in epoch milliseconds, in walk order; empty when the path passes through none
 * @throws when the path does not resolve whole — a component missing, under a non-directory or unreadable, a link
 *   dangling or more than {@link MAX_LINK_HOPS} of them — the caller's to report, never one with no links
 */
export function linkChangeTimesOn({ path }: { path: string }): readonly number[] {
  const walked = walk({ path });
  if (walked.end !== "resolved") {
    throw new Error(`ENOENT: ${path} does not resolve (${walked.end})`);
  }
  return walked.times;
}

/**
 * Whether a path is genuinely not there: a component of the path as written is missing, every component before it
 * resolving to a directory. A dangling link, a component under a file, or one that will not `lstat` is a path that
 * would not read, which is never the same thing.
 *
 * @param path the path to judge
 * @returns true only for genuine absence
 */
export function isGenuinelyAbsent({ path }: { path: string }): boolean {
  try {
    return walk({ path }).end === "absent";
  } catch {
    return false;
  }
}
