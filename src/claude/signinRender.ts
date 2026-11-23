/**
 * The two faces of one sign-in plan: the lines the walk prints, and the local page `claude signin --page` writes.
 *
 * Both render the SAME {@link SigninPlan}, which is the point rather than a convenience. The owner asked for
 * a command or a page; the answer was both, and the only way a page and a command can never disagree about
 * what green means is for neither to decide it. `signinPlan.ts` decides; this file renders.
 *
 * The page is written to disk rather than published, deliberately. A published page lives in one account's
 * gallery, and a sign-in moving accounts is exactly what makes a gallery unreachable — MEASURED,
 * when fourteen republished pages plus one more were left intact and unreachable from any seat on this
 * machine. A page about repairing sign-ins that goes dark when a sign-in moves is the wrong shape, so this
 * one is a `file://` document that costs no publish and works with the network down.
 *
 * It stamps its own read instant and says AS AT, because it is a frozen snapshot until the next `--page` run,
 * and a page that cannot say how old it is will eventually be believed when it should not be.
 *
 * Both {@link STATE_TAG} and {@link STATE_TONE} are exhaustive `Record<SigninRowState, …>` maps, which is why
 * a new state cannot reach one face and miss the other: the compiler refuses until both carry it. That is the
 * "neither of them decides" property above, enforced rather than remembered.
 *
 * ## That exhaustiveness covers a new STATE and does NOT cover a new FIELD
 *
 * Worth saying plainly, because the paragraph above invites the wrong inference. A new member of
 * {@link SigninRowState} cannot reach one face and miss the other — the compiler refuses. A new OPTIONAL
 * FIELD on `SigninRow` has no such property at all: either renderer compiles perfectly while ignoring it
 * forever. So the recency and deadline clauses below are built ONCE, by {@link signinRecencyClauses}, and
 * both faces render that one list; the guard that they keep doing so is a test over one fixed plan asserting
 * the same instants appear in the lines, in the page and in the `--json` document, not a compiler property.
 */
import { parseIsoMs } from "#lib/date.js";
import { renderAge } from "#lib/duration.js";
import { shellQuoteToken } from "#lib/shellCommandLine.js";
import type { LoginHint } from "./accountBinding.js";
import { planLabel } from "./config.js";
import type { SigninPlan, SigninRow, SigninRowState } from "./signinPlan.js";

/** How each state reads in a terminal row: a short tag, so a column of them scans. */
const STATE_TAG: Readonly<Record<SigninRowState, string>> = {
  duplicate: "DUPLICATE",
  "needs-sign-in": "NEEDS SIGN-IN",
  "rate-limited": "SIGNED IN, WEEK SPENT",
  "token-only": "TOKEN ONLY",
  unbound: "NOT ENROLLED",
  unverified: "UNVERIFIED",
  verified: "VERIFIED",
  "wrong-account": "WRONG ACCOUNT",
};

/**
 * The tag one row state reads as, for a surface that prints a sign-in state outside this renderer — `claude
 * watch`'s identity alarm — so a store reads `WRONG ACCOUNT` in the same words on both.
 *
 * @param state the row's decided state
 * @returns the terminal tag
 */
export function signinStateTag({ state }: { state: SigninRowState }): string {
  return STATE_TAG[state];
}

/** The longest tag, so the alias and tag columns line up without measuring at every call. */
const TAG_WIDTH = Math.max(...Object.values(STATE_TAG).map((tag) => tag.length));

/**
 * A row's plan as the owner reads it — the alias with its account beside it.
 *
 * @param row the row to label
 * @returns the label {@link planLabel} renders
 */
function rowLabel({ row }: { row: SigninRow }): string {
  return planLabel({ alias: row.alias, cell: row.account });
}

/**
 * The plans a sign-in would still repair, each named with its account.
 *
 * @param plan the planned walk
 * @returns the labels, in the walk's worst-first order
 */
function remainingLabels({ plan }: { plan: SigninPlan }): readonly string[] {
  return plan.summary.remaining.map((alias) => {
    const row = plan.rows.find((candidate) => candidate.alias === alias);
    return row === undefined ? alias : rowLabel({ row });
  });
}

/**
 * One row's readings as a compact suffix, empty when the store could not be read.
 *
 * @param row the row to render
 * @returns the readings, or an empty string
 */
function windowsSuffix({ row }: { row: SigninRow }): string {
  const windows = row.windows;
  if (windows === undefined) {
    return "";
  }
  const fable = windows.sevenDayFablePercent === undefined ? "" : ` · fable ${String(windows.sevenDayFablePercent)}%`;
  const fiveHour = windows.fiveHourPercent === undefined ? "" : `5h ${String(windows.fiveHourPercent)}% · `;
  return `  ${fiveHour}wk ${String(windows.sevenDayPercent)}%${fable}`;
}

