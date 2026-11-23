/**
 * The browser WRITE-POLICY REGISTER — which platforms a browser may be driven to write to, and what a write
 * there costs. The verdict vocabulary the browser-door journal speaks is `./browserVerdictVocabulary.ts`.
 *
 * Every host has an answer here. {@link WRITE_POLICY_REGISTER} is an explicit write list; a host absent from
 * it carries {@link UNREGISTERED_WRITE_POLICY}, which reads and refuses to click. The Playwright verbs read
 * it (`browser shot`, `browser inspect`, `src/browser/action.ts`'s per-page policy through
 * `./browserPagePolicy.ts`), and `src/__tests__/unit/admit/writePolicyRegister.test.ts` holds every atlas
 * descriptor's declared policy to it.
 *
 * ## Where the register came from
 *
 * It was written for the Claude-in-Chrome tripwire. A dispatched ask worker gathering
 * screenshot evidence opened the Slack web client in the owner's own signed-in Chrome, aimed a click at the
 * top-bar search box, missed, typed its search string into the CHANNEL COMPOSER and pressed Return. The
 * property that made it a class rather than a slip: **a browser signed in as the owner has no read-only
 * mode** — `screenshot` and `type` were the SAME tool. The extension is retired
 * outright (`./chromeRetirement.ts`), and the page-by-page engine that judged its calls against
 * this register was deleted as unreachable. The register survives
 * because the Playwright verbs that replaced the extension read it.
 *
 * ## The two categories
 *
 * A blanket write ban fits an incident and is the wrong answer forever. The better solution is an agent that
 * is capable but also uses good judgment, with good data on what it is judging. So there are two categories:
 * refusing every write-capable action, the right call for things like JumpCloud, Google Admin, CrowdStrike and
 * Cloudflare; and read before write, the right call for things like Vanta where the bot intends to perform
 * write operations.
 *
 * So every registered platform carries a {@link BrowserWritePolicy}, and **switching one is one word on its
 * own entry** — it should be relatively easy to switch a platform from one category to the other, following
 * the repo conventions.
 *
 * ## All five are read-before-write
 *
 * Vanta, Slack, GitHub, Linear and Notion are all in the read before write category.
 * So {@link WRITE_POLICY_REGISTER} is uniformly
 * `read-before-write` for those five — the whole ruling was four words on four entries, which is the
 * property the shape has to keep.
 *
 * ## The DEFAULT
 *
 * Everything above governs a platform this file names. What governs one it does NOT name — Twilio is
 * an example — would be nothing, and the measurement behind that is in
 * {@link UNREGISTERED_WRITE_POLICY}. The rule closes it: no atlas or integration can be undoored, and the
 * right policy must be enforced by default, because adding something with no policy brings in undefined
 * behavior.
 *
 * Two things follow, and the second is the one that makes this a mechanism rather than a value.
 *
 * - **The default is `refuse-every-write`, applied to every host the register does not name.** Reads still
 *   pass: by default a host is assumed read-only, only get requests allowed and no clicking or
 *   typing text into the page.
 * - **A platform cannot be added with no policy at all.** Every atlas descriptor declares a `writePolicy`
 *   (`src/atlas/kit/contract.ts`), required by the schema and by the type, so an atlas that omits one fails
 *   to compile and fails to parse rather than quietly inheriting anything; and
 *   `src/__tests__/unit/admit/writePolicyRegister.test.ts` fails when a descriptor claims a write policy
 *   this register does not grant. The reason is the design brief rather than a gloss: a silent fallback
 *   causes more pain later, because those mistakes compound and are difficult to pin down.
 *
 * **What is left open, deliberately unanswered here.** A better way to distinguish an
 * integration (read and write — Slack, Notion, Linear, GitHub) from an atlas (read-only by construction)
 * has no chosen name. Both words appear below meaning what they always did.
 *
 * ## What this register is NOT
 *
 * A briefing card once told the owner that the browser door refuses Vanta because it is a doored provider and
 * a hand-driven browser holds no grant, reads included. That is wrong, and was never this register's verdict.
 * Vanta is `read-before-write` here and was the
 * FIRST such entry. What was missing was a verb that could type: `browser/relaySession.ts`'s closed
 * operation union and `write vanta edit-policy-draft` are what close it, because the bot writes in Vanta.
 * The register is right; a lane exists to exercise what it permits.
 */
import { browserWriteRowsOf } from "../integrations/policyRows.js";
import { registeredIntegrations } from "../integrations/registry.js";
import type { BrowserPageRestriction } from "./browserPagePolicy.js";

/**
 * What a platform's own web client may be driven to do — the owner's two categories.
 *
 * `refuse-every-write` is for a platform there is no intent to write to from a browser at all;
 * `read-before-write` is for one the bot genuinely writes to, where the guardrail is having looked at the
 * page first rather than never touching it. Moving a platform between them is editing this one word on its
 * entry in {@link WRITE_POLICY_REGISTER} — nothing else in this file, or anywhere else, is keyed by
 * provider. That is what a change of category costs: one word per entry (four words on four entries when four
 * platforms moved together), and the canon that quotes them.
 */
