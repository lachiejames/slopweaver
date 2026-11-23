# Two categories of doored provider, and what a write costs on each

Part of [The browser route: the owner's real Chrome, and nothing else](../browser-route.md).

**The owner's ruling**, on the same card as the Playwright steer. A blanket write ban fits while an incident is
fresh and is the wrong answer forever: the better answer is an agent that is capable and uses good judgement,
which needs good data on what it is judging. So there are two categories. One refuses every write-capable
action — right for platforms like JumpCloud, Google Admin, and possibly CrowdStrike and Cloudflare. The other is
read-before-write, for platforms like Vanta where the fleet does intend to write through the bot. Moving a
platform from one to the other is meant to be easy, as a typed record or discriminated union following the
repo's conventions.

So each entry in `WRITE_POLICY_REGISTER` carries a `policy`, and moving a platform between the two is
**editing that one word**. Nothing else anywhere is keyed by provider.

| policy               | who                                                                     | a write-capable action (`browser act`)                                    | a read  |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------- |
| `refuse-every-write` | **JumpCloud, and every host not in the register** — the owner's default | **refused**, unless a `break-glass --page` waiver names that exact page   | allowed |
| `read-before-write`  | Vanta, Slack, GitHub, Linear, Notion, Datadog                           | allowed only when it cites a look at the page the session is **still** on | allowed |

**`read-before-write` relaxes the write ban inside the door, and widens read access by nothing.** Every
browser read already goes through a `slopweaver browser` verb, which is the door (rule 3), so the change turns
on no question the owner was not asked.

What a write has to meet — each one a distinct way of acting on something unlooked-at:

1. it cites an observation — a look the session was actually shown (`actionNeedsObservation`,
   `src/browser/actionExecutor.ts`);
2. that look was of the URL the page is **still** on (`sessionObservationIsCurrent`,
   `src/browser/interactionSession.ts`), the ref it names still names the same element (`src/browser/refIdentity.ts`),
   and its session had not gone idle past `INTERACTION_SESSION_TTL_MS` when the command started
   (`src/cli/commands/browser/sessionShell.ts`).

## And then all five moved

The owner's examples named four platforms that are not doored at all (JumpCloud, Google Admin, CrowdStrike,
Cloudflare) and said nothing about the ones that are. Asked directly, the owner ruled that Vanta, Slack, GitHub,
Linear and Notion all sit in the read-before-write category.

So every doored platform is `read-before-write`, the conditions above are the whole of what a write to
one has to meet, and the ruling cost four words in the register — the property the owner asked the shape to have.

## And then a write to Vanta became a real verb

**A permission is worth nothing without a capability.** `pageTransport.ts` states as a property of its own
seam that it performs no click, no form submission and no request replay, so a page visit cannot type,
and a hand-driven browser is refused. A briefing card claiming the door refuses Vanta reached the owner, and the
owner rejected it twice: Vanta was among the first platforms the owner cleared for reading and writing, and was
never meant to be refused. It is not optional either — Vanta's Manage API has no policy-version operation at
all, so the browser is the only way to upload a new policy version. Asked which of two rulings stood, the owner
answered that the fleet writes in Vanta.

The shape:

- **`browser/relaySession.ts`** owns the lease, the attach, the client and the cleanup, and the thing
  that varies is a closed `RelayOperation` union it dispatches on. **A caller chooses an operation, never
  code.** There is no public raw-execution route into the owner's browser, and no selector, keystroke or page script
  can arrive from a caller that has not declared one in that union.
- **`BrowserPageTransport` keeps its no-click invariant**, and no atlas walk has a write capability. The
  write arms are reachable only through
  `browser/vantaPolicyEditor.ts` and `browser/vantaPolicyVersion.ts`, different interfaces with their own
  gates. The draft-edit arm refuses unless its transport was constructed with the digest of the exact
  substitution it is asked to make; the policy-version arm refuses only a transport constructed with no digest
  at all, so the door's hold in the verb is what gates its upload.