/**
 * What the owner reads about how long ago this store was last signed in.
 *
 * The absent case is worded as a fact about the LOG rather than about the owner, and that is the whole care in this
 * function: every store on an install predating the log has no record, so "never signed in" would make the
 * feature's own first run read as a false claim about the owner.
 *
 * @param nowIso when this reading was taken
 * @param row the row to describe
 * @returns the clause
 */
function recencyClause({ nowIso, row }: { nowIso: string; row: SigninRow }): string {
  const recorded = row.lastSignInAtIso;
  if (recorded === undefined) {
    return "no sign-in recorded here yet — this log holds only sign-ins this verb performed";
  }
  const thenMs = parseIsoMs({ tsIso: recorded });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (thenMs === undefined || nowMs === undefined || thenMs > nowMs) {
    return `last sign-in recorded at ${recorded}`;
  }
  return `last sign-in ${renderAge({ ms: nowMs - thenMs })} ago (${recorded})`;
}

/**
 * What the owner reads about when they are next FORCED to sign this store in.
 *
 * The grant expiry is the instant past which no refresh works, so it is the only deadline worth printing; the
 * eight-hour access expiry is a cache-miss horizon and is deliberately not here ({@link SigninRow}'s own
 * fields say which is which). An absent instant reads as UNKNOWN, never as "no deadline".
 *
 * @param nowIso when this reading was taken
 * @param row the row to describe
 * @returns the clause
 */
function deadlineClause({ nowIso, row }: { nowIso: string; row: SigninRow }): string {
  const expiry = row.grantExpiresAtIso;
  if (expiry === undefined) {
    return "forced sign-in date unknown — this store's refresh grant expiry could not be read";
  }
  const expiryMs = parseIsoMs({ tsIso: expiry });
  const nowMs = parseIsoMs({ tsIso: nowIso });
  if (expiryMs === undefined || nowMs === undefined) {
    return `forced sign-in by ${expiry}`;
  }
  if (expiryMs <= nowMs) {
    return `forced sign-in OVERDUE — the refresh grant expired ${renderAge({ ms: nowMs - expiryMs })} ago at ${expiry}`;
  }
  return `forced sign-in by ${expiry} (${renderAge({ ms: expiryMs - nowMs })})`;
}

/**
 * The two clauses every row carries about recency and the next forced sign-in, built once so the terminal
 * lines and the page cannot describe the same store differently.
 *
 * @param nowIso when this reading was taken
 * @param row the row to describe
 * @returns the clauses, in reading order
 */
function signinRecencyClauses({ nowIso, row }: { nowIso: string; row: SigninRow }): readonly string[] {
  return [recencyClause({ nowIso, row }), deadlineClause({ nowIso, row })];
}

/**
 * The one caveat a forced-sign-in date needs, printed ONCE under the whole table rather than on every row.
 *
 * It is a known deadline and not a guarantee: past the grant expiry no refresh can work, but the credential
 * is not promised to survive until then — this fleet has hit unexplained `invalid_grant` deaths that force a
 * sign-in earlier. Repeated on five rows the sentence trains the eye past it, which is why it sits here.
 */
const DEADLINE_CAVEAT =
  "a forced-sign-in date is the deadline a refresh cannot beat, not a promise the credential lives that long — an invalid_grant can force one sooner";

/**
 * Whether any row carries a grant expiry, so the caveat is printed only where something needs it.
 *
 * @param plan the planned walk
 * @returns true when at least one row names a forced-sign-in date
 */
function anyDeadline({ plan }: { plan: SigninPlan }): boolean {
  return plan.rows.some((row) => row.grantExpiresAtIso !== undefined);
}

/**
 * The clause naming how many live plans are carried by a setup token over a signed-out store, empty when none
 * is.
 *
 * It sits in the HEADER rather than only in a row because the header is the sentence a reader takes away:
 * `5 of 5 live, 5 distinct account(s)` was true of five signed-out stores once and read as five
 * sign-ins (`signinPlan.ts` § A row grades TWO axes).
 *
 * @param summary what the whole walk concluded
 * @returns the clause, opening with a separator, or an empty string
 */
function tokenOnlyClause({ summary }: { summary: SigninPlan["summary"] }): string {
  if (summary.tokenOnly === 0) {
    return "";
  }
  return `, ${String(summary.tokenOnly)} on a setup token over a store holding no login`;
}

/**
 * The lines a sign-in status read prints.
 *
 * Each plan takes TWO lines: the graded one, and a continuation carrying recency and the next forced
 * sign-in. They are separate lines rather than one because the graded line is already a four-column scan and
 * the two new clauses are what the owner's own acceptance test asks for — burying them at the end of the
 * longest line on the surface would be shipping them without surfacing them.
 *
 * @param nowIso when the readings were taken — a plan is only ever as good as its own instant
 * @param plan the planned walk
 * @returns the header, two lines per plan, the verdict, and the deadline caveat when any row names one
 */