export type BrowserWritePolicy = "refuse-every-write" | "read-before-write";

/**
 * What a host NOT in {@link WRITE_POLICY_REGISTER} may be driven to do.
 *
 * **The default is the owner's rule.** By default things refuse every write or anything that is potentially a
 * write, and a platform must be explicitly added to some other policy, structurally enforced, to change that.
 * A brand-new platform is assumed read-only: only get requests, no clicking or typing text into the page.
 *
 * Without this constant the absence would BE the behaviour: a tripwire that allows any call on a host the
 * register does not name allows a click, a keystroke and a `javascript_tool` call on every unregistered console.
 * That is why this is a rule rather than a tidy-up: a session could read an unregistered administrative console
 * and then take a write-capable action on that tab, with no refusal anywhere and no record in the door ledger,
 * whose every record is a verb.
 *
 * Reads stay allowed on an unregistered host, and that is the rule rather than a softening: the whole
 * point of a read-only default is that reading is what an atlas walk does. What this refuses is the click.
 */
export const UNREGISTERED_WRITE_POLICY: BrowserWritePolicy = "refuse-every-write";

/**
 * One platform in the write-policy register: which hosts are its, what a write there costs, and whether a
 * `slopweaver` door replaces driving its web app at all.
 *
 * **`door` is nullable, and the null arm is a deliberate shape.** A door means a verb family
 * replaces the web client. Datadog has a write policy and no door: it is `read-before-write` (the SDLC metrics
 * are literally a post to Datadog, so writing there is real), while
 * every Datadog console walk in this repository reads pages no verb replaces. Fusing the two would silently
 * revoke read access nobody discussed — widening a guard on a question nobody asked, which is the failure
 * `read-before-write` was itself written to avoid.
 */
export interface RegisteredPlatform {
  /** The platform's name as the refusal says it. */
  readonly provider: string;
  /** Registrable hosts that belong to it — matched as the host itself or any subdomain of it. */
  readonly hosts: readonly string[];
  /** What the refusal tells the caller to use instead, or `null` when no verb family replaces this web app. */
  readonly door: string | null;
  /** Which of the owner's two categories this platform is in. One word to move it. */
  readonly policy: BrowserWritePolicy;
  /**
   * PAGES within this platform that are stricter than the row above them, or absent when none are.
   *
   * Some pages are read-only: the owner marks them so, and a click there throws a hard error, for instance
   * on the JumpCloud URL. The subject is a PAGE, not a host, so the rail has to be able to say "this path
   * of an otherwise writable platform refuses every write" — which a host-keyed register alone cannot.
   *
   * A restriction only ever TIGHTENS its own row: every arm is `refuse-every-write`, so a page entry can
   * never hand back access the host row withholds, and there is no ordering question to get wrong.
   */
  readonly pageRestrictions?: readonly BrowserPageRestriction[];
}

/**
 * **The explicit write list, and the whole of it.** Every platform this repository may write to from a
 * browser, and what that write costs. A host absent from here is governed by
 * {@link UNREGISTERED_WRITE_POLICY}, which refuses every write — so this array is now a permission list
 * rather than a coverage list, and its absences are decisions rather than gaps.
 *
 * Hosts are matched on the parsed hostname — equal to an entry, or a subdomain of one — never as a
 * substring, so `github.com.example.invalid` is a stranger rather than GitHub.
 *
 * **Who is here is the owner's word.** Vanta, Slack, GitHub, Linear and Notion are in the read before write
 * category, because those are the platforms the bot is meant to hold write capabilities on; Datadog joins
 * them for the reason its row gives.
 *
 * **`refuse-every-write` is the default every unregistered host gets, and JumpCloud's named row.** The arm
 * survives on the entry so that a platform which gains a door but must never be written to is one word
 * rather than a code change, which is the shape the owner wants.
 */
