# Runs anywhere

Part of [Security & trust](../security.md).

Nothing here encodes anything on-device — there is no embedder and no vector index, by the owner's ruling, so there is no model download and no native inference step on any platform. Retrieval is
Postgres full text over the local store. The optional Codex SDK is the one platform-specific piece: it ships a
**platform-specific binary** (~300MB), installed only because the SDK depends on it.