export function renderSigninLines({ nowIso, plan }: { nowIso: string; plan: SigninPlan }): readonly string[] {
  const { rows, summary } = plan;
  const header =
    `sign-in status as at ${nowIso} — ${String(summary.live)} of ${String(summary.configured)} live, ` +
    `${String(summary.distinctAccounts)} distinct account(s)${tokenOnlyClause({ summary })}`;
  const labelWidth = Math.max(0, ...rows.map((row) => rowLabel({ row }).length));
  const continuationIndent = " ".repeat(2 + labelWidth + 2);
  const body = rows.flatMap((row) => {
    const tag = STATE_TAG[row.state].padEnd(TAG_WIDTH);
    return [
      `  ${rowLabel({ row }).padEnd(labelWidth)}  ${tag}  ${row.detail}${windowsSuffix({ row })}`,
      `${continuationIndent}${signinRecencyClauses({ nowIso, row }).join(" · ")}`,
    ];
  });
  const verdict = summary.complete
    ? "  every configured plan is live, distinct and enrolled"
    : `  still to do: ${summary.remaining.length === 0 ? "nothing a sign-in repairs" : remainingLabels({ plan }).join(", ")}`;
  return [header, ...body, verdict, ...(anyDeadline({ plan }) ? [`  ${DEADLINE_CAVEAT}`] : [])];
}

/**
 * The exact command that signs one store in, with the store named INLINE on it.
 *
 * The `CLAUDE_SECURESTORAGE_CONFIG_DIR=` prefix is a safety property rather than a style: a shell that has
 * inherited a different store signs the owner into that one instead, and everything downstream still looks
 * correct. It is built here rather than typed by a caller so no surface can print it without the prefix.
 *
 * The store is shell-QUOTED for the same reason the prefix exists at all. A directory the register names is
 * an arbitrary string the owner chose, and an unquoted one carrying a space assigns the prefix its first
 * word and runs the rest as the command — so the sign-in lands in a store nobody named while the line still
 * reads as if it named one. `shellQuoteToken` leaves an ordinary path bare, so the common line is unchanged.
 *
 * @param email the address to pre-populate the account chooser with, when one is configured
 * @param storeDir the store this sign-in must land in
 * @returns the one-line command
 */
export function signinCommandLine({ email, storeDir }: { email?: string; storeDir: string }): string {
  const chooser = email === undefined ? "" : ` --email ${email}`;
  return `CLAUDE_SECURESTORAGE_CONFIG_DIR=${shellQuoteToken({ token: storeDir })} claude auth login${chooser}`;
}

/**
 * The line a sign-in prints as it launches: the command, and — when an address is pre-filled — where that
 * address came from, so a pre-fill out of the unverified `accounts.json` cache never reads as an enrolled one.
 *
 * @param hint the address to pre-fill and its source, when the plan has one
 * @param storeDir the store this sign-in must land in
 * @returns the one launch line
 */
export function signinLaunchLine({ hint, storeDir }: { hint: LoginHint | undefined; storeDir: string }): string {
  if (hint === undefined) {
    return `launching: ${signinCommandLine({ storeDir })}`;
  }
  const source = hint.source === "cache" ? "accounts.json cache — unverified" : "enrolled";
  return `launching: ${signinCommandLine({ email: hint.address, storeDir })} (${source})`;
}

/** How each state colours a row on the page. Semantic, and deliberately not the page's accent. */
const STATE_TONE: Readonly<Record<SigninRowState, string>> = {
  duplicate: "bad",
  "needs-sign-in": "bad",
  "rate-limited": "warn",
  // Warn, not bad: the plan is live and spendable on its token. `bad` is reserved for the states where the
  // plan cannot be used at all.
  "token-only": "warn",
  unbound: "warn",
  unverified: "warn",
  verified: "good",
  "wrong-account": "bad",
};

/**
 * Escape text for HTML so a detail string can never inject markup into the page.
 *
 * @param text the text to escape
 * @returns the same text, safe between tags
 */
