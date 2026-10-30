### Part A: 10 Crowded Ideas to Avoid (High Frequency Submissions)

1. **GitHub PR Reviewer / Linter Bot:** Generic comments on style/formatting.
2. **Customer Support RAG Agent:** Standard docs vector search + chat interface.
3. **LeetCode / Interview Prep Tutor:** Generic code evaluator with hints.
4. **AI Executive Assistant:** Email inbox triage and calendar auto-scheduler.
5. **Generic Research Agent (Tavily wrapper):** Shallow web search to PDF/Markdown report.
6. **Text-to-SQL Analytics Dashboard:** Natural language queries over SQLite/Postgres.
7. **Patient Medical Symptom Triage:** WebMD-style diagnostic chatbot.
8. **Automated Documentation Generator:** Code-to-docstring/README tool.
9. **Meeting Notes & Action-Item Summarizer:** Audio/transcript to task list.
10. **Smart Home IoT Hub:** Natural language dispatcher for lights/thermostats.

---

### Part B: 8 Non-Obvious Ideas

| Name | Track | Specific Audience + Concrete Pain | Essential Nemotron Capability | 3-Minute Demo Wow Moment | Buildable in 6h? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Chaos-to-Test** | Coding Agents | **SREs & On-Call Devs:** 80% of outages stem from config/untested edge cases (*Google SRE*). Log post-mortems rarely yield regression tests. | Nemotron reasoning + synthetic data generation to synthesize hermetic tests from messy logs. | Paste a chaotic Slack incident transcript + raw Datadog stack trace; agent reproduces the failure via a generated Dockerized pytest, then auto-fixes the bug. | **Y:** Scoped to Python web apps; Docker test harness + Nebius inference pipeline. |
| **ReDoS-Buster** | Coding Agents | **AppSec Engineers:** ReDoS caused Cloudflare’s 27-min global outage (2019). Regexes in microservices hide catastrophic backtrack loops. | Symbolic AST reasoning to deconstruct NFA state explosions and output deterministic parsers. | Ingests vulnerable auth regex; Nemotron crafts an adversarial payload that hangs CPU, rewrites regex to linear-time DFA, and shows 1000x latency drop live. | **Y:** Web UI + Python `re` execution harness benchmark. |
| **ProtocolDrift** *(+Tavily)* | Apps & Agents | **Clinical Research Coordinators:** >30% of FDA clinical trial audit citations stem from protocol deviations (*FDA BIMO*). | Deep multi-step rule evaluation over dense clinical criteria + Tavily querying live ClinicalTrials.gov/PubMed for protocol amendments. | Uploads messy nurse chart; agent spots a 45-min medication timing violation against live amendment v3.2 retrieved by Tavily, auto-populating FDA Form 3911. | **Y:** Streamlit + mock EHR JSON + Tavily API search. |
| **Substation Triage** | Physical AI | **Power Grid Dispatchers:** Alarm floods exceed 500 events/min during grid faults, causing operator cognitive paralysis (*NERC*). | Ultra-fast token processing (Nemotron Nano/Super) for real-time causal graph topology correlation. | Ingests 2,000 synthetic Modbus trip logs across 5 substations; agent filters 1,980 cascading symptoms to isolate the exact tree-strike line fault in <2 seconds. | **Y:** Synthetic SCADA event stream generator + D3 topology view. |
| **PLC-Invariant** | Physical AI | **Industrial Automation Engineers:** Unplanned plant downtime costs $260k/hour (*Siemens 2022*). PLC logic changes risk physical collisions. | Strict formal-logic translation (IEC 61131-3 Structured Text to safety invariant assertions). | Ingests robotic conveyor code; Nemotron flags a race condition where E-stop is bypassed during sensor bounce, outputting verified safe ladder logic. | **Y:** Text-in/text-out logic verifier with simulated state visualizer. |
| **Caregiver Scribe** *(+Tavily)* | Personal AI | **Elderly Caregivers:** Spend 24 hrs/week on unpaid care; Medicaid insurance appeals take 14+ business days (*AARP 2020*). | Long-context medical synthesis + Tavily retrieving state-specific statutory Medicaid coverage codes. | Ingests wheelchair claim denial letter; Tavily retrieves state coverage manual; agent drafts an airtight legal appeal citing statutory precedent and doctor records. | **Y:** Clean UI + document upload + prompt chain on Nebius. |
| **Click-to-Cancel** *(+Tavily)* | Personal AI | **Consumers:** FTC logs >100k complaints/yr on deceptive subscription dark patterns (*FTC 2024 Rule*). | Autonomous tool execution + Tavily scanning hidden corporate TOS terms and cancellation workflows. | User inputs gym membership account; agent surfaces buried statutory cancellation email, drafts certified cancellation notice invoking FTC rules, and simulates webhook send. | **Y:** FastAPI backend + Tavily TOS scraper + email dispatch stub. |
| **SpecArchaeologist** | Apps & Agents | **Legacy Modernization Teams:** >60% of legacy microservices lack OpenAPI schemas (*Postman 2023*). | Reverse-engineering structured schema contracts from raw, undocumented network payloads. | Pipes raw TCP/PCAP dump of legacy JSON-RPC endpoints; Nemotron synthesizes production-ready OpenAPI 3.1 YAML with edge-case nullability and regex types. | **Y:** Python `pypcap`/HAR parser piped to Nemotron endpoint. |

---

### Part C: Top 2 Picks to Beat Grad-Student Teams

1. **ProtocolDrift (Apps & Agents + $3k Tavily Prize):**
   * **Why it wins:** Grad students build generic "medical Q&A" bots that judges dismiss. ProtocolDrift targets an acute, measurable $30k/day enterprise regulatory compliance problem. Pairing Nemotron’s complex document reasoning with Tavily’s real-time clinical trial registry search directly attacks both the core track and the $3,000 prize.

2. **Chaos-to-Test (Coding Agents):**
   * **Why it wins:** Academic teams attempt broad "autonomous junior developers" (SWE-bench clones) that inevitably hallucinate live. Chaos-to-Test does one concrete, highly impressive task: converting messy, human incident logs into deterministic, reproducing pytest suites. It offers an airtight 3-minute demo that judges can instantly verify.
