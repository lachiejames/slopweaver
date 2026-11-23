/**
 * The PAGE CHROME: the title, the font link, the stylesheet, and the one script the page carries.
 *
 * Taken from the published page rather than rewritten, because the shape reference fixes parts
 * of it as contract — `main` is `max-width: min(88vw, 140ch)` on the owner's ruling that the
 * page read too narrow and is more readable at 80-90% width, and `.need`, `.q` and
 * `dl.f` are the class names `../../briefing/reactNowCard.ts` parses a card out of. Changing one of those is
 * changing the contract, not restyling.
 *
 * `.act` is the autonomy ledger's own row class, and it is its OWN class rather than a reuse of `.ranked` or
 * `.mine` for a mechanical reason: `../../briefing/pageBudget.ts` counts `div.need` as an unfolded block and
 * `../../briefing/oneIndex.ts` counts the bands by their classes, so ten ledger rows wearing a counted class
 * would spend a budget measuring something else. `../../briefing/autonomyCheck.ts` reads `.act` back.
 *
 * `.belief` is the correction block's own row class, and it is its OWN class for the reason `.act` is:
 * `../../briefing/pageBudget.ts` counts `div.need` as an unfolded block and `../../briefing/oneIndex.ts`
 * counts the bands by their classes, so a belief row wearing a counted class would spend a budget
 * measuring something else. `../../briefing/ownerBeliefsCheck.ts` reads `.belief` back.
 *
 * `.quiz` is the quiz block's own row class, for the same reason `.belief` is.
 *
 * `--bad` is the page's ONE alarm colour and it is a new variable rather than a reuse of `--warn`, which is
 * the deliberate part. `--warn` is already the structural left rule on `.need`, `.direct`, `.quiz` and
 * `.step` — ordinary furniture on every page — so an alarm rendered in it would be the same colour as the
 * things it has to out-shout. It carries exactly one rule today, `.eyebrow .stale`, which states the age of
 * a half the page was built on when that half was too old to publish (the page looked stale;
 * `../../briefing/snapshotAge.ts`). Both values clear 4.5:1 against their own ground.
 *
 * `.step` is the hand-steps section's own row class, for the same reason `.quiz` is — and it carries the
 * same warn-coloured left rule, because a step waiting on the owner's hands and a question waiting on their
 * answer are the two things on this page that are blocked on the owner rather than in flight.
 *
 * A separate module because it is DATA, not logic: `./render.ts` is then all shape, and a file-size or
 * complexity gate reads it as the small thing it is.
 *
 * ## One stylesheet, one page
 *
 * It once carried a second title for the ranked-list page, deliberately over the same
 * stylesheet — that page showed the same `.mine` rows and the same `<details>` folds, so a second sheet
 * would have been a second set of answers to questions the gate had already decided. The page was then
 * folded into this one's react-now block and the second title went with it. The rows the owner reads look the
 * same as they did.
 *
 * ## NOTHING ON THIS PAGE SCROLLS SIDEWAYS
 *
 * A card whose fold carried a 1,661-byte scope line was hard to read and overflowed. A `code` run was
 * once `white-space: nowrap`, which made one long
 * unbroken token widen the page body itself — so on a phone or a narrow window every line on the page
 * offset sideways, not just the offending one. It is `overflow-wrap: break-word` now: a token that fits
 * still sits on one line (a sha reads exactly as it did), and one that cannot fit breaks rather than
 * pushing the document out. A paste block's `<pre>` is `pre-wrap` with `overflow-wrap: anywhere` and scrolls
 * VERTICALLY inside its own box, so a long value is contained rather than escaping.
 * `src/__tests__/unit/outbound/briefing/chrome.test.ts` reads both rules back off these bytes.
 *
 * ## The one script, and why it is delegated
 *
 * A paste block's copy button ({@link "./render.ts"}'s `renderPaste`) is wired by ONE listener on the
 * document rather than a handler per button: the renderer then emits no ids and no inline `onclick`, stays
 * pure, and a card that moves keeps its button. It reads the `<pre>` beside the button it was clicked
 * through, so the two halves cannot address the wrong block. Where `navigator.clipboard` is missing —
 * an insecure context, or a browser that refuses the permission — it selects the text instead and says so
 * on the button, because a copy control that silently does nothing is worse than one that hands the reader
 * a selection to press the shortcut over. `../../briefing/pageBudget.ts` and `../../briefing/shape.ts` both
 * strip `<script>` before they measure anything, so this costs no budget.
 */

