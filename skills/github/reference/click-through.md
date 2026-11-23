# The click-through: gold on a clickable surface

The detail behind [pull-requests](pull-requests.md) § proof grades.

**The rule.** Before merging, on the checked-out branch, spin up the Playwright browser against the running build, click the control,
check it opens the page you intend, fix until it does, then merge. A screenshot of the page in isolation proves the
page renders. It does not prove the control a reader clicks reaches it.

**What counts as clickable** is a path rule over the diff: a `.tsx` under `site/components/` (not `diagrams/`) or
`site/app/` (not the `(docs)` group), or anything under `desktop/src/`, never a test. It does not catch a `.ts`
hook, `site/lib/` or an API route, which can still change what a control does.

**Where it goes.** A C3 description has no click-through field: the screenshot of the page the control opened is
**Proof of the solution**, its one line saying which control was clicked on which build ("On this branch's build,
the Queue card's Open button opens the pull request."), `runBy` naming who clicked ([pr-forms](pr-forms.md)).
Upload it with `slopweaver github attach <file>` like any other proof image ([attachments](attachments.md)).

**How it is taken.** Run this branch's build, then drive the control with the [browser](../../browser/SKILL.md)
skill's Playwright verbs: take a session on the page, click, read where it landed, screenshot it. `localhost` is not
on the browser register, so the click is refused until a waiver names that one page: `slopweaver browser break-glass
--page <url> --reason "click-through of <PR> on its own branch build"`. The register deliberately does not name
`localhost`: it cannot tell a branch build from the owner's live console on `:3000`, where the owner's Queue answers are recorded,
or from any other local service. A per-page waiver is journalled and expires. A capture of the
console's or desktop app's OWN branch build is the real surface, so the "never a locally served page" rule on media
does not apply to it.

**A branch console runs on its own home.** Start it as `SLOPWEAVER_HOME="$(mktemp -d)" DOCS_SITE_PORT=<port> yarn
docs`, and never link anything into it: a branch console writing calls into the owner's live home, or into a home holding a
link, is refused, a relay from one into the owner's chair is refused from
any home, and every call it opens is stamped with where it was served from, so `talk unread` sets its speech aside
as not the owner's ([the rule](../../../docs/console/voice-context-and-calls.md)). A voice witness on `:3001`
once wrote two calls of synthesised speech into the owner's real call store before this existed.

**Where it is judged.** By the landing judgement, not a body gate: a C3 description publishes no grade, so CI's body
gate no longer refuses on it. Gold on a clickable diff still wants the click-through; without one the landing is
silver and gold is owed.

**The desktop app.** Two things drive it, and they prove different halves:

- **The console's pages, in CI.** `yarn test:e2e` (the `desktop-e2e` job, a worker of `build`) runs Playwright Test
  in Chromium over the console built from the branch, with a seeded throwaway home. It covers every page, a Queue
  card, Settings, the first-open landing on Setup, and the published-page viewer. It never sees the shell's own
  window, menu bar or native menus.
- **The shell itself, on the owner's Mac.** `slopweaver desktop e2e --app <the candidate build>` walks the real Electron app
  as a test instance ([what it walks](../../desktop/reference/e2e.md)), and is the click-through for a `desktop/src`
  change.

When that walk cannot run, for example during a call, the change merges silver and records gold owed:
`slopweaver gold owe <pr-url> --grade silver --would-be "<why>" --blocked-on "<what stopped the walk>"`.
