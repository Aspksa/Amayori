# Golem 2.0 — PostgreSQL knowledge graph
GET /api/golem/knowledge?q=&offset=0&limit=150 returns paginated active facts as graph nodes and labeled edges.
GET /api/golem/diagnostics reports fact counts and how many 384-dimensional vectors are indexed in pgvector.
The knowledge map supports search, incremental loading, pan/zoom, node selection and status. No local embedding model or Python auto-build is started on application boot.
Existing legacy Golem endpoints and bundled scripts are retained for compatibility but the new graph does not invoke them. Semantic similarity is not enabled until a compatible Cloud.ru embedding model is configured and vectors are populated. The graph is currently 2D; a full Three.js rework and source-linked message navigation are not complete.