const WRITE_POLICY_REGISTER: readonly RegisteredPlatform[] = browserWriteRowsOf({
  // Each row is the `browserWrite` of its integration's manifest, and moving a platform between the two categories
  // is still one word, on that row. The reasoning for the rows stays here, beside the policy it argues.
  //
  // Vanta joined this list the moment `slopweaver write vanta deactivate` shipped — a write that stops monitoring
  // a security finding and records a reason against it, in a workspace an auditor reads. Rule 3 makes the
  // reads follow the write, and the same "screenshot and type are one tool" argument applies with more
  // force here than anywhere: the Vanta UI's own deactivate control is a dialog two clicks from the list a
  // capture would be aimed at. `vanta vulnerabilities --html` is what replaces the shot of that list.
  //
  // The door names `render` and `walk` alongside it, and that is the fix for a measured failure rather than a
  // tidy-up. A bot answer told the owner *"i could not photograph the vanta
  // computers page: vanta is a doored provider and browser shot refuses it"* — a confident wrong claim about
  // its own reach, while `slopweaver atlas vanta render --out <path>` sat one verb away. A string that named
  // `--html` for the vulnerabilities LIST and nothing at all for any other Vanta page leaves a caller reading it
  // correctly concluding there is no screenshot route beyond that one list. A door that names some of its own
  // alternatives reads as an exhaustive list of them, which is a defect and not a nicety.
  //
  // The wording is careful about WHAT render produces, because over-claiming here would just move the wrong
  // answer rather than fix it: `render` reaches Vanta not at all (`atlas/renderRun.ts`) — it publishes what a
  // sync and a walk already stored, embedding their screenshots under a budget. So `render` is the route to a
  // screenshot-able page of what is HELD, and `walk` is what photographs a live page into the atlas first.
  // Naming only render would tell the next caller it can photograph a page nobody has walked — measured on
  // an install where `atlas vanta render --json` reports zero screenshots because no walk has
  // filled that surface, so render alone would produce a page with no picture of Vanta in it.
  //
  // It says "reaching Vanta not at all" rather than "no network", and that is not pedantry on a door string.
  // The page `render` writes links `fonts.googleapis.com` (`atlas/kit/pageHtml.ts`), so OPENING it in the owner's real
  // Chrome makes three requests to Google. A door refusal is read at the exact moment an agent is being told
  // what its browser may reach, so "no network" there would be read as a property of the file it is about to
  // open — false, and false on the one surface where a browser is the subject.
  //
  // `shot --control <id>` is in the string because a shipped verb that no surface TELLS a composing turn about
  // does not get used: a turn saying it could not photograph a Vanta CONTROL page was the symptom. It leads the
  // string rather than trailing it because a control page is the one Vanta surface
  // an answer is most often asked about, and a reader takes the first named route as the answer.
  //
  // It is the FIRST `read-before-write` entry: Vanta is where the bot
  // is expected to perform a lot of write operations, so the guardrail there is having looked at the page
  // rather than never reaching it. Slack, GitHub, Linear and Notion sit alongside it.
  //
  // Datadog is the register's first entry with NO door. The bot does not post to Datadog from a console, but the
  // SDLC metrics post to Datadog every day, so writing there is real, and the console itself is
  // `read-before-write` for the reason that decides it: in Datadog a session sometimes types into a search field,
  // or clicks a drop down to run a seven day back test.
  //
  // `door: null` is what keeps that policy from costing read access. Every Datadog console lane here reads
  // pages no verb replaces, so a door would make a WRITE policy revoke reads nobody discussed.
  //
  // JumpCloud is the FIRST entry here that exists to refuse rather than to permit, and it is named rather
  // than left to the default for a reason the owner gave: certain pages are read-only, never write, JumpCloud
  // among them, and the browser must throw a hard error on a click while the tab is on the JumpCloud URL.
  //
  // Without this row the behaviour is correct and completely invisible: JumpCloud appears nowhere
  // in this file, so {@link UNREGISTERED_WRITE_POLICY} refuses its writes as a STRANGER. That is the right
  // answer for the wrong reason — a refusal that says "this host is not in the register" reads as an
  // oversight to the next session, and it would silently stop refusing the moment anyone added JumpCloud to
  // the register for a read lane. Naming it makes the refusal state the rule and makes the row survive.
  //
  // `door: null` because no `slopweaver` verb replaces the JumpCloud console; the atlas walks it and reads
  // are exactly what this row keeps. Vanta is deliberately NOT here: the bot writes in Vanta, so Vanta's
  // `read-before-write` row stands.
  manifests: registeredIntegrations(),
});

/**
 * Classify one URL against {@link WRITE_POLICY_REGISTER}.
 *
 * `undefined` means UNREGISTERED, which is a policy rather than a silence —
 * see {@link UNREGISTERED_WRITE_POLICY}. A URL that will not parse, or that carries no hostname
 * (`about:blank`, `chrome://newtab`), lands here too: there is no host to hold a policy, and no name a
 * refusal could use. A bare host with no scheme is accepted too, so a value that does not parse as an
 * absolute URL is retried as `https://<value>`.
 *
 * @param url the URL as the caller spells it
 * @returns the registered platform it belongs to, or `undefined` when it belongs to none
 */
export function classifyBrowserUrl({ url }: { url: string }): RegisteredPlatform | undefined {
  const host = hostnameOf({ url });
  if (host === undefined) {
    return undefined;
  }
  return WRITE_POLICY_REGISTER.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}

/**
 * Every platform name the register carries, so a drift test and a catalogue can read the list rather than
 * restate it.
 *
 * @returns the registered platform names, in register order
 */
export function registeredWritePlatforms(): readonly string[] {
  return WRITE_POLICY_REGISTER.map((entry) => entry.provider);
}

/**
 * The hostname of a URL — absolute, or bare with the protocol left off.
 *
 * @param url the raw value
 * @returns the lowercased hostname, or `undefined` when there is none to read
 */
function hostnameOf({ url }: { url: string }): string | undefined {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (host.length > 0) {
        return host;
      }
    } catch {
      // try the next spelling
    }
  }
  return undefined;
}
