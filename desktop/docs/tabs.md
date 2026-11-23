# Tabs

A child page of the [desktop README](../README.md): the console window is a strip of tabs over one page per tab,
each with its own history, the Queue pinned first. The policy is `tabStrip*.ts` and `tabPages.ts`; the effect is
`tabsShell.ts`, `stripPaletteShell.ts` and `newTabShell.ts`; the strip's own page talks through `stripPreload.ts`.

## Why

The Queue lives in one tab, with a briefing opened ad hoc every now and then and a few tabs scattered for those; a
card's pull request or board link must never replace the Queue the owner is reading.

## What it does

**Where a tab opens.** Any link a page opens in a new window — every citation chip, a briefing — opens a new tab
after the one it came from, in front, or behind on a ⌘-click; the Queue's tab stays where the owner left it. A tab behind
that navigates to a bare document loads the viewer where it is, never coming to the front.

**The strip is Chrome's.** Every tab wears its page's icon, the glyph its section wears in the console sidebar
(`tabPages.ts` `tabIcon`), and a title truncated to the width the tabs share. A new tab reads as its link until its
page loads and gives its own title (a pull request's `owner/repo#N`); a briefing or other local page in the viewer
is named by its slug from the start (`tabTitle`). The + after the last tab opens a native menu
of the sidebar's pages, the Queue aside, and the one chosen opens last, in front.

**The Queue's tab is first, has no close and never moves**; the others close (their ×, a middle click, ⌘W) and drag
into a new order. The voice's card goes to the Queue's pinned tab, which the strip moves to, and ‹ goes back to
what it replaced.

**The keys are a Mac browser's**: ⌘1–⌘8 and ⌘9, ⌃Tab and ⌃⇧Tab, ⌘⇧] and ⌘⇧[, ⌘⌥→ and ⌘⌥←, ⌘[ and ⌘]. The strip's ‹
goes back in the tab, and from a tab's first page back to the tab that opened it, so a pull request opened off a
card always has a way back to the Queue (`backTarget`).

**The strip is a script-free page with a sandboxed preload** (`stripPreload.ts`); what it sends is parsed
(`parseTabCommand`) and taken only from it. It wears the console's look, the colours a tab's console page reports
(`parseStripTokens`, plain `oklch` only), on its sidebar (`stripPaletteOf`).

## Residues, named

- No limit on open tabs, each a live page.
- Until a page has reported a look the strip is a neutral grey per light or dark (`STRIP_GROUND`).
- The voice keeps the last page identity it was told, its open card with it, when the owner switches to a tab whose page
  has reported none (a holding page, a failed load, a page off the console).
- The menu bar's Reopen item loads over the tab showing.

A note's or the voice's console link opens here, never the owner's browser, the Queue in its pinned tab and never a second:
[note links](note-links.md).
