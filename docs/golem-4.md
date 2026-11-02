# Golem 4.0 — Cloud embeddings, Three.js WebGL, provenance
- npm.cmd install downloads Three.js to node_modules; Amayori serves the local Three.js module under /three.module.js. No external CDN.
- Cloud.ru embeddings are opt-in using AMAYORI_EMBEDDING_MODEL. The configured model must return 384 floats. PostgreSQL required.
- After each successful chat response, a bounded asynchronous indexing batch indexes up to 2 missing canonical messages, with idempotent unique chat_message_id. POST /api/golem/index-batch triggers up to 3 messages on demand. Errors are logged and never discard the chat.
- Facts can be created with sourceMessageId (the canonical PostgreSQL chat ID). GET /api/golem/source?id= then returns the exact message if linked; historical facts without this field show provenance only.
- 3D WebGL map uses Three.js from node_modules, with pointer rotation, zoom and node selection. 2D remains fallback if WebGL unavailable. The initial WebGL graph displays at most 300 edges, so it is not a complete all-pages visualization yet.
- No automatic extraction of facts from chats: sourceMessageId is explicitly supplied. Model availability and API compatibility require real Cloud.ru credentials to verify.
