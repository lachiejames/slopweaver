# The interactions, and what each one actually proves

Every row is one `slopweaver browser act --do <kind>`. All of them photograph the VIEWPORT afterwards and name
the picture in the receipt; a write-capable one also frames and photographs its own target BEFORE it runs, and
requires `--observation <id>` from a `read` — [seeing.md](seeing.md) is the whole of that. Walking down a long
page is `browser scroll`, there, rather than a whole-page picture.

| `--do`                             | needs                                                     | does                                                   |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `click` / `double-click`           | `--target <ref>`                                          | clicks the element                                     |
| `fill`                             | `--target`, `--value`                                     | replaces a field's whole value                         |
| `type`                             | `--value`, `--expect-focus <ref>`                         | types into the focused element, character by character |
| `select`                           | `--target`, `--value`                                     | chooses an option in a dropdown, by its label          |
| `check` / `uncheck`                | `--target`                                                | sets a checkbox or radio                               |
| `hover`                            | `--target`                                                | hovers, which fires the page's own handlers            |
| `press`                            | `--value`, `--expect-focus <ref>`                         | presses a key (`Enter`, `ArrowLeft`, `a`)              |
| `scroll`                           | `--value`                                                 | scrolls the wheel by that many units                   |
| `drag`                             | `--target` (from), `--value` (to)                         | drags between two elements                             |
| `upload`                           | `--target` (the file input), `--value` (an absolute path) | opens the page's chooser and answers it                |
| `download`                         | `--target`, `--out <file>`                                | clicks, waits for the file, copies it to `--out`       |
| `navigate`                         | `--value <url>`                                           | goes to a page; judged on the DESTINATION              |
| `back` / `forward` / `reload`      | —                                                         | history; never refused by the read-only rail           |
| `dialog-accept` / `dialog-dismiss` | —                                                         | answers a modal the page raised                        |

## How an interaction is AIMED, and the two refusals that come with it

The rule comes from a Slack incident — a click that missed the search field, then a blind `type`
and a `Return` that posted under the owner's name. Both halves are refused before they fire, never
photographed afterwards, and each fails closed.

**`--target` takes a ref and nothing else.** `playwright-core` tests a target against `/^(f\d+)?e\d+$/` and
treats anything else as a CSS selector for `page.$` — reproduce with
`grep -n 'f\\d+)?e\\d+' node_modules/playwright-core/lib/coreBundle.js`. A ref that has gone stale answers
`Ref f1e11 not found in the current page snapshot` before anything is touched; a selector that matches two
elements resolves to one of them with nothing to say which. The refusal is taken before any client starts, so
the page is untouched. Hatch: `SLOPWEAVER_ALLOW_BROWSER_RAW_SELECTOR=1`. A drag's drop element rides
`--value` and is checked the same way; `--value` on every other kind is text, and is not.

