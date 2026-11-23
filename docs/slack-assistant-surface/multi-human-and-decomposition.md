# 8. Multi-human threads — the property the owner rates highest

Part of [The assistant/agent surface: what the irreversible toggle actually buys](../slack-assistant-surface.md).

**The agent container is single-user by construction. DOCUMENTED, and it follows from the placement rather than
from a restriction:** agent conversations "happen in the app's Messages tab, with threads shown in a timeline
above the composer". The Messages tab is a one-to-one DM between the app and one person. There is no
documented multi-person agent container, and no method in the [§ 3](native-chrome-and-methods.md#3-every-method-the-surface-exposes) enumeration takes more than one recipient.

**This does not take multi-human threads away, because they were never on that surface.** They are on the
channel `app_mention` path, which is what `src/live/listen/**` already implements, what an earlier proof run showed end to end,
and which Slack explicitly says continues to work ([§ 6b](search-and-toggle.md#6-what-the-toggle-changes-for-the-existing-bot)). So the honest framing is not "the toggle breaks
multi-human threads" — it is:

> **The agent surface and multi-human threads are two different products.** The toggle adds a private 1:1
> container; it does not upgrade the shared channel thread. Every native affordance the owner wants IN a shared
> thread — the thinking indicator, streaming, task cards, feedback buttons — is available on the channel path
> **now**, without the toggle ([§§ 3–4](native-chrome-and-methods.md)).

**One measured constraint sharpens this. PRIOR MEASUREMENT (an earlier run, not re-run here — see [§ 0](evidence-grades-and-label.md#0-what-this-run-was-allowed-to-touch-and-what-it-therefore-could-not-learn)):** streaming into
a channel requires `recipient_user_id` and `recipient_team_id`, whereas a DM does not. If that holds, a streamed
message in a shared thread is **addressed to one named person**, and how it appears to the other participants
is unknown. That is a first-class risk for the owner's highest-rated property and it is **UNVERIFIED** — the
experiment is one `startStream` into a real two-person thread, read back with `conversations.replies`.

Slack's own caution points the same way: "After the user sends a new message, calling
`assistant.threads.setStatus` on that thread automatically opens the thread to keep the conversation going. **If
you intend to reply in channel, do not use this method.**" **DOCUMENTED** — and it means the thinking indicator
may not be the right primitive for a shared channel thread, despite being scope-free.

## 9. What is NOT proven

Stated plainly, because this document's only value is that it can be trusted.

- **Nothing here is about appearance.** No client was driven, no screenshot taken, no block rendered. Every
  claim is about an API contract or a stored payload.
- **The badge.** Named as a placement ([§ 1](evidence-grades-and-label.md#1-what-produces-the-agent-label--and-why-no-api-can-tell-you)), not as a word. Whether a literal "Agent" string appears next to
  the app name is unverified and unreachable from any token this app holds.
- **Whether `chat.postMessage` accepts `task_card`/`plan` outside a stream** ([§ 4](native-chrome-and-methods.md#4-the-native-task-chrome-is-block-kit-and-it-is-available-right-now)). Validated, not posted.
- **Whether enabling `agent_view` on an app that never had `assistant_view` can be undone** ([§ 7](search-and-toggle.md#7-irreversible-versus-merely-awkward)) — and,
  underneath it, **whether the live app really has neither field**. `apps.manifest.export` needs an
  app-configuration token this repo does not hold, so the live `features` block was never read.
- **Whether the agent feature alters existing channel rendering.** Slack documents no such effect and the
  reference agent renders as a plain bot — but no app in this workspace could be shown to have the feature on,
  so there is no positive control. Absence of a documented effect is not a measurement.
- **Whether an `app_mention` carries an `action_token`** ([§ 5](search-and-toggle.md)).
- **Whether the `xapp-` Socket Mode token survives the reinstall** ([§ 6f](search-and-toggle.md#6-what-the-toggle-changes-for-the-existing-bot)).
- **Whether a reduced manifest actually revokes live scopes** ([§ 6a](search-and-toggle.md#6-what-the-toggle-changes-for-the-existing-bot)). Documented behaviour, not observed —
  observing it means doing it.
- **The paid-plan gate.** This workspace is on a paid tier and everything returned `ok`, so nothing was blocked
  in practice. Slack still documents that "some AI features require a paid plan, despite being visible in the
  app settings on any plan".

## Decomposition

Seven pieces. Each owns its own new files and is nameable as its own handover doc. There is exactly one shared
file across the whole set — `src/live/turn/poster.ts`, which A, B and C all enter through — and it is called
out below rather than hidden, because an undeclared shared file is how a fan-out turns into a merge conflict.

**What is already there, so no piece re-does it.** `src/live/turn/**` turns a tagged mention into a
checklist message posted in-thread and edited in place, rendered by `renderTodoBlocks` through the admit
door, and piece **A** (the thinking indicator) runs on top of that same checklist. [The
progress-UX update](progress-ux-update.md) has the call paths for both. The other pieces are additive to it,
and each names the one seam it would enter through.

**The namespace question, answered rather than assumed.** The brief assumed a new `src/live/assistant/**`.
The evidence supports that for the container pieces (**F**, **G**) — they parse different events, address a
different container and are gated behind a toggle that may never be thrown. It does **not** support it for
**A**–**D**: the thinking indicator, streaming, task cards and search are ordinary Slack capabilities reachable
under scopes already held, and they belong on the channel path the owner already has, which is the only path
where multi-human threads exist (§ 8). Forcing them into an `assistant` namespace would put the owner's
highest-rated property behind an irreversible click it does not need.

| #   | Piece                         | Owns (new files)                                                                                                                         | Depends on    | Golden proof                                                                                                       |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| A   | **Thinking indicator, wired** | `src/live/turn/status.ts` — the adapter from `src/outbound/assistant/status.ts` to the write seam; enters at `src/live/turn/poster.ts`   | none          | A real tagged turn in a real thread shows the indicator, and re-asserts before the 2-minute timeout expires        |
| B   | **Streaming lifecycle**       | `src/live/turn/stream/{contract,lifecycle}.ts`; enters at `src/live/turn/poster.ts`                                                      | none          | A real streamed answer in a real thread; `conversations.replies` read back showing the finalised blocks and footer |
| C   | **Task cards as blocks**      | none: the turn card keeps `todoBlock.ts`, since Slack refuses a `plan` block inside its chrome (`src/outbound/assistant/turnMessage.ts`) | none          | `chat.postMessage` with a `task_card` block returns `ok` and reads back as that block — the § 4 unverified claim   |
| D   | **Slack real-time search**    | `src/retrieval/slackSearch/{contract,rank}.ts`, `docs/security/data-flow.md` edit                                                        | none          | `slopweaver store read` cites a permalink for a passage that is provably absent from the local corpus              |
| E   | **Manifest drift repair**     | `templates/slack-app-manifest.{full,agent}.json`                                                                                         | none          | The committed manifest's scope list equals the live `x-oauth-scopes`, diffed by a test                             |
| F   | **Container events**          | `src/live/assistant/events/{appHomeOpened,appContext,messageIm}.ts`                                                                      | **E**, toggle | A real DM to the app in the Messages tab produces one typed turn request                                           |
| G   | **Titles + dynamic prompts**  | `src/live/assistant/threadMeta.ts`                                                                                                       | **E**, toggle | `assistant.threads.setTitle` returns `ok` where it returned `missing_scope` when measured                          |

**Concurrency — the output the coordinator needs.**

```
        ┌── A  thinking indicator ───┐
        ├── B  streaming lifecycle ──┤   all five start NOW, in parallel:
now ────┼── C  task cards as blocks ─┤   no toggle, no owner decision,
        ├── D  real-time search ─────┤   nothing waiting on anything
        └── E  manifest drift ───────┘
                                      │
                   E + the owner's click ──┬── F  container events
                                           └── G  titles + prompts
```

- **A through E have no dependency on anything** — not on the toggle, not on the owner, not on any open pull request.
  All five are startable today and D is the largest capability gain in the document.
- **A, B and C all enter the turn at `src/live/turn/poster.ts`**, which is the one file they share. That is the
  only ordering constraint in the set: whichever lands first defines the seam, and the other two follow it.
  Nothing else about them overlaps — each owns its own new files.
- **E is a hard prerequisite of the click**, not merely of F and G: pasting the manifest as it stands revokes
  the scopes D depends on ([§ 6a](search-and-toggle.md#6-what-the-toggle-changes-for-the-existing-bot)). Repair the templates before the owner is asked to paste anything.
- **F and G are the only pieces the irreversible toggle gates**, and they are the two smallest. That is the
  shape of the decision: the click buys a private 1:1 container and two methods, and everything the owner
  described wanting is in A–D, which do not need it.

That is the whole decomposition. Nothing [above](../slack-assistant-surface.md) it is a prerequisite for reading it, and nothing in it waits on
the question below.

## The question for the owner

Recorded, not answered, with `slopweaver handover ask`. The trade in numbers:

**Enable `agent_view` on the existing app** — buys the top-bar entry, the split-plane container, the app-thread
timeline, `setTitle` and `setSuggestedPrompts` (pieces F and G, the two smallest). Costs: a reinstall and a new
bot token; every workspace guest loses the app; every user hard-refreshes; the manifest must be repaired first
or four live scopes are revoked ([§ 6a](search-and-toggle.md#6-what-the-toggle-changes-for-the-existing-bot)); and **whether it can ever be undone on an app that never had
`assistant_view` is undocumented** ([§ 7](search-and-toggle.md#7-irreversible-versus-merely-awkward)). Buys nothing for multi-human threads, which are a different surface
(§ 8).

**A second app** — keeps the proven bot surface untouched by an unknown-reversibility toggle. Costs a second
identity, second credentials, a second install, a second `xapp-` token, and a second thing for teammates to
learn.

**Neither, for now** — pieces A–E deliver the thinking indicator, streaming, task cards, feedback buttons and
Slack's real-time search on the existing channel path, with no click at all.
