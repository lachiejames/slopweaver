/**
 * VISUAL EVIDENCE — the standing instruction that an answer whose proof is a PICTURE attaches the picture,
 * rendered into the composing session's own brief before the answer is written.
 *
 * ## The measured gap this exists for
 *
 * The owner expects more screenshots in replies: a picture says a thousand words, and most replies carried none.
 *
 * Measured on one day's answers, through the real door rather than from the transcripts:
 * **10 answers posted, 0 carrying a single image, 8 of them linking at least one surface whose whole content
 * is a rendered picture** — a metrics/logs explorer query, a monitor page, a dashboard, a pull-request diff,
 * a CI run — **23 such links in total.** Every one of those was prose plus a reference link, so checking any
 * claim about a curve, a threshold or a diff meant leaving Slack, signing in and re-running the query.
 * Reproduce (a home with the day's ask records, and the workspace host in place of the placeholder):
 *
 * ```sh
 * jq -r 'select(.kind=="answered" and (.tsIso|startswith("<day>"))) | "\(.channel) \(.answerTs)"' \
 *   "$SLOPWEAVER_HOME/live/slack/asks.jsonl" | while read -r c t; do
 *   slopweaver slack read-thread "https://<workspace>.slack.com/archives/$c/p${t/./}" --json |
 *     jq --arg t "$t" '[.messages[]|select(.ts==$t)][0] |
 *       {img: (((.files//[])|length)+((.blockFileRefs//[])|length)),
 *        vis: ([..|strings|select(test("datadoghq[.]com/(logs[?]|metric/explorer|monitors/|dashboard)|/pull/[0-9]+/files|/actions/runs/[0-9]+"))]|unique|length)}'
 * done | jq -s '{answers:length, withImage:([.[]|select(.img>0)]|length),
 *                withVisualLink:([.[]|select(.vis>0)]|length), visualLinks:([.[].vis]|add)}'
 * ```
 *
 * ## Why this is guidance and not a gate
 *
 * The two artifact classes in `../../admit/requestedDeliverables.ts` are decidable from the QUESTION — an ask
 * that says "screenshot" must hand back images, and the door refuses one that does not. This is the inverse
 * and is not decidable there at all: whether the evidence is visual is a property of what the ANSWER ended up
 * standing on, discovered during the investigation, and an answer with no picture is usually right. So a
 * schema refusal here would fire mostly on correct answers — and the owner's instruction was to make images
 * the default where the evidence is visual, not to make an answer without one impossible.
 *
 * The recipe lane took the other road for a reason that does not transfer: `../../cli/commands/automation/slotPost.ts`
 * DOES refuse a text-only send, because a recipe card reports alert state and nothing else, so "is the evidence
 * visual" is answered by the lane rather than by the turn. A bot answer has no such shape.
 *
 * ## What this module does NOT do
 *
 * It does not CROP or ANNOTATE. Per [the partition](docs/constraints/partition.md) this plugin carries
 * already-produced files in the answer form's `images` and does neither of those to them.
 *
 * Item 3 below names the capture route, `slopweaver browser shot`. A wording that says "capture in a browser
 * you can watch, under whatever profile rule this device's own instructions set" names a session's own
 * tools, so a composer reads it as the Claude-in-Chrome extension. MEASURED: three sessions in one
 * morning reported a screenshot leg BLOCKED because `list_connected_browsers` returned `[]`, with the
 * Playwright extension relay attached to the same Chrome and filing PNGs the whole time. The owner's rule is
 * that the Playwright relay replaces Claude in Chrome for everything, so the doored-provider half of the same
 * item is enforced by that verb rather than only asked for here.
 *
 * ## The retraction: this brief must never tell a turn a doored page cannot be photographed, because that is false
 *
 * Item 3 once read *"Slack, GitHub, Linear, Notion and Vanta have doors and the verb refuses them"*, which
 * was TRUE only until a screenshot stopped being refused for having a door. The change that made it false
 * did not touch this file, and a later one that shipped `atlas vanta shot --control <id>` did not either.
 * What the verb actually does is `../../cli/commands/browser/shotCore.ts`'s `classifyShotTarget`, which asks the POLICY rather
 * than the door: `read-before-write` is photographed, and the refusing arm is **uninhabited in the register
 * today**, with all five doored providers `read-before-write`
 * (`../../admit/browserSurface.ts`, asserted in `unit/admit/browserSurface.test.ts`).
 *
 * The prose half caught it and this one did not, which is the whole lesson: `loop-bot/reference/visual-evidence.md`
 * says the verb photographs a doored provider. That file is a reference a turn may or may not load. These lines are printed into
 * EVERY composing brief (`./brief.ts`, `../../cli/commands/turn/resume.ts`), so the stale copy was the one
 * being read.
 *
 * MEASURED, and it is why this is a correction rather than a tidy-up: board row
 * `bot-answers-a-vanta-control-question-with`, a DM answered with a statement that it had no screenshot of
 * the Vanta control page because it had not run the browser walk. That turn was CORRECT on the tree it
 * answered on — and re-running the prompt later would produce the same sentence for a reason that had since
 * stopped existing. The owner's approach to proof is what makes the product distinctive.
 *
 * Retracting the false refusal does not touch the evidence-QUALITY preference beside it, and the two are
 * independent: `github read` is better evidence than a photograph of the same page whether or not a
 * photograph is available. The verb's own header says so.
 */

