// Shared contracts for every Kacheri package. Owner: claude.
// Changing anything here is an architecture change: record it in docs/DECISIONS.md.

export type AgentId = 'claude' | 'codex' | 'cursor' | 'gemini';
export const AGENT_IDS: readonly AgentId[] = ['claude', 'codex', 'cursor', 'gemini'];

// queued -> running -> reviewing -> ready | changes_requested -> merged | rejected
// any active state -> failed on a process/git error
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'reviewing'
  | 'ready'
  | 'changes_requested'
  | 'merged'
  | 'rejected'
  | 'failed';

export interface Task {
  id: string; // short slug-safe id, e.g. "t_8f3k2a"
  title: string;
  prompt: string;
  agent: AgentId; // author
  reviewers: AgentId[]; // must not include `agent`
  ownedPaths: string[]; // globs relative to repo root, e.g. ["packages/web/**"]
  status: TaskStatus;
  branch: string | null; // "kacheri/<id>" once the worktree exists
  worktreePath: string | null;
  error: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  agent: AgentId;
  reviewers?: AgentId[]; // default: one agent other than the author
  ownedPaths: string[];
}

export type RunKind = 'build' | 'review';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface Run {
  id: string;
  taskId: string;
  agent: AgentId;
  kind: RunKind;
  status: RunStatus;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
}

// ---- Agent adapters (daemon) ----

export interface AgentCommand {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

export interface AgentAdapter {
  id: AgentId;
  // `cwd` is the task worktree. Adapters never run a shell; the runner spawns cmd+args with stdin closed.
  buildCommand(prompt: string, cwd: string, kind: RunKind): AgentCommand;
}

// ---- Git engine ----

export interface WorktreeInfo {
  branch: string;
  path: string;
  baseRef: string; // commit sha the branch was created from
}

export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  path: string; // new path for renames
  oldPath?: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
}

export interface TaskDiff {
  baseRef: string;
  headRef: string;
  files: FileChange[];
  patch: string; // unified diff, includes uncommitted worktree changes
}

export interface OwnershipResult {
  ok: boolean;
  violations: string[]; // changed paths matching none of ownedPaths
}

export interface MergeOptions {
  testCommand?: string[]; // e.g. ["npm","test"]; run in the worktree before merging
  message?: string;
}

export type MergeResult =
  | { ok: true; commit: string }
  | { ok: false; reason: 'ownership' | 'tests_failed' | 'conflict' | 'dirty_base' | 'nothing_to_merge'; detail: string };

export interface GitEngine {
  createWorktree(taskId: string): Promise<WorktreeInfo>;
  commitAll(taskId: string, message: string): Promise<string | null>; // sha, or null if nothing to commit
  diff(taskId: string): Promise<TaskDiff>;
  checkOwnership(files: FileChange[], ownedPaths: string[]): OwnershipResult;
  merge(taskId: string, ownedPaths: string[], opts?: MergeOptions): Promise<MergeResult>;
  removeWorktree(taskId: string, opts?: { deleteBranch?: boolean }): Promise<void>;
}

// ---- Jury ----

export type Severity = 'critical' | 'major' | 'minor';

export interface Finding {
  severity: Severity;
  file: string;
  line: number | null;
  message: string;
  suggestion: string | null;
}

export interface Verdict {
  reviewer: AgentId;
  status: 'PASS' | 'FAIL';
  summary: string;
  findings: Finding[];
}

export type ParseVerdictResult = { ok: true; verdict: Verdict } | { ok: false; error: string };

// ---- HTTP + SSE API (daemon <-> web) ----
// GET    /api/tasks                 -> Task[]
// POST   /api/tasks  CreateTaskInput -> Task         (status queued)
// GET    /api/tasks/:id             -> TaskDetail
// POST   /api/tasks/:id/start       -> Task          (creates worktree, starts build run)
// POST   /api/tasks/:id/review      -> Task          (starts review runs; auto after build succeeds)
// POST   /api/tasks/:id/merge       -> MergeResult   (200 even when ok:false)
// POST   /api/tasks/:id/reject      -> Task
// GET    /api/tasks/:id/diff        -> TaskDiff
// GET    /api/events                -> text/event-stream of ServerEvent (JSON in `data:`)
// Errors: non-2xx with ApiError body.

export interface TaskDetail {
  task: Task;
  runs: Run[];
  verdicts: Verdict[];
}

export interface ApiError {
  error: string;
}

export type ServerEvent =
  | { type: 'task'; task: Task }
  | { type: 'run'; run: Run }
  | { type: 'log'; runId: string; taskId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'verdict'; taskId: string; verdict: Verdict };

