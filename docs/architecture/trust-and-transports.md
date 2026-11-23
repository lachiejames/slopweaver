# The Codex brain, transports and trust

Part of [Architecture](../architecture.md).

## The Codex brain (build-time, not runtime)

`src/codex/` wraps the official Codex SDK as a streamed planning and review pass — used while _developing_
Slopweaver, and not part of the world model or any user-facing answer. `Required<ThreadOptions>` forces the
locked options at every thread-creation path, including `resumeThread`, so no caller can widen them.

What those options actually permit, stated rather than softened: the sandbox is `workspace-write`, network
access and live web search are **on**, and the brain runs commands freely. The line it cannot cross is
writing into the repository — the repo is neither its working directory nor an additional writable root,
and that is the whole of the guarantee. `docs/constraints/coupled-claims.md` carries a coupled-claims list naming every
place that description has to change with the policy, this paragraph included.

A pass reads a **frozen snapshot** of the tree rather than the live repository, so the agent can keep
writing while it runs and neither can affect the other. Each pass writes one immutable artifact under
`$SLOPWEAVER_HOME/orchestration/<id>/` at `0700`/`0600` — never into the repository, where it would dirty
the diff under review — recording the branch, a tree fingerprint and which copy it read.
`slopweaver codex status` derives from those directories which passes ran on a branch, which are stale, and
which never ran at all. Usage is a union that cannot render absence as zero, so an aborted pass reports
`-` with a reason rather than a false `0`. It sends prompts, repository reads and diffs to OpenAI; see
[security/codex-boundary.md](../security/codex-boundary.md) and [codex-orchestration.md](../codex-orchestration.md).

## Zero-key transports

- **LLM**: no model API key, and exactly three transports, each named: the `codex` SDK above, `talk`'s
  console voice on the ChatGPT plan ([voice boundary](../security/voice-boundary.md)), and `claude gauge`'s
  one-token probe of each Claude plan's budget. Everything else that reasons happens in a session you can see:
  `store read`, `distil` and `turn` write a brief and read back what you composed in the visible agent session
  you're already in.
- **Embeddings**: none — no on-device encoder, no vector index, no pgvector, so there is no model to download,
  no index to build and no dimension to configure. Retrieval is Postgres full text over the store (an owner
  ruling: no RAG).

## Trust

A shipped hygiene gate (`src/hygiene/`) scans every file for generic leak classes and runs in
CI + a local pre-push hook. See [security/hygiene-gate.md](../security/hygiene-gate.md).