/**
 * The composing session's standing visual-evidence instruction — printed by the routing brief and by
 * `turn resume`'s LOAD mode, directly after the outbound size caps, so it arrives before the answer exists.
 *
 * Always renders, and takes no arguments on purpose: unlike a requested deliverable, nothing in the question
 * predicts whether the answer's evidence will turn out to be visual, so there is nothing to key on.
 *
 * @returns the lines, in order, ready to print
 */
export function visualEvidencePreflightLines(): readonly string[] {
  return [
    "VISUAL EVIDENCE — when the proof IS a picture, attach the picture. Default, not a nicety:",
    "  1. A claim about a curve's SHAPE, a threshold, a dashboard's state, a board's layout or a diff is one",
    "     the reader cannot check from prose plus a link — checking it means leaving Slack and re-running the",
    "     query. Capture that surface and put the file in `images` as an absolute path. Keep the",
    "     reference link as well: the image is the evidence, the link is where the reader goes next.",
    "  2. The judgement stays YOURS. A one-line factual answer, a value read off a field, evidence that is",
    "     code or a ticket state — none of those want an image, and attaching one is noise.",
    "     HOW MANY is yours too, and there is no count cap: a picture where it carries what the text cannot,",
    "     none that repeats the text. An answer naming eleven controls sends the eleven captures it names; a",
    "     one-dashboard answer sends one. The owner trusts a picture over prose, and pictures ride below the fold",
    "     (item 6), so the count never buys density above it.",
    "  3. THE capture route is `slopweaver browser shot --url <address> --out <file.png>`, which photographs",
    "     the page through the Playwright relay in the owner's own Chrome. It does NOT need the Claude-in-Chrome",
    "     extension, so `list_connected_browsers` returning [] is not a blocked screenshot leg — never report",
    "     one as such. It navigates and photographs only: a shot needing a click or typed text first is",
    "     `browser open`, `browser read` for a ref, then `browser act --do <interaction>`, which photographs",
    "     its own result. A PAGE SCRIPT is the one thing no verb runs — say so rather than reaching for the",
    "     retired extension, which the door refuses. It prints the state it hit (photographed, reached-not-photographed,",
    "     relay-unavailable, session-lost, navigation-failed, off-lease-origin, doored-provider,",
    "     output-in-checkout) — quote that word rather than reporting a silence. `--out` is never inside a",
    "     git checkout: write under $SLOPWEAVER_HOME/proof/<slug>/ or a scratchpad. Never sign in or switch",
    "     accounts to get a shot. Slack, GitHub,",
    "     Linear, Notion and Vanta have doors and the verb does NOT refuse them — the refusing arm is",
    "     uninhabited, so a doored page IS photographable. Reach for the door verb FIRST anyway, on evidence",
    "     quality rather than permission: `github checks` for a CI run, `github read` for a pull request,",
    "     `slack read-thread`, `linear read`, `notion read` — a run's status and a diff are TEXT, and text",
    "     beats a photograph of text. Vanta is the one with a picture route of its own: `atlas vanta shot",
    "     --control <id>` photographs ONE control at its own address and refuses an id the atlas cannot place,",
    "     `atlas vanta vulnerabilities --html` renders a screenshot-able findings list, and `atlas vanta render",
    "     [--out <path>]` publishes what the atlas ALREADY STORED — so `atlas vanta walk` is what puts a live",
    "     page in it first. Doorless surfaces are where the pictures live — a dashboard, a monitor, a logs or",
    "     metrics query — and this changes nothing about them. The verb resolves the recorded profile itself,",
    "     the one this device's own instructions set, so there is no profile for you to pick.",
    "  4. RECORD WHAT YOU SAW before attaching, or the send is refused: `slopweaver browser image-record",
    "     --form <file.json>` names the image, what is actually visible in it, whether the thing your claim",
    "     rests on had RENDERED (data / zero-results / unloaded / empty-panel), and your own passed/failed",
    "     call. It prints the { path, artifactDigest, receiptId } to paste into `images`. No record is a",
    "     refusal with a hatch (`hatch open unread-image`); a FAILED record has no hatch at all, as with two",
    "     full-page screenshots one of which was photographed before its panel loaded. Looking",
    "     is not enough on its own: the worker in that case DID read both pictures back and shipped them.",
    "  5. A capture that fails never holds a correct answer. Send it, and name the shot you could not take in",
    "     `grounding.evidence.couldNotSee`.",
    "  6. Doctrine rule 7 is unchanged: images ride BELOW the fold with the evidence, never above it, and they",
    "     never buy you a longer `lead` or a wider `index`.",
  ];
}

