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