- **Two verbs call them.** `slopweaver write vanta edit-policy-draft` makes one exact substitution:
  `--dry-run` before the door, an approval digest over the editor address, both strings and the whole
  resulting text, and a `hold` that `$SLOPWEAVER_DOOR_OVERRIDE` cannot waive.
  `slopweaver write vanta upload-policy-version` drives the `vanta-policy-version-upload` arm: it starts a
  new version of one policy and attaches the markdown file rendered to a PDF, under the same kind of digest `hold`, and leaves the
  version a draft it never submits or publishes.
- **The editor AUTOSAVES**, so the external-write boundary is the keystroke, not the Save.

**A DOM read after a DOM write is not evidence that anything was written — MEASURED.** Selecting the matched
run and calling `document.execCommand("insertText", …)` reads green on every in-page signal — the editor's
`innerText` holds the substitution, `Save and close` clicks, the client navigates to the versions tab — and a
fresh read of the same editor moments later holds the ORIGINAL text: the editor keeps its own document model,
and autosave saves that. So the text goes in through `page.keyboard.insertText`, which
Playwright dispatches over CDP as a trusted `Input.insertText`, and success is reported only after the
editor has been REOPENED from scratch and re-read.

## And then the default was ruled

**A platform with no door is the one nothing else governs** — a guard that classifies its pages as belonging
to no provider allows a click and a keystroke on every one of them: a session can read an unregistered
administrative console and then take a write-capable action on that tab with no refusal fired and nothing in
the door ledger, because every record there is a `slopweaver` verb.

Asked which default an undoored platform should carry, the owner ruled that an undoored atlas or integration
must not be possible: the right policy is enforced by default, nothing can be added without one because that
brings in undefined behaviour, everything refuses every write or potential write by default, and moving a
platform to another policy is an explicit, structurally enforced addition.

**`refuse-every-write` is the answer for every host the register does not name**, and reads pass — the owner's
own default for anything new: assume read-only, GET requests only, no clicking or typing into the page. So
`WRITE_POLICY_REGISTER` is a permission list, not a coverage list, and its absences are decisions rather than gaps.

**The structural half is the part that makes it hold.** Every atlas descriptor declares a required
`writePolicy` (`src/atlas/kit/contract.ts`), so an atlas that omits one fails to compile and fails to
parse; `src/__tests__/unit/admit/writePolicyRegister.test.ts` discovers every atlas on disk and fails when
one claims a policy the register does not grant. The owner's reason is the design brief rather than a gloss: a
silent fallback or a silent proceed is where mistakes compound and become hard to pin down.

**What this costs, named rather than discovered.** A lane that legitimately needed to click something on an
unregistered console cannot, and the refusal offers no condition to satisfy — only the owner's word adding the
platform. Twilio is the live example: minting an API key there is a write, so that atlas surface is
unfilled permanently under this ruling rather than pending anything.

**One thing the owner left open, and it was not decided for the owner.** The owner asked for a better way to
distinguish an integration — something read AND written, like Slack or Notion — from an atlas, which is read-only
by construction. No name was chosen; both words still mean what they meant.

**What this costs, named rather than discovered.** The Slack missed-click shape — screenshot a Slack page, then miss the
click on it — is precisely the shape `read-before-write` allows, because the read it asks for is the one
that session had already taken. The incident is not closed by the category; it is closed by the door:
that session drove Claude in Chrome by hand, and **a hand-driven Claude in Chrome call is refused, reads
included** ([the retirement](retirement-and-aim.md)). Trading the rest for a capable agent is the owner's call,
made twice — once judging the tripwire fence too heavy-handed and accepting the risk, and again here.

A `navigate` counts as neither a read nor a write. Arriving at a page is not having looked at it, and
treating it as a read would let "open and immediately click" satisfy the whole rule.
