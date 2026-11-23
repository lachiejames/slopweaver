/**
 * The JOURNALLED escape hatch — a grant that names a session, carries a reason a human wrote, and expires.
 *
 * ## Whose ruling this is, and how narrow it is
 *
 * Every exception stands, both hatches, journalled on outbound only. So this lane covers the OUTBOUND rows
 * and nothing else. A repository or corpus hatch stays an ambient `SLOPWEAVER_ALLOW_*` variable, and that is
 * deliberate rather than an omission — `src/devLint/escapeHatch.ts` fails if an outbound row is ambient, and equally if
 * a non-outbound row quietly joins this lane.
 *
 * ## Why the outbound rows and not the rest
 *
 * An exported variable is ambient: it survives for the life of the shell, and every later call in that
 * session inherits it silently. For `SLOPWEAVER_ALLOW_DIRTY_TREE` that is a nuisance. For
 * `SLOPWEAVER_ALLOW_WALL` it means one deliberate decision to send a sixth message quietly authorises every
 * message that session sends afterwards — on a surface where the audience is a person rather than a file.
 * And it leaves no trace: nothing afterwards can say a rule about what the bot says out loud was ever
 * waived. `src/browser/breakGlass.ts` reached the same conclusion for the browser door first; this is
 * that shape, generalised to a register row.
 *
 * ## Two properties this file is built around
 *
 * **A grant is spent by TIME, not by use.** One window, then it is gone. Counting uses would need a
 * write on every read, and a hatch whose check mutates state is one a dry run cannot ask about.
 *
 * **The escape's own escape is never gated.** `slopweaver hatch open` takes no hatch of its own — a guard
 * whose block swallows the command its message names is a wedge rather than a gate
 * (`src/hatch/render.ts` is where that property is enforced, by always printing the override token).
 *
 * Pure: journal text in, the live grant out. The file lives in `./grantStore.ts`.
 */
import { isRecord } from "../lib/parsers.js";

/**
 * How long one grant holds an outbound hatch open.
 *
 * Thirty minutes, matching `BREAK_GLASS_WINDOW_MS` deliberately rather than by coincidence: both windows
 * answer the same question — long enough for the turn already in flight to finish the thing it was
 * refused for, short enough that it cannot become the rest of the session. A longer window is the ambient
 * variable this lane exists to replace, wearing a different name.
 */
export const HATCH_GRANT_WINDOW_MS = 30 * 60 * 1000;

/** One recorded decision to open one hatch, for one session, for one window. */
export interface HatchGrant {
  /** The register row this grant opens. One grant is one hatch — never a blanket. */
  readonly hatchId: string;
  /** The `CLAUDE_CODE_SESSION_ID` it was issued to. A grant is never transferable. */
  readonly claudeSessionId: string;
  /** Why this invocation is a legitimate exception. Free text, written by whoever took it. */
  readonly reason: string;
  /** When it was taken. */
  readonly issuedAtIso: string;
  /** When it stops opening the hatch. */
  readonly expiresAtIso: string;
}

/**
 * Parse one journal line.
 *
 * @param line one raw JSONL line
 * @returns the grant, or `undefined` for a blank, malformed or incomplete line
 */
export function parseHatchGrantLine({ line }: { line: string }): HatchGrant | undefined {
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
  const hatchId = parsed["hatchId"];
  const claudeSessionId = parsed["claudeSessionId"];
  const reason = parsed["reason"];
  const issuedAtIso = parsed["issuedAtIso"];
  const expiresAtIso = parsed["expiresAtIso"];
  if (
    typeof hatchId !== "string" ||
    typeof claudeSessionId !== "string" ||
    typeof reason !== "string" ||
    typeof issuedAtIso !== "string" ||
    typeof expiresAtIso !== "string"
  ) {
    return undefined;
  }
  return { claudeSessionId, expiresAtIso, hatchId, issuedAtIso, reason };
}

/**
 * Every grant a journal's text holds, malformed lines dropped.
 *
 * @param text the whole journal
 * @returns the decodable grants, in file order
 */
export function parseHatchGrantJournal({ text }: { text: string }): readonly HatchGrant[] {
  return text.split("\n").flatMap((line) => {
    const grant = parseHatchGrantLine({ line });
    return grant === undefined ? [] : [grant];
  });
}

/**
 * The live grant for one hatch and one session, or `undefined`.
 *
 * The LAST matching grant wins, so re-taking one extends the window rather than colliding with the earlier
 * record — which stays in the journal either way, because the point of a journal is that it keeps them.
 * A grant is live from its issue instant to its expiry: one dated ahead of `nowIso` (a clock rolled back, a
 * hand-written row) opens nothing until that instant arrives.
 *
 * @param grants every grant in the journal
 * @param hatchId the register row being opened
 * @param claudeSessionId the session asking
 * @param nowIso the current instant
 * @returns the live grant, or `undefined` when none is live (an unparseable `nowIso` included)
 */
export function liveHatchGrant({
  grants,
  hatchId,
  claudeSessionId,
  nowIso,
}: {
  grants: readonly HatchGrant[];
  hatchId: string;
  claudeSessionId: string;
  nowIso: string;
}): HatchGrant | undefined {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) {
    return undefined;
  }
  return grants.findLast((grant) => {
    const issued = Date.parse(grant.issuedAtIso);
    const expires = Date.parse(grant.expiresAtIso);
    const inWindow = !Number.isNaN(issued) && !Number.isNaN(expires) && issued <= now && expires > now;
    return grant.hatchId === hatchId && grant.claudeSessionId === claudeSessionId && inWindow;
  });
}

/**
 * Build one grant, expiring {@link HATCH_GRANT_WINDOW_MS} after it is issued.
 *
 * @param hatchId the register row being opened
 * @param claudeSessionId the session taking it
 * @param reason why this invocation is a legitimate exception
 * @param issuedAtIso when it is being taken
 * @returns the grant to append
 */
export function buildHatchGrant({
  hatchId,
  claudeSessionId,
  reason,
  issuedAtIso,
}: {
  hatchId: string;
  claudeSessionId: string;
  reason: string;
  issuedAtIso: string;
}): HatchGrant {
  return {
    claudeSessionId,
    expiresAtIso: new Date(Date.parse(issuedAtIso) + HATCH_GRANT_WINDOW_MS).toISOString(),
    hatchId,
    issuedAtIso,
    reason,
  };
}
