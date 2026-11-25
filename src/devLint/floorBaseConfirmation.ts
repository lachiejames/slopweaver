/**
 * Whether an all-zeroes comparison base really belongs to a NEW ref — the one case a gate that compares a branch
 * against its base may pass without comparing. Pure; `./gitAtCommit.ts`'s `resolveFloorBase` does the reads.
 *
 * An all-zeroes `SLOPWEAVER_COVERAGE_BASE_SHA` is what a push event that CREATES a ref carries in
 * `github.event.before`: there is no previous commit. Read from the environment alone it is also what anyone can
 * export by hand on a branch with years of history, and every comparison gate used to pass that unjudged. So the
 * zeroes count only when one of two pieces of evidence agrees the ref is new:
 *
 *  1. HEAD's raw commit object has no `parent` header — a root commit, which has nothing to compare against
 *     whatever the variable says. The RAW object, because a depth-1 checkout grafts HEAD parentless for history
 *     walks (`rev-list --parents` prints no parent there) while `cat-file commit` still prints its parent lines.
 *  2. The runner's own event payload is a `push` that created the ref (`created: true`, `before` all zeroes) and
 *     whose `after` is HEAD. That is the first push of a branch that already carries history — a fresh repository
 *     populated from an existing one — which arm 1 cannot see. It is read from `GITHUB_EVENT_PATH`, a file named
 *     by the environment: anyone who writes both that file and the variable can still forge it. What it closes is
 *     the one-variable bypass, not every bypass.
 *
 * Anything short of that is unconfirmed, and the caller fails rather than skipping.
 */

import { z } from "zod";

const ZERO_SHA = "0".repeat(40);

/** What the runner's GitHub event said, or why there is nothing to read. */
export type GithubEventRead =
  | { readonly kind: "missing"; readonly why: string }
  | { readonly kind: "read"; readonly name: string; readonly payload: unknown };

/** Whether the new-ref claim stood up, and the evidence or the gap either way. */
type NewRefConfirmation =
  { readonly kind: "confirmed"; readonly evidence: string } | { readonly kind: "unconfirmed"; readonly why: string };

/** The three push-payload fields that say a ref was created at a commit; every other field is ignored. */
const createdPushSchema = z.object({
  after: z.string().regex(/^[0-9a-fA-F]{40}$/),
  before: z.literal(ZERO_SHA),
  created: z.literal(true),
});

/**
 * Whether a raw commit object's HEADER names no parent. The header ends at the first blank line, so a message
 * line that happens to start `parent ` is never read as one.
 */
function isRootCommit({ headCommit }: { headCommit: string }): boolean {
  const end = headCommit.indexOf("\n\n");
  const header = end === -1 ? headCommit : headCommit.slice(0, end);
  return !header.split("\n").some((line) => line.startsWith("parent "));
}

/** Why the event payload does not show this ref created at HEAD, or `undefined` when it does. */
function createdPushGap({
  event,
  headSha,
}: {
  event: GithubEventRead;
  headSha: string | undefined;
}): string | undefined {
  if (event.kind === "missing") {
    return event.why;
  }
  if (event.name !== "push") {
    return `the GitHub event is \`${event.name}\`, not a push that created this ref`;
  }
  const parsed = createdPushSchema.safeParse(event.payload);
  if (!parsed.success) {
    return "the push event does not record a created ref (`created: true`, `before` all zeroes, `after` a full SHA)";
  }
  if (headSha === undefined) {
    return "HEAD's SHA could not be read to match the push event's `after`";
  }
  if (parsed.data.after.toLowerCase() !== headSha.toLowerCase()) {
    return `the push event created ${parsed.data.after.toLowerCase()}, not HEAD ${headSha.toLowerCase()}`;
  }
  return undefined;
}

/**
 * Decide whether an all-zeroes base belongs to a new ref: HEAD is a root commit, or the runner's push event
 * created this ref at HEAD. The root check runs first, so an unreadable event is irrelevant to a root commit.
 *
 * @param headCommit HEAD's raw commit object (`git cat-file commit HEAD`), or `undefined` when git refused
 * @param headSha HEAD's full SHA, or `undefined` when git refused
 * @param event the runner's GitHub event, or why there is none
 * @returns the evidence that confirmed it, or both gaps that left it unconfirmed
 */
export function confirmNewRef({
  headCommit,
  headSha,
  event,
}: {
  headCommit: string | undefined;
  headSha: string | undefined;
  event: GithubEventRead;
}): NewRefConfirmation {
  if (headCommit !== undefined && isRootCommit({ headCommit })) {
    return { evidence: "HEAD is a root commit", kind: "confirmed" };
  }
  const gap = createdPushGap({ event, headSha });
  if (gap === undefined) {
    return { evidence: "the push event created this ref at HEAD", kind: "confirmed" };
  }
  const head = headCommit === undefined ? "HEAD's commit object could not be read" : "HEAD has a parent";
  return { kind: "unconfirmed", why: `${head}, and ${gap}` };
}
