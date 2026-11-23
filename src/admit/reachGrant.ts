/**
 * The RECORDED escape hatch for the production-facing half of the raw-command block — the "unless" for the
 * `production-cli` category in `./rawTools.ts`.
 *
 * ## Why this class does not take `SLOPWEAVER_ALLOW_RAW`
 *
 * Every other raw block here takes an env var, and that is the right shape for them: they refuse ONE risky
 * command whose damage is local and reversible — a dirty main checkout, a duplicated poll, a push to a
 * branch. The override is typed inline on the one re-run and the blast radius ends there.
 *
 * This class is different in kind. `twilio`, `stripe`, `vercel`, `heroku`, `supabase`, `fly` and `netlify`
 * reach systems whose mistakes are visible to a real person outside this organisation — a message sent, a
 * charge taken, a deploy promoted. The owner's rule on the browser door (`../browser/breakGlass.ts`) draws
 * exactly this line: an env var is the wrong shape when the rule is
 * "stop" rather than "be careful", because an exported variable is ambient — it survives for the life of
 * the shell and every later call inherits it silently — and it leaves nobody anything to read afterwards.
 *
 * So this class takes a journal line instead: it names the session, names the TOOL it opens, carries a
 * reason a human wrote, and EXPIRES. Taking three in an hour is a fact somebody can read later, which an
 * env var can never be.
 *
 * ## Deliberately its own domain
 *
 * This is a near-twin of `../browser/breakGlass.ts` and shares no type with it, per
 * `.claude/rules/error-handling.md`: that one is keyed on a browser PROFILE and answers "may this session
 * drive that Chrome", this one is keyed on a TOOL and answers "may this session reach that system". The shapes
 * rhyming is a coincidence of mechanism, not a reason to merge them — and a grant that opened both at once
 * is precisely the ambient off switch both files exist to avoid.
 *
 * Pure: lines in, the live grant out. The file lives in `./reachGrantStore.ts`.
 */
import { isRecord } from "../lib/parsers.js";

/**
 * How long one grant holds the production-facing block open.
 *
 * Matched to `BREAK_GLASS_WINDOW_MS` rather than picked independently: 30 minutes is already this
 * repository's measured answer to "long enough to finish the thing in flight, short enough that it cannot
 * become the rest of the day", and a second, different number would only invite the question of why. A
 * grant that outlived the task it was taken for is the ambient override this shape exists to avoid.
 */
export const REACH_GRANT_WINDOW_MS = 30 * 60 * 1000;

/** One recorded decision to reach a production-facing system directly, outside the door. */
export interface ReachGrant {
  /** The `CLAUDE_CODE_SESSION_ID` the grant was issued to — a grant is never transferable. */
  readonly claudeSessionId: string;
  /** The tool it opens, as the classifier names it (`twilio`, `stripe`, …). One grant is one tool. */
  readonly tool: string;
  /** Why the door could not carry this. Free text, written by whoever took the grant. */
  readonly reason: string;
  /** When it was taken. */
  readonly issuedAtIso: string;
  /** When it stops holding the block open. */
  readonly expiresAtIso: string;
}

/**
 * Parse one journal line.
 *
 * @param line one raw JSONL line
 * @returns the grant, or `undefined` for a blank, malformed or incomplete line
 */
export function parseReachGrantLine({ line }: { line: string }): ReachGrant | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const claudeSessionId = parsed["claudeSessionId"];
  const tool = parsed["tool"];
  const reason = parsed["reason"];
  const issuedAtIso = parsed["issuedAtIso"];
  const expiresAtIso = parsed["expiresAtIso"];
  if (
    typeof claudeSessionId !== "string" ||
    typeof tool !== "string" ||
    typeof reason !== "string" ||
    typeof issuedAtIso !== "string" ||
    typeof expiresAtIso !== "string"
  ) {
    return undefined;
  }
  return { claudeSessionId, expiresAtIso, issuedAtIso, reason, tool };
}