/**
 * The reviewer's clause about a screenshot that is NOT there — a ceiling, never a check.
 *
 * It exists because the pre-flight above raises the composer's default, and a reviewer reading only that
 * would start returning `incomplete` on answers that are correct and complete. The measurement behind this
 * ceiling is `../../admit/requestedDeliverables.ts`'s: six review rounds over two hours, spent on scope the
 * question never asked for.
 *
 * ## The half it used to cover and must not
 *
 * This was once the ONLY image clause in the whole review packet, so its ceiling applied
 * to a present picture as readily as to an absent one: "say so ONCE as a `low`-impact claim and move on …
 * never `broken` and never `incomplete` on that ground alone". That is right about a missing screenshot and
 * wrong about a 4032-pixel-wide one photographed before its panel rendered — and it is why round 4's
 * reviewer, which DID open the file, could not have escalated even had it noticed. A present picture is
 * `./reviewImageSection.ts`'s section 1c, which is a check and carries no ceiling at all.
 *
 * @returns the section's lines, in order
 */
export function visualEvidenceReviewLines(): readonly string[] {
  return [
    "## 1b. A screenshot that is NOT THERE is a note, never a round",
    "",
    "The composer is told to attach a picture when the evidence is visual — a curve's shape, a dashboard's",
    "state, a diff. If this answer stands on such evidence and carries NO image at all, say so ONCE as a",
    "`low`-impact claim and move on.",
    "",
    "It is never `broken` and never `incomplete` on that ground alone: an answer without a picture is usually",
    "right, and a capture can fail for reasons this packet cannot see. Only the question ASKING for a",
    "screenshot makes images a deliverable, and that case is section 1's, already checked by the door.",
    "",
    "**This ceiling is about ABSENCE and nothing else.** A picture the answer DOES attach is section 1c: open",
    "it, record what you saw, and an unreadable one, one whose panel had not rendered, or one cropped so the",
    "axes and query are gone is a `high`-impact finding that marks this verdict `broken`. The two clauses are",
    "separate on purpose: a reviewer that had opened the file could not escalate on what it saw when they were one.",
    "",
  ];
}
