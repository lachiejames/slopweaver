# Reveal in Finder

A child page of the [desktop README](../README.md): the viewer bar's button that copies a local page out of the store
as one file and selects it in Finder, so it can be dragged into Slack. The policy is `pageReveal.ts`; the effect is
`pageRevealShell.ts`; the copy is `slopweaver page export` (`src/cli/commands/page/exportRun.ts`).

## Why

A page open in the browser cannot be dragged into Slack as an attachment; it has to be a file in Finder, and
navigating to its path by hand is the chore this button removes.

A page lives in the store's Storage and nowhere else ([published pages](../../docs/store/published-pages.md)), so
Reveal copies one out once, on demand. There is no folder on disk to reveal.

## What it does

The viewer (`/view`) draws **Reveal in Finder** at the right of its bar when it frames exactly one local page's own
file, `/api/page/<slug>/index.html` with no query or hash (`site/lib/inAppView.ts` `viewedPageSlug`). An image or
appendix beside a page, a docs page and any other served file get no button. A click copies the page out and opens
Finder with the copy selected. A refusal is written beside the button; nothing fails silently.

- **One file, its images inside it.** The copy is `<slug>.html`, every image the page loads carried in it as a
  `data:` URL, so the file dragged into Slack shows what the owner saw. A page file it still names and cannot carry
  (a CSS `url()`, a file the page does not serve) is reported by the verb, never dropped.
- **One copy at a time, and none kept.** Each reveal makes a private directory under the OS temp directory; the next
  reveal removes the previous copy and quitting the app removes the last one.

Only the desktop app's console window draws it, and only under a shell carrying `revealPageInFinder`. A browser
cannot reach Finder, so in Chrome the bar has no button, and an older shell draws none either.

## Least privilege

The page sends the slug only (`revealPageInFinder`, `slopweaver:reveal-page`), the same shape as the failure toast's
"Open in new tab". Main takes it only from the console window (`senderRole`: top frame, console origin, one of its
own tabs) and only as exactly one page's slug. Main names the file itself, inside the directory it just made, and
runs the served checkout's own `bin/slopweaver page export <slug> --out <file> --json`, which creates exactly that
file, owner-only, and refuses one that already exists. Finder is asked only when the export says it wrote that same
file. Refusals name the page, never a path, because a filesystem error's own message carries the owner's home.
