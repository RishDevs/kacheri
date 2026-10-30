# Court integration

`createServer` accepts an injected `runCase(input, { llm, onEvent })` and `llm`.
`input` contains title, repoPath, baseRef, headRef. The runner returns a
CaseRecord and emits shared CourtEvents through onEvent. main.ts connects the
Court workspace runner and the environment-selected LLM client. Court is an
optional workspace peer so installation and injected tests work before T6 lands.
Its import has a temporary TypeScript suppression for the missing workspace.
Confirm T6's runner signature at integration and remove that suppression then.

POST /api/cases awaits completion; GET /api/cases and GET /api/cases/:id expose
records held in memory for the daemon lifetime. Case snapshot events update the
stored record while running. Every CourtEvent is broadcast on /api/events as
`{ type: 'court', event }`. Existing task APIs and events remain supported.