/**
 * Every grant a journal holds, dropping the lines that will not decode.
 *
 * A line that will not parse is skipped rather than failing the read: the journal is append-only and a torn
 * final write must not make an unrelated, valid grant invisible.
 *
 * @param text the journal's whole contents
 * @returns the decodable grants, in file order
 */
export function parseReachGrantJournal({ text }: { text: string }): readonly ReachGrant[] {
  return text
    .split("\n")
    .map((line) => parseReachGrantLine({ line }))
    .filter((grant): grant is ReachGrant => grant !== undefined);
}

/**
 * The grant, if any, currently opening one tool for one session.
 *
 * Matched on the tool EXACTLY, never by category: a grant taken to send one Twilio message must not also
 * open Stripe, and a category-wide grant is a standing permission nobody asked for.
 *
 * @param grants every grant in the journal
 * @param claudeSessionId the session the hook is judging
 * @param tool the tool the blocked segment names
 * @param nowIso the instant to judge expiry against
 * @returns the newest unexpired grant issued to that session for that tool, or `undefined`
 */
export function activeReachGrant({
  grants,
  claudeSessionId,
  tool,
  nowIso,
}: {
  grants: readonly ReachGrant[];
  claudeSessionId: string;
  tool: string;
  nowIso: string;
}): ReachGrant | undefined {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    return undefined;
  }
  const live = grants.filter((grant) => {
    const expires = Date.parse(grant.expiresAtIso);
    return grant.claudeSessionId === claudeSessionId && grant.tool === tool && !Number.isNaN(expires) && expires > now;
  });
  return live.at(-1);
}

/**
 * How many grants one session has ever taken for one tool — what a refusal quotes back so a repeat is
 * visible.
 *
 * Counts expired grants too, on purpose: the number a reader wants is how often this session has chosen to
 * reach past the door, not how many are live right now.
 *
 * @param grants every grant in the journal
 * @param claudeSessionId the session to count for
 * @param tool the tool to count for
 * @returns how many grants that session has taken for that tool
 */
export function reachGrantsTaken({
  grants,
  claudeSessionId,
  tool,
}: {
  grants: readonly ReachGrant[];
  claudeSessionId: string;
  tool: string;
}): number {
  return grants.filter((grant) => grant.claudeSessionId === claudeSessionId && grant.tool === tool).length;
}

/**
 * The refusal a `production-cli` segment gets, naming the tool, the prior grants, and the one command that
 * opens it.
 *
 * The escape command is spelled out in full rather than described, for the reason
 * `../hatch/render.ts` guarantees for every registered refusal: a refusal whose escape the reader has to go and
 * look up is a refusal that costs a context switch, and this repository has already shipped a block whose
 * named escape verbs refused the same thing.
 *
 * @param tool the blocked tool
 * @param grantsTaken how many grants this session has already taken for it
 * @returns the stderr text Claude Code shows the model
 */
export function reachGrantRefusal({ tool, grantsTaken }: { tool: string; grantsTaken: number }): string {
  const prior =
    grantsTaken === 0 ? "" : ` This session has already taken ${String(grantsTaken)} grant(s) for \`${tool}\`.`;
  return (
    `Slopweaver blocks raw \`${tool}\`: it reaches a production system whose mistakes are visible to someone ` +
    `outside this organisation, and no governed verb covers it yet.${prior}\n` +
    `THIS CLASS DOES NOT TAKE ${"SLOPWEAVER_ALLOW_RAW"} — an exported variable is ambient and traceless, which is the ` +
    'wrong shape when the rule is "stop" rather than "be careful".\n' +
    `TO PROCEED: \`slopweaver session reach-grant --tool ${tool} --reason "<why the door cannot carry this>"\`, ` +
    "then re-run. That is journalled against this session, names this one tool, and expires in 30 minutes."
  );
}