/** The exact stylesheet every gated page in this repository renders with. */
const PAGE_STYLES = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  :root {
    --ground: #F2F4F1; --panel: #FFFFFF; --ink: #1A1F24; --ink-2: #454D55; --muted: #6F7882; --rule: #D9DED9;
    --accent: #2E4C8F; --accent-soft: #E3E9F6; --ok: #2E7D4F; --ok-soft: #E1F0E6; --warn: #9A5B0C; --warn-soft: #F7EBD3; --bad: #B3261E; --code: #E9ECE7;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #131619; --panel: #1B1F23; --ink: #E6E8E3; --ink-2: #B5BBB3; --muted: #8A929A; --rule: #2B3136;
      --accent: #94B0F2; --accent-soft: #1F2A40; --ok: #7FC796; --ok-soft: #1B2E22; --warn: #E1AA55; --warn-soft: #3A2C14; --bad: #F2836F; --code: #23282D;
    }
  }
  :root[data-theme="dark"] {
    --ground: #131619; --panel: #1B1F23; --ink: #E6E8E3; --ink-2: #B5BBB3; --muted: #8A929A; --rule: #2B3136;
    --accent: #94B0F2; --accent-soft: #1F2A40; --ok: #7FC796; --ok-soft: #1B2E22; --warn: #E1AA55; --warn-soft: #3A2C14; --bad: #F2836F; --code: #23282D;
  }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: "Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 17px; line-height: 1.5; }
  main { max-width: min(88vw, 140ch); margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
  h1, h2 { font-family: "Newsreader", Georgia, serif; text-wrap: balance; line-height: 1.15; margin: 0; font-weight: 600; }
  h1 { font-size: 2.2rem; }
  h2 { font-size: 1.35rem; margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--rule); }
  p { margin: 0; }
  .eyebrow { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .eyebrow .stale { color: var(--bad); font-weight: 700; }
  .sub { color: var(--ink-2); margin-top: .6rem; }
  code, .sha { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: .84em; background: var(--code); padding: .05em .35em; border-radius: 3px; overflow-wrap: break-word; }
  a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .need { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--warn); border-radius: 5px; padding: 1rem 1.15rem; margin-top: .9rem; display: grid; gap: .4rem; }
  .need .q { font-weight: 600; font-size: 1.08rem; }
  .need .lean { color: var(--ink-2); }
  .row { display: grid; grid-template-columns: 9rem 1fr; gap: .35rem .9rem; margin-top: .4rem; }
  .row dt { color: var(--muted); font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; padding-top: .2rem; }
  .row dd { margin: 0; }
  details { margin-top: .9rem; border: 1px solid var(--rule); border-radius: 5px; background: var(--panel); }
  summary { cursor: pointer; padding: .75rem 1rem; font-weight: 600; }
  details > div { padding: 0 1.1rem 1rem; }
  details ul { margin: .4rem 0 0; padding-left: 1.2rem; display: grid; gap: .3rem; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .6rem; margin-top: 1rem; }
  .fact { background: var(--panel); border: 1px solid var(--rule); border-radius: 5px; padding: .65rem .85rem; }
  .fact .k { font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .fact .v { font-size: 1.2rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .fact .d { color: var(--ink-2); font-size: .86rem; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  .need dl.f { display: grid; grid-template-columns: 6.5rem 1fr; gap: .3rem .8rem; margin: .3rem 0 0; }
  .need dl.f dt { color: var(--muted); font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; padding-top: .25rem; }
  .need dl.f dd { margin: 0; }
  .need .bg { color: var(--ink-2); }
  .need .wait { color: var(--muted); font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; font-weight: 600; }
  .need .age { color: var(--muted); font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
  figure { margin: .8rem 0 0; }
  figure img { max-width: 100%; display: block; border: 1px solid var(--rule); border-radius: 5px; }
  figcaption { color: var(--muted); font-size: .82rem; margin-top: .35rem; }
  .draft { border: 1px solid var(--rule); border-left: 3px solid var(--accent); border-radius: 5px; background: var(--accent-soft); padding: .8rem 1rem; margin: .8rem 0 0; }
  .draft-label { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  .draft-body { margin-top: .5rem; display: grid; gap: .5rem; }
  .draft-body p { margin: 0; }
  .mine { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--accent); border-radius: 5px; padding: .7rem .95rem; margin-top: .55rem; }
  .mine .q { font-weight: 600; }
  .mine .bg { color: var(--ink-2); font-size: .92rem; margin-top: .15rem; }
  .direct { background: var(--warn-soft); border: 1px solid var(--rule); border-left: 4px solid var(--warn); border-radius: 5px; padding: .75rem 1rem; margin-top: .9rem; }
  .await { background: var(--panel); border: 1px solid var(--rule); border-radius: 5px; padding: .65rem .95rem; margin-top: .55rem; }
  .await .bg { color: var(--muted); }
  .paste { border: 1px solid var(--rule); border-radius: 5px; background: var(--panel); margin: .8rem 0 0; overflow: hidden; }
  .paste-head { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .5rem .75rem; border-bottom: 1px solid var(--rule); }
  .paste-label { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .paste-copy { font-family: inherit; font-size: .78rem; font-weight: 600; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--rule); border-radius: 4px; padding: .25rem .7rem; cursor: pointer; white-space: nowrap; }
  .paste-copy:hover { border-color: var(--accent); }
  .paste pre { margin: 0; padding: .75rem; font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: .8rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 18rem; overflow-y: auto; overflow-x: hidden; }
  .ranked { background: var(--panel); border: 1px solid var(--rule); border-radius: 5px; padding: .5rem .95rem; margin-top: .35rem; }
  .ranked .bg { color: var(--muted); }
  .act { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--ok); border-radius: 5px; padding: .5rem .95rem; margin-top: .35rem; }
  .act .bg { color: var(--muted); }
  .act .steered { color: var(--ok); font-weight: 600; }
  .act .said { font-size: 1.02em; margin: 0 0 .55rem; padding-bottom: .5rem; border-bottom: 1px solid var(--rule); }
  .belief { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--accent); border-radius: 5px; padding: .5rem .95rem; margin-top: .35rem; }
  .belief .bg { color: var(--muted); }
  .belief .marks { margin: .35rem 0 0; color: var(--muted); font-size: .85rem; }
  .belief .marks .ol { font-weight: 600; color: var(--accent); }
  .quiz { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--warn); border-radius: 5px; padding: .5rem .95rem; margin-top: .35rem; }
  .step { background: var(--panel); border: 1px solid var(--rule); border-left: 4px solid var(--warn); border-radius: 5px; padding: .5rem .95rem; margin-top: .35rem; }
  .step .bg { color: var(--muted); }
  .quiz .bg { color: var(--muted); }
  ul.opts { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
  ul.opts > li { display: grid; grid-template-columns: 1.6rem 1fr; align-items: baseline; column-gap: .5rem; }
  ul.opts .ol { font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums; }
  a.raw { overflow-wrap: anywhere; word-break: break-word; }
  details details { margin-left: .6rem; border-left: 3px solid var(--rule); }
  details p + p { margin-top: .7rem; }
  details > div > p:first-child { margin-top: .6rem; }
</style>
<script>
  document.addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof Element ? target.closest("button.paste-copy") : null;
    if (button === null) { return; }
    const pre = button.closest(".paste").querySelector("pre");
    const copied = () => {
      button.textContent = "copied";
      setTimeout(() => { button.textContent = "copy"; }, 1500);
    };
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "selected — copy it";
      setTimeout(() => { button.textContent = "copy"; }, 3000);
    };
    if (navigator.clipboard === undefined) { select(); return; }
    navigator.clipboard.writeText(pre.textContent).then(copied, select);
  });
</script>`;

/**
 * The head one gated page renders with: its own title, then the shared stylesheet.
 *
 * Module-private, and the titles below are the only two callers, because nothing here escapes: a title is
 * DATA that ships in this file, never a value a form supplies, and keeping the function unexported is what
 * makes that true rather than merely documented.
 *
 * @param title the page's own `<title>`, which is also what a browser tab and an artifact gallery show
 * @returns the head markup, ready to sit above `<main>`
 */
function pageChrome({ title }: { title: string }): string {
  return `<title>${title}</title>\n${PAGE_STYLES}`;
}

/** The head the fleet briefing renders with. */
export const BRIEFING_CHROME = pageChrome({ title: "Fleet Briefing" });
