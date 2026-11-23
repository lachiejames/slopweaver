# A local address as a first-class subject

Every page the owner reacts to is addressed as `$SLOPWEAVER_HOME/pages/<slug>/index.html` (the owner's ruling)
and held in the store, never at that path, and this is what each piece of this tree does with that address.

## The shape, and where it is decided

One module owns it: `src/pages/url.ts`. A local page address is a `file:` URL, on this machine, whose path
ends `…/pages/<slug>/index.html`. `localPageSlug` reads the slug back out; `isLocalPageUrl` is the predicate
every consumer asks rather than spelling `startsWith("file:")` for itself.

The slug segment is decoded ONCE and then checked against the alphabet, so an address smuggling a separator
through an escape (`%2F`, `%2e%2e`) is not a local page rather than resolving somewhere outside the tree.

## The two lookups a local address would break, and how each keys it

Both were measured: neither raises an error, and a
test suite keyed on `claude.ai` URLs stays green over both.

**The ruling lookup** (`src/briefing/openArtifacts.ts`). `artifactValidity` answers `mark: "valid"` when no
state matches, so a key that misses a `file://` page reads it as STILL OPEN — the failure the ranked index
exists to close. `ledgerKeys` tries the URL and then `page:<slug>`.

There is deliberately **no short form** beside `page:<slug>`. The eight-character artifact alias exists
because a UUID is unreadable and the real ledger was measured carrying both spellings; neither is true of a
slug, which is already the readable name.

**The history key** (`src/outbound/briefing/freezeStore.ts`). A URL's LAST path segment is `index.html` for
every page, so keying on it would make each page overwrite the others' `latest.json`. `artifactKey` keys a
local page on its slug, and refuses a `file:` address that is NOT a local page rather than colliding.

## Recording a ruling about a page

```bash
slopweaver session-start lock-in \
  --item page:queue-decision \
  --against <the page's updatedIso, else its landedIso> \
  --proposed '<the ask the page put to the owner>' \
  --reply do --outcome approved-as-proposed
```

`--against` is when the PAGE last moved, never when the owner answered. `resolutionHolds` lapses a ruling the moment
the thing it was given against moves, which is what gives a republished page its mark back — so an
`--against` set to the answer's own instant would hold a ruling over a version the owner never saw.

Publishing records nothing about the owner. It writes a page; a ruling is the owner's, and arrives through the lock-in
ledger like every other one.

## The `open-pages.json` entry

The `url` is the local address.

```json
{
  "label": "Queue Decision",
  "url": "file:///Users/…/.slopweaver/pages/queue-decision/index.html",
  "ask": "Approve the proposed queue design.",
  "landedIso": "<UTC instant ending in Z>",
  "updatedIso": "<UTC instant ending in Z>"
}
```

Keep `landedIso` at the FIRST publish and move `updatedIso` on every republish. The ranked index orders the owner's
tabs by the first and lapses rulings against the second, so collapsing them loses one or the other.

Under `--open-page-cards` the same entry carries the card fields
`skills/supervisor/reference/open-page-cards.md` documents; the five above are what the ranked index needs.

## Supersession

A closing ruling (`dropped`, `rejected`) whose note names another page's address marks this one `superseded`
and links the replacement. `anchorsIn` (`src/sessionStart/standing.ts`) extracts `file:` addresses
alongside `http(s)` ones, and `supersededByUrl` admits a local page — changing either one alone buys nothing,
because the anchor has to be extracted before it can be judged.

## Where a local address is rendered as a link

Four predicates decide whether an address is followable or is shown as inert text, and all four admit a
local page:

| Where                             | What it decides                                    |
| --------------------------------- | -------------------------------------------------- |
| `src/briefing/yourList.ts`        | a row's `where` renders as a link, not as code     |
| `src/outbound/briefing/render.ts` | a bare address in prose is linkified as it renders |
| `src/briefing/bareRef.ts`         | a bare address left as plaintext is REFUSED        |
| `src/briefing/openArtifacts.ts`   | the ranked index's own entry                       |

The renderer and the gate have to agree, and their agreement is the property to preserve: the gate exists to
catch what the renderer cannot reach, so a scheme one links and the other does not flag is a hole, and one
the gate flags and the renderer cannot link is a page refused with no way to fix it.

A `file:` address that is not a local page — a log, a screenshot — is deliberately left as text by both. It
is a path somebody is discussing, not a link.

## What a local address does not reach

It is machine-local. Not the owner's phone, not another device, not a Slack card someone else clicks. Relative assets
resolve from the page's own directory, and remote fonts still load from the network — a local page is not an
offline one. State those limits in a card rather than routing around them.

## How the console opens one

The console serves `/api/page/<slug>/<file…>` out of the store, never the folder the address names. It asks
`slopweaver page read <slug> --presentation --json`, which prints every file the page serves with a short-lived signed
address, `not-found`, or `store-unreadable`; exit 0, 3 or 1. It writes nothing. The rules are in [published
pages](../../../docs/store/published-pages.md#serving-and-what-signing-is-for).
