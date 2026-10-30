import { createRequire } from 'node:module';
// Vite 5 does not recognize node:sqlite as a builtin; load it through Node.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import type { Run, Task, Verdict } from '@kacheri/shared';

export interface Store {
  listTasks(): Task[];
  getTask(id: string): Task | undefined;
  saveTask(task: Task): void;
  saveRun(run: Run): void;
  getRuns(taskId: string): Run[];
  saveVerdict(taskId: string, verdict: Verdict): void;
  getVerdicts(taskId: string): Verdict[];
  clearVerdicts(taskId: string): void;
  close(): void;
}
export function createStore(path = ':memory:'): Store {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS verdicts (task_id TEXT NOT NULL, reviewer TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(task_id, reviewer));`);
  const read = <T>(rows: unknown[]) => rows.map(row => JSON.parse((row as { data: string }).data) as T);
  return {
    listTasks: () => read<Task>(db.prepare('SELECT data FROM tasks ORDER BY rowid').all()),
    getTask: id => read<Task>(db.prepare('SELECT data FROM tasks WHERE id = ?').all(id))[0],
    saveTask: task => { db.prepare('INSERT OR REPLACE INTO tasks VALUES (?, ?)').run(task.id, JSON.stringify(task)); },
    saveRun: run => { db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?, ?)').run(run.id, run.taskId, JSON.stringify(run)); },
    getRuns: id => read<Run>(db.prepare('SELECT data FROM runs WHERE task_id = ? ORDER BY rowid').all(id)),
    saveVerdict: (id, verdict) => { db.prepare('INSERT OR REPLACE INTO verdicts VALUES (?, ?, ?)').run(id, verdict.reviewer, JSON.stringify(verdict)); },
    getVerdicts: id => read<Verdict>(db.prepare('SELECT data FROM verdicts WHERE task_id = ? ORDER BY rowid').all(id)),
    clearVerdicts: id => { db.prepare('DELETE FROM verdicts WHERE task_id = ?').run(id); },
    close: () => db.close(),
  };
}
