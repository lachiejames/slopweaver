# The `new-tab` step — the + opens the page chosen off its menu

Part of [`desktop e2e`](e2e.md). The tabs are modelled on Chrome's ([tabs](../../../desktop/docs/tabs.md)), and the +
after the last tab pops a NATIVE menu of the sidebar's pages, which no page Playwright drives can see or click — so a
unit test proves the strip sends the command, never that the menu opens or opens the page chosen.

The step wraps the test instance's own `Menu.prototype.popup` in its main process for its length, so the menu the
real + pops is kept as it pops, still shown natively. It presses the +, and exactly one menu must pop, offering every
sidebar page but the Queue in order, each visible, enabled and wearing its sidebar glyph. It then closes the menu and
clicks the Pull requests item through Electron's own `MenuItem.click`, and that must add exactly one tab, last, in
front, wearing ⇄, beside one new console page at `/pull-requests`, still so after a settle. Each break is named in
`NEW_TAB_BROKEN`; the judge is `src/desktop/e2eNewTab.ts`.

The wrap is undone and every kept menu closed before the step ends, and a wrap it cannot undo fails the step. It
photographs the strip beside its own photograph (`…-new-tab-strip.png`) and closes the tab it opened from the strip's
own close button.

**Residue.** The step tells the tab and the page apart, never ties one to the other: the strip draws no page address,
so a new tab whose icon disagreed with its own page while another window opened `/pull-requests` would pass. The strip
derives a tab's icon from its page's path (`tabIcon`), so only an app built to deceive the step reaches that.
A popped menu is kept by when it pops, never by what popped it, which holds because every walk launches a fresh
instance (`driveE2e`) and takes this step once in it: no earlier run's menu can be in the process. The step sees
only what happens before its settle (`SETTLE_MS`) ends, so a second menu the + popped later than that would pass.
Every page opened after the choice counts, closed again or not, and it must be exactly one, still open on `/pull-requests`; but the strip is read once a poll (`POLL_MS`) through
the settle, so a second tab that came and went between two reads would pass.

```bash
slopweaver desktop e2e --app <candidate> --only new-tab
```
