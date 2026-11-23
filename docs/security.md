# Security & trust

Slopweaver is built local-first on purpose: the biggest objection to any tool that ingests company
data is "where does my data go". The answer for the core product is: nowhere you don't already send it.

**Two capabilities are different and say so plainly, and both reach OpenAI — on a ChatGPT plan, never
platform.openai.com.** The optional `slopweaver
codex` verbs send prompts, repository reads and review diffs, and ask each registered Codex store which account
it is signed into and what its usage limits read, and `slack draft record` sends a new as-me draft's
conversation and your voice brief to Codex for a comparison draft, unless the draft was approved at record,
carries media or is Codex's own; the console voice (`slopweaver talk`)
sends your voice, and the code, any file on this machine it reads (a credential store refused, credentials
inside a file masked, a PNG, JPEG or WebP as its re-encoded pixels), board rows, page content, supervisor conversation, glossary, knowledge
claims, row origins and — only while you share it — screen frames it reads to answer you. Each is opt-in on its
own — codex per invocation or as-me draft, talk per session — and if neither is a boundary you want, do not use those verbs
and do not press the voice orb. **Nothing else in the product sends anything to OpenAI** beyond the READS
`slopweaver chatgpt list`, `chatgpt live-sync` and `chatgpt conversation` make of your own ChatGPT account, and the rest
of this document is unaffected. Both are stated in full below: [The Codex boundary](security/codex-boundary.md#the-codex-boundary-slopweaver-codex) and
[The console-voice boundary](security/voice-boundary.md#the-console-voice-boundary-slopweaver-talk).

**One encrypted copy, into a local directory.** The nightly `slopweaver store backup` writes the corpus
files, a store dump, Vault's secrets and, once the backup master password is set, the encrypted credentials
into the directory the install configures. Every object is encrypted under a random backup key held in the login
Keychain, and that key's wrap under the master password, the one secret kept off this machine in the operator's
password manager, sits beside the backups so another Mac can open them.
Nothing goes to a cloud service; an external volume is how the copy leaves this disk —
[the backup](store/backup.md).

**The store itself never leaves this machine.** It is a local database on this machine, a hard rule: a store URL
naming any host but loopback is refused at selection, and no variable, flag or grant opens that refusal —
[the store](store/overview-and-local-stack.md).

- [Data flow](./security/data-flow.md)
- [Huddles (`slack read-file`, and the corpus `huddle` kind)](./security/slack-huddles.md)
- [The write path (`slack`)](./security/slack-write-path.md)
  - [The inbound path (`listen`)](./security/slack-inbound.md)
  - [Who may command the bot, and why that is the injection boundary](./security/slack-command-boundary.md)
  - [The admit door, described honestly](./security/slack-admit-door.md)
  - [The browser is a write surface, and is gated as one](./security/browser-write-surface.md)
  - [The Datadog browser surface](./security/datadog-browser-surface.md)
  - [Withholding a reply](./security/withholding-a-reply.md)
- [Credentials](./security/credentials.md)
- [Protected paths (`protect`): paths named in the state home, kept from every session](./security/protected-paths.md)
- [Hardening the local store (Docker, loopback ports, the service key)](./security/local-store-hardening.md)
- [The mail boundary (`gmail`)](./security/mail-boundary.md)
  - [Changing a mailbox (`gmail label`, `gmail mark`, `gmail archive`)](./security/mail-boundary.md#changing-a-mailbox-gmail-label-gmail-mark-gmail-archive)
- [The Drive boundary (`drive`)](./security/drive-boundary.md)
- [The calendar boundary (`calendar`)](./security/calendar-boundary.md)
- [The recorded-call boundary (`refresh --source fathom`, `fathom share`, `fathom discover`)](./security/recorded-call-boundary.md)
- [ChatGPT: the history export and the web-session reads (`chatgpt sync`, `chatgpt list`, `chatgpt live-sync`, `chatgpt conversation`)](./security/chatgpt-conversation-boundary.md)
- [The Google Cloud door (`gcp`)](./security/gcp-door.md)
- [The Codex boundary (`slopweaver codex`)](./security/codex-boundary.md)
- [The console-voice boundary (`slopweaver talk`)](./security/voice-boundary.md)
  - [The model performs a relay only through a gate that reads your own words.](./security/voice-relays-and-retention.md)
- [What the bot may read about a person (`person.judgement`)](./security/person-judgement.md)
- [Runs anywhere](./security/runs-anywhere.md)
- [The identity roster is off-repo](./security/identity-roster.md)
- [The hygiene gate (a shipped feature)](./security/hygiene-gate.md)
  - [Where the private denylist actually applies](./security/hygiene-gate.md#where-the-private-denylist-actually-applies)
  - [Which requests each write transport judges](./security/write-transports.md)
  - [The synthetic organisation](./security/hygiene-gate.md#the-synthetic-organisation)
  - [What the gate does not settle](./security/hygiene-gate.md#what-the-gate-does-not-settle)
- [Reporting](./security/reporting.md)
