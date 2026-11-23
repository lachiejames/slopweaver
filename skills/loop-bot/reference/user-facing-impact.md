# User-facing impact: show what the customer saw

Bundled reference for the `loop-bot` skill. `src/live/turn/userFacingImpactGuidance.ts` is the code half: it
prints a short version of this into your `turn resume --dispatch <id>` pre-flight, and a matching clause into
the reviewer's packet, when the question carries one of the seven narrow phrases in `USER_FACING_IMPACT_KEYWORDS`
(`user-facing`, `customer impact`, `what did users see` and the rest), matched as whole words. Other wording,
"the impact on customers" say, prints no block on purpose: the table widens on the next measured miss. An ask
about what a customer saw follows this file whether or not the block printed. This file is the method and the
reason.

## The miss this exists for

On an incident with a third-party provider, the screenshots and links did not help, and the failures did not
look like failures from the customer's perspective. User-facing impact is asked for often, so the setup carries
this contract.

The rejected answer sent staff-app session replays, log panels and RUM error counts. What the owner
wanted, and had
glimpsed on the worker's own screen, was the customer's own customer-app replay paused on a red banner: "Something
went wrong loading this page. Pull down to retry." The worker had photographed that very frame, then led with the
staff sessions and called the customer's replay blank.

## The answer contract

- **Lead with the customer's own screen.** The lead evidence is the customer app's session replay, paused on the
  visible error UI, photographed fullscreen with the player's timestamp in frame, plus a labelled `link` run to
  that replay at that moment.
- **Internal surfaces corroborate, below it.** Staff or admin-app replays, RUM error counts, log panels and
  graphs explain WHY the customer saw it. None of them is what the customer saw, so none of them leads.
- **A silent failure is an answer.** If the backend failed and no customer saw an error state, say so plainly.
  Never put an internal screenshot where a customer one does not exist.
- **Count people, not events.** Distinct sessions, or distinct customers where the identity is proven. A pair of
  failed requests per page load is one visit, not two people.

## The method: copy first

1. **Find the copy.** Grep the client code for the error text the customer-facing component renders, the
   `description` of a danger alert, an empty-state message, a toast. That string is the search key. Read the
   condition around it too, so you know which failure renders it.
2. **Search RUM for it, in the customer app.** A tap on a banner is recorded as an `action` whose target text is
   the copy, and a view or error may carry it too:

   ```bash
   slopweaver datadog rum '@type:action "Something went wrong loading"' --from 15d --by @session.id,@geo.city,@usr.id
   ```

   Narrow to the customer application where the catalogue offers the facet. A hit in a staff app is a different
   answer. Zero hits for a string the owner remembers is worth saying: the words may differ from what the owner recalls,
   and the copy in the code is what to quote back.

3. **Open the replay at the action's own timestamp.** Read the raw event for its session, view and millisecond
   date, and open the replay with `from=<that ms>` rather than a recomputed time:

   ```bash
   slopweaver browser open --url '<datadog site>/rum/replay/sessions/<session>?applicationId=<app>&seed=<view>&from=<ms>'
   slopweaver browser read --session <id>
   slopweaver browser act --session <id> --do click --target <fullscreen ref> --observation <read id>
   ```

   `browser act` photographs the viewport its click leaves behind, which is the frame. `browser shot` has no
   adapter for a replay player, so it reports `unsupported-target` and cannot press fullscreen anyway.

4. **Record what you saw.** `slopweaver browser image-record --form <file.json>` names the image, what is on the
   phone screen, and that the target rendered. Keep the player's timeline in frame: a crop that loses the
   timestamp leaves the reader nothing to check the moment against.
5. **Tie it to the backend failure, and say how far you got.** The same user id on the failing request logs is
   what makes the banner THIS incident. A link in the chain you did not trace is a hedge in the answer, not a gap
   to paper over.

## Worked example

The banner copy came from one page of the customer app, rendered on any query error. The RUM action search found
a handful of sessions over a fortnight; one of them shared its user id with a few dozen third-party provider
not-found logs a minute earlier. That session's replay, opened at the action's millisecond and made fullscreen, showed
the banner over an empty page. That frame, its link and one line of cause were the answer; the log queries sat below as citations.