// =====================================================================
// Kacheri Court: proof-carrying code review on Nemotron (Token Factory)
// =====================================================================

export type ModelTier = 'nano' | 'super' | 'ultra';

// Token Factory model ids (verified in the public catalog 2026-10-30) and USD per 1M tokens.
export const MODELS: Record<ModelTier, { id: string; inPerM: number; outPerM: number }> = {
  nano: { id: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', inPerM: 0.06, outPerM: 0.24 },
  super: { id: 'nvidia/nemotron-3-super-120b-a12b', inPerM: 0.3, outPerM: 0.9 },
  ultra: { id: 'nvidia/Nemotron-3-Ultra-550b-a55b', inPerM: 1, outPerM: 3 },
};

export interface LlmUsage {
  tier: ModelTier;
  model: string;
  role: CourtRole;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  tier: ModelTier;
  role: CourtRole; // for cost accounting
  messages: ChatMessage[];
  json?: boolean; // ask for a JSON object response
  reasoning?: boolean; // Nemotron reasoning on/off
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: string; // final answer, reasoning trace stripped
  usage: LlmUsage;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export type CourtRole = 'prosecutor' | 'defense' | 'judge' | 'baseline' | 'remedy';



export interface Charge {
  id: string; // "c1", "c2", ...
  claim: string; // what is wrong, one sentence
  file: string;
  line: number | null;
  severity: Severity;
  witnessCode: string; // complete test file content
  witnessPath: string; // repo-relative path where the witness is written, e.g. "__kacheri__/c1.test.mjs"
}

export type WitnessOutcome = 'pass' | 'fail' | 'error' | 'timeout';

export interface Evidence {
  chargeId: string;
  base: WitnessOutcome[]; // one per run
  head: WitnessOutcome[];
  // Admissible iff every head run fails and every base run passes.
  admissible: boolean;
  reason: string; // e.g. "fails on head 3/3, passes on base 3/3" or "flaky on head"
  headLog: string; // trimmed output of the last head run
}

export interface Rebuttal {
  chargeId: string;
  argument: string;
  concedes: boolean; // defense agrees the evidence shows a real bug
}

export type Decision = 'convicted' | 'dismissed';

export interface Ruling {
  chargeId: string;
  decision: Decision;
  reason: string;
}

export type CaseStatus = 'filing' | 'trial' | 'deliberation' | 'closed' | 'error';

export interface CaseRecord {
  id: string;
  title: string;
  repoPath: string;
  baseRef: string;
  headRef: string;
  status: CaseStatus;
  charges: Charge[];
  evidence: Evidence[];
  rebuttals: Rebuttal[];
  rulings: Ruling[];
  usage: LlmUsage[];
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  patch?: string; // unified diff base -> head, for display
  remedy?: Remedy | null;
  mode?: 'live' | 'replay'; // replay = recorded Token Factory responses
}

// Remedy: after a conviction Nemotron proposes a fix, and the court re-runs the evidence on head+fix.
export interface Remedy {
  chargeIds: string[]; // convicted charges this fix addresses
  explanation: string;
  patch: string; // unified diff head -> head+fix
  attempts: number;
  witnesses: { chargeId: string; outcomes: WitnessOutcome[] }[]; // must all pass on head+fix
  suite: 'pass' | 'fail' | 'not_run'; // the repo's own test command on head+fix
  suiteLog: string;
  verified: boolean; // every witness passes 3/3 and the suite is not failing
}

export type CourtEvent =
  | { type: 'case'; record: CaseRecord }
  | { type: 'charge'; caseId: string; charge: Charge }
  | { type: 'evidence'; caseId: string; evidence: Evidence }
  | { type: 'rebuttal'; caseId: string; rebuttal: Rebuttal }
  | { type: 'ruling'; caseId: string; ruling: Ruling }
  | { type: 'usage'; caseId: string; usage: LlmUsage }
  | { type: 'remedy'; caseId: string; remedy: Remedy };

// Benchmark: one injected bug (a mutant that survives the repo's own tests).
export interface BenchItem {
  id: string;
  repo: string; // fixture name
  file: string;
  line: number;
  operator: string; // e.g. "off-by-one", "flip-comparison"
  description: string;
  patch: string; // unified diff base -> buggy head
}

export interface BenchResult {
  itemId: string;
  system: 'court' | 'baseline';
  findings: number; // total findings/charges reported
  convicted: number; // court only: convicted charges
  hit: boolean; // a reported (court: convicted) finding points at the injected bug (same file, |line diff| <= 3)
  falsePositives: number; // reported (court: convicted) findings that are not the injected bug
  costUsd: number;
  latencyMs: number;
}
