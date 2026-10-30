**1. Token Factory API**

| Item | Verified details |
|---|---|
| Base/auth | `https://api.tokenfactory.nebius.com/v1/`; convention: `NEBIUS_API_KEY`; `Authorization: Bearer …`. [Quickstart](https://docs.tokenfactory.nebius.com/quickstart.md) |
| OpenAI compatibility | POST `/chat/completions`, `/embeddings`, `/responses`; tools through `tools`/`tool_choice`; structured output through `response_format` with `json_object` or `json_schema`, model-dependent. [API](https://api.tokenfactory.nebius.com/openapi.json), [tools](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling.md), [JSON](https://docs.tokenfactory.nebius.com/ai-models-inference/json.md) |
| Batch | Advertised, but linked documentation returns “Page Not Found”; `/batches` absent from fetched OpenAPI. Exact endpoint/compatibility **(unverified)**. [Product](https://nebius.com/token-factory) |
| Limits | Account-specific RPM/TPM; inspect console/headers. Every 15 minutes: ≥80% utilization → ×1.2; ≤50% → ÷1.5; ceiling 20× baseline. HTTP 429 includes retry guidance. [Limits](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits.md) |
| Hackathon credits | $25 via form, code `NEBIUS-DEVPOST-GLOBAL26`; another $25 through free Builders Program. [Resources](https://nebiusglobalaihackathon.devpost.com/resources) |

**2. NVIDIA models actually listed active**

Exact IDs, served contexts and USD/million-token **input/output** prices from the fetched [public catalog](https://tokenfactory.nebius.com/api/public/models_info); availability was catalog-verified, not inference-tested.

| Exact model ID | Params/architecture | Served context | Features | Price |
|---|---|---:|---|---:|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 30B/~3.5B active; Mamba–Transformer MoE | 262,144 | Reasoning, tools | $0.06/$0.24 |
| `nvidia/nemotron-3-super-120b-a12b` | 120B/12B active; hybrid MoE | 262,144 | Reasoning, tools | $0.30/$0.90 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 550B/55B active; LatentMoE, Mamba–Transformer | 1,048,576 | Reasoning on/off; tools | $1/$3 |
| `nvidia/Nemotron-3_5-Lightning` | 30B/3B active; hybrid MoE | 1,048,576 | Reasoning on/off; tools | $0.06/$0.24 |
| `nvidia/Nemotron-3.5-Super-VL` | 120B/12B active; hybrid MoE + C-RADIO | 1,048,576 | Images/video, tools; off/medium/on reasoning | $0.30/$0.90 |

Reasoning controls are model-card capabilities; Token Factory passthrough **(unverified)**. No NVIDIA guard, reward, embedding/rerank or Nano Omni model appeared in the catalog.

**3. Nebius Serverless**

Endpoints serve persistent HTTP workloads; Jobs execute containers to completion on allocated CPU/GPU resources. Configure Nebius CLI/project/quota, publish your image, then deploy:

```bash
nebius ai endpoint create --name app --image REGISTRY/IMAGE:TAG \
  --platform cpu-d3 --preset 4vcpu-16gb --public \
  --container-port 8000 --auth token --token "$AUTH_TOKEN"
```

For Jobs use `nebius ai job create` with image, command, platform/preset and timeout. [Endpoint recipe](https://github.com/nebius/serverless-ai-cookbook/blob/main/quickstarts/first-endpoint.md), [Job recipe](https://github.com/nebius/serverless-ai-cookbook/blob/main/quickstarts/first-job.md).

**4. Agent stack**

| Component | What it is |
|---|---|
| [NemoClaw](https://github.com/NVIDIA/NemoClaw) | Reference stack onboarding agents into OpenShell.<br>Manages inference, integrations, persistence and lifecycle. |
| [OpenShell](https://github.com/NVIDIA/OpenShell) | Agent sandbox/runtime enforcing filesystem, syscall and network policies.<br>Injects credentials outside agent visibility. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Nous Research’s agent harness with persistent memory.<br>Creates/improves reusable skills from experience. |

**5. Distinctive product cores**

Capabilities are verified; product applications are hypotheses **(unverified)**, not claims of exclusivity:

| Capability | Non-obvious core |
|---|---|
| [Nano thinking budgets](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16) | Deadline-aware incident investigator |
| [Ultra million-token context](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4) | Cross-contract obligation contradiction detector |
| [Super VL visual reasoning](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16) | Screenshot-to-policy compliance reconstruction |
| [Specialized safety models](https://developer.nvidia.com/nemotron) | Cultural-context moderation appeals engine |
| [Open weights/data/recipes](https://developer.nvidia.com/nemotron) | Reproducible domain-agent failure laboratory |