function escapeHtml({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** The page's whole stylesheet, lifted out so the renderer stays a renderer. */
const PAGE_STYLE = `:root{--bg:#f4f5f7;--fg:#14181f;--dim:#6d7684;--line:#d6dae1;--card:#fff;
--good:#1c6b4e;--goodbg:#d9ece4;--bad:#8a3a2a;--badbg:#f4dfd9;--warn:#8a5a12;--warnbg:#f7e6c8}
@media(prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#eef1f5;--dim:#838d9b;--line:#2d333c;--card:#1b1f26;
--good:#5cc79a;--goodbg:#143226;--bad:#e08b74;--badbg:#3a1e17;--warn:#d9a441;--warnbg:#332915}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 ui-sans-serif,system-ui,sans-serif;padding:2.5rem 1.25rem}
main{max-width:60rem;margin:0 auto;display:flex;flex-direction:column;gap:1.25rem}
h1{font-size:1.5rem;margin:0;letter-spacing:-.02em}
.stamp{color:var(--dim);font-size:.8rem;font-family:ui-monospace,monospace}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line)}
table{border-collapse:collapse;width:100%;min-width:40rem;font-size:.9rem}
td{padding:.7rem .9rem;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
td.a{font-weight:600;white-space:nowrap}
td.n{font-family:ui-monospace,monospace;color:var(--dim);white-space:nowrap}
.pill{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.08em;padding:.2em .55em;border-radius:2px;white-space:nowrap}
.pill.good{background:var(--goodbg);color:var(--good)}
.pill.bad{background:var(--badbg);color:var(--bad)}
.pill.warn{background:var(--warnbg);color:var(--warn)}
.verdict{font-weight:600}
.note{color:var(--dim);font-size:.85rem}`;

/**
 * One plan's row as a table row.
 *
 * The recency and forced-sign-in clauses sit under the detail rather than in a column of their own, so the
 * page carries exactly the strings {@link renderSigninLines} prints for the same plan.
 *
 * @param nowIso when the readings were taken
 * @param row the row to render
 * @returns the escaped `<tr>`
 */
function pageRow({ nowIso, row }: { nowIso: string; row: SigninRow }): string {
  const tone = STATE_TONE[row.state];
  const tag = escapeHtml({ text: STATE_TAG[row.state] });
  const detail = escapeHtml({ text: row.detail });
  const readings = escapeHtml({ text: windowsSuffix({ row }).trim() });
  const recency = escapeHtml({ text: signinRecencyClauses({ nowIso, row }).join(" · ") });
  return (
    `<tr class="${tone}"><td class="a">${escapeHtml({ text: rowLabel({ row }) })}</td>` +
    `<td><span class="pill ${tone}">${tag}</span></td>` +
    `<td>${detail}<div class="note">${recency}</div></td><td class="n">${readings}</td></tr>`
  );
}

/**
 * The one sentence under the table saying whether the walk is finished.
 *
 * @param plan the planned walk
 * @returns the escaped verdict
 */
function pageVerdict({ plan }: { plan: SigninPlan }): string {
  const { summary } = plan;
  if (summary.complete) {
    return "Every configured plan is live, distinct and enrolled.";
  }
  const rest =
    summary.remaining.length === 0
      ? "nothing a sign-in repairs"
      : escapeHtml({ text: remainingLabels({ plan }).join(", ") });
  return `Still to do: ${rest}.`;
}

/**
 * The local status page — option B, rendered over the same plan the walk uses.
 *
 * Self-refreshing, so an open tab picks up the next `--page` run; and stamped with its own read instant, so
 * between runs it announces its age rather than looking current.
 *
 * @param nowIso when the readings were taken
 * @param plan the planned walk
 * @param refreshSeconds how often the open tab re-reads the file
 * @returns the whole document
 */
export function renderSigninPage({
  nowIso,
  plan,
  refreshSeconds,
}: {
  nowIso: string;
  plan: SigninPlan;
  refreshSeconds: number;
}): string {
  const { rows, summary } = plan;
  const cells = rows.map((row) => pageRow({ nowIso, row })).join("\n");
  const caveat = anyDeadline({ plan }) ? `<p class="note">${escapeHtml({ text: DEADLINE_CAVEAT })}</p>` : "";
  const counts =
    `${String(summary.live)} of ${String(summary.configured)} live · ` +
    `${String(summary.distinctAccounts)} distinct account(s)${tokenOnlyClause({ summary })}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${String(refreshSeconds)}">
<title>Plan sign-ins</title>
<style>
${PAGE_STYLE}
</style></head>
<body><main>
<h1>Plan sign-ins</h1>
<p class="stamp">as at ${escapeHtml({ text: nowIso })} · ${counts}</p>
<div class="wrap"><table>
${cells}
</table></div>
<p class="verdict">${pageVerdict({ plan })}</p>
${caveat}
<p class="note">This page is a snapshot written by <code>slopweaver claude signin --page</code>. It re-reads this file every ${String(refreshSeconds)}s; only another <code>--page</code> run writes fresh readings. If the instant above is old, rerun the command. Each plan names the address its ENROLLMENT bound to the account now in its store, so a plan reading <code>unverified cache</code> has an address in <code>accounts.json</code> that nothing has checked — <code>slopweaver claude signin --reenroll &lt;plan&gt;</code> binds it. No organisation id appears here.</p>
</main></body></html>
`;
}
