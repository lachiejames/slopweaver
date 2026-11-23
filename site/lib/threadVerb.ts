/**
 * The one read the console takes BY ID rather than as a whole register: a Slack thread, for the panel that
 * draws the messages themselves, in thread context with a draft reply.
 *
 * The same door as `liveVerbs.ts` and `actVerbs.ts`: a literal argv, one slot, and the slot's value checked
 * against a strict shape before it becomes an argv element — a permalink or a `<channel>:<ts>` id, never a
 * flag, never a path. `store around` reads the LOCAL corpus (`src/store/probe/disclose.ts`), so this reaches
 * no provider; the second verb narrows the avatar roster to the thread's own authors.
 */

/**
 * A Slack permalink as Slack prints one — `https://<workspace>.slack.com/archives/<channel>/p<digits>` with
 * an optional `thread_ts` and `cid` query — or the corpus's own `<channel>:<ts>` id.
 */
const THREAD_ID_SHAPE =
  /^(?:https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+(?:\?(?:thread_ts=[0-9]+\.[0-9]+|cid=[A-Z0-9]+)(?:&(?:thread_ts=[0-9]+\.[0-9]+|cid=[A-Z0-9]+))*)?|[A-Z0-9]+:[0-9]+\.[0-9]+)$/;

/** A Slack member id as the roster prints one. */
const MEMBER_ID_SHAPE = /^[A-Z0-9]+$/;

/** How much of each message the read carries; a longer one says how long it really is and links out. */
export const THREAD_CHARS = 4000;

/**
 * Reading a thread is a local Postgres read and the roster is one file, but the read shares the machine with
 * the page's own polls. MEASURED: a seven-message channel thread took 10.0s alone
 * (`time slopweaver store around --id <permalink> --mode thread --chars 4000 --json`) and missed a 20s cap
 * while the workstreams page's board read ran beside it.
 */
export const THREAD_TIMEOUT_MS = 45_000;

/** What building the thread argv came to. */
export type ThreadArgv =
  | { readonly kind: "argv"; readonly argv: readonly string[]; readonly title: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * The `store around` argv for one thread, or the refusal.
 *
 * @param id the permalink or `<channel>:<ts>` off the request
 * @returns the literal argv, or why the id was refused
 */
export function threadArgv({ id }: { id: string }): ThreadArgv {
  if (id.length > 300 || !THREAD_ID_SHAPE.test(id)) {
    return {
      kind: "refused",
      why: "the thread id is not a Slack permalink or a <channel>:<ts> id; the console reads a thread only by one of those",
    };
  }
  const argv = ["store", "around", "--id", id, "--mode", "thread", "--chars", String(THREAD_CHARS), "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}

/**
 * The `identity avatars` argv for the thread's authors, or the refusal.
 *
 * @param ids the distinct Slack member ids the thread's records carry
 * @returns the literal argv, or why an id was refused
 */
export function avatarsArgv({ ids }: { ids: readonly string[] }): ThreadArgv {
  const bad = ids.find((id) => !MEMBER_ID_SHAPE.test(id));
  if (bad !== undefined) {
    return { kind: "refused", why: `${bad} is not a Slack member id` };
  }
  const argv = ["identity", "avatars", "--source", "slack", "--ids", ids.join(","), "--json"];
  return { argv, kind: "argv", title: `slopweaver ${argv.join(" ")}` };
}
