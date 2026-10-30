# Token Factory client

`createTokenFactoryClient` uses the shared model catalog, a 180-second total call
budget, and at most four retries after the initial request for HTTP 429/5xx.
`Retry-After` seconds and HTTP dates are supported.

Documentation checked with curl on 2026-10-30:
- https://docs.tokenfactory.nebius.com/llms.txt
- https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion.md
- https://docs.tokenfactory.nebius.com/ai-models-inference/json.md
- https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md

The reference confirms `max_tokens`, JSON object response format, and usage fields
`prompt_tokens` and `completion_tokens`. The published documentation (including
llms-full.txt) does not describe a Nemotron 3-specific thinking toggle. Pending
live model verification, the client sends T7's requested
`chat_template_kwargs: { enable_thinking: boolean }`. Only final message content
is returned; separate reasoning fields are ignored and think tags are removed.

Replay keys intentionally omit role and maxTokens per T7. Usage role is restored
from the current request on replay. Record mode writes the ChatResponse directly
to `<dir>/<sha256>.json` using an atomic rename.