**A ref is checked against what it NAMED, not only whether it resolves.** A replaced document numbers its
refs from one again, so once it reaches your number the same ref names another element and the client would
act on it (measured on claude.ai's login: `f1e52` then `f1e40` for one field). The admission reads
the page again before dispatch, and every aimed ref — `--target`, a drag's `--value`, `--expect-focus` — must
carry the same role and name there as in the `read` you cited. A mismatch is `REF_NAMES_ANOTHER_ELEMENT`,
names both elements, and dispatches nothing; state (`[active]`, `[checked]`) and a field's value are not
compared. No hatch, like a stale observation: take a fresh `read` and aim from it. `src/browser/refIdentity.ts`
carries what it cannot see.

**`--do type` and `--do press` need `--expect-focus <ref>`, and the page is asked.** The client's `type` and
`press` take only text and a key — no element — so the characters go wherever focus is. Immediately before
dispatch the verb evaluates a fixed function against the ref you named and compares it to
`document.activeElement`, walking open shadow roots. A mismatch is refused and the refusal names what really
holds the cursor (`<div> role=textbox aria-label="Message to #dev-alerts"`). Focus the field first with
`--do click` or `--do fill`. Hatch: `SLOPWEAVER_ALLOW_BLIND_KEYSTROKE=1`, which is the right answer for a
page-level key — Escape to close a modal, a keyboard shortcut — where no element holds the cursor and none
should. `scroll` is deliberately NOT covered: a wheel acts on what is under the pointer, which a focus
assertion does not describe.

**That probe is the one use of the client's `eval`, and it is not an arbitrary-JavaScript verb.** The
function is a string constant in `src/browser/aim.ts`; the element travels as the client's own separate
target argument, exactly as it does for a click; nothing a caller types becomes source. It reads two
elements, truncates every string it returns to 120 characters, and returns.

**What it does not fence.** The probe and the keystroke are two commands, because the client's `press`
cannot take an element, so a page that moves focus in between is not stopped — the same non-atomicity the
read-only rail has, narrowed the same way and closed no better. The after-picture is what shows where the
characters actually went.

## And the aim is SHOWN, in the viewport, before the interaction fires

Every write-capable `act` scrolls its target into the viewport, photographs that viewport unmarked,
highlights the target, photographs the same viewport again, acts, and photographs the viewport the action
left behind. `browser aim` is the same pictures with no action; `browser scroll` walks a page a screen at a
time when what you want is below the fold. The whole account — the owner's rulings, the `--focus` gate, what
each step does to the owner's page and the one window none of it closes — is
[seeing.md](seeing.md).

## Which of these the read-only rail refuses

Everything except `navigate`, `back`, `forward`, `reload`, `dialog-accept` and `dialog-dismiss`. `hover` and
`scroll` ARE refused: the owner's rule is never to click
while on the JumpCloud URL, a hover fires the page's own handlers, and "this one only opens a menu"
is exactly the reasoning that ends with a click nobody meant.

The five that are allowed are each a decision rather than an oversight. A read-only page you could not leave
would be a trap; a navigation is judged on where it is GOING, not on where it is leaving; and a rail that
refused to dismiss a dialog would wedge the session on the very page it was protecting.

## What downloads can and cannot tell you

**MEASURED, twice:** `page.waitForEvent("download")` never fires over the extension relay
(`TimeoutError` at 20s, on a `data:` link and an `http` link alike) while the bytes land in `~/Downloads`
every time. The owner's Chrome performs the download itself, outside Playwright's control, so `download.saveAs()` is
unreachable here and every piece of Playwright documentation about it describes a browser Playwright
launched.

So `--do download` watches the download directory and picks the one new file whose size held still. Three
consequences, and they are the contract rather than caveats:

- Attribution is an **inference**, labelled `directory-observed` in the receipt. Never quote it as a browser
  confirmation.
- **Two new files settling at once is a refusal, not a guess.** A download the owner started personally lands in
  the same place and looks identical. Pass `--expect-name <file>` when you know the name.
- The browser's own copy is **left where it put it**. `--out` gets a copy, and an existing file there is a
  refusal rather than an overwrite.

## Two pages that need judgement rather than a rule

**The Vanta policy editor auto-saves.** Measured by the owner personally, with screenshots: the
content editor is at `app.vanta.com/c/<tenant>/policies/<policy-id>/edit?lang=...`, it has Auto-save on, and
one typed word is savable immediately. Its controls are Save and close plus Assign approver and submit, and
there is **no diff** — do not build anything that expects one. Two traps beyond that: the edit affordance is
the _Edit_ beneath the Assign-approver-and-submit button, NOT the "Edit" on the policy page (which opens a
details modal carrying only title and description); and Vanta is `read-before-write` rather than hard-fail by
the owner's ruling, so the rail will let a `type` through. On that page the read you cite is doing real work —
a stray keystroke mutates a compliance document with no confirmation step.

**Datadog organisation settings.** The owner's own example: the owner is an admin, so the verbs can reach delete
organisation, and obviously must not. Card it; never click it.

## What the read-only rail does not catch

The refusal is taken against the URL read off the live session immediately before the command goes out, and
nothing slow sits in between. It is still two processes, so a page that changes its own route between the two
is not fenced — a REPLACED document fails closed (the ref stops resolving, or resolves to an element the
admission refuses as `REF_NAMES_ANOTHER_ELEMENT`), and a same-document hash change does not. An action that ENDS somewhere that refuses writes is caught afterwards and reported as
`PAGE_MOVED_UNDER_ACTION`; one that routes away, acts and routes back inside a single click ends where it
started and is caught by nothing.

That last case needs the URL at the instant of the click, which is inside the browser. If a page is
adversarial enough to do it, the answer is to stop driving that page rather than to guard harder.

## What this relay still cannot do

Name these rather than discovering them mid-task. None is a verb that was forgotten; each is a boundary the
extension relay does not cross:

- Chrome's own settings pages, and the browser or OS permission prompts a page can raise.
- Hardware-backed authentication (a passkey, a security key).
- The system clipboard, OS drag-and-drop, and any handoff to another application.
- Closed shadow roots, which have no accessibility ref to aim at.

A task that needs one of these is a thing to say plainly, not to route around with a page script — there is
deliberately no arbitrary-JavaScript verb, and adding one would be a hole in the read-only rail rather than a
capability. The focus probe above is not one: its function is a constant in this repository and no caller
data reaches it.

## Text on a command line

A `fill` puts its `--value` on a command line, where a process listing on this machine can see it. That is
fine for a search box and wrong for a password. A credential belongs in the owner's own password manager, in the
owner's own browser; this lane never needs to know one.
