# Amayori: machine-readable project state

The canonical project plan is [docs/amayori-roadmap.json](./amayori-roadmap.json). It separates `merged` work from open pull requests and future tasks.

## Updating the file

- Keep `schema_version`, `project`, `updated_at`, `constraints`, `architecture`, `delivered`, `pending_pull_requests`, `roadmap`, and `acceptance_criteria`.
- Change an item to `merged` only after GitHub confirms the merge.
- Do not describe planned features as implemented or CI as successful until verified.
- Preserve the no-Docker, no-Ollama and single-launcher constraints.
- Do not store credentials, private user information or chat messages in this file.
