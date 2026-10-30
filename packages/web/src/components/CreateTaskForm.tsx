import { useState, type FormEvent } from 'react';
import { AGENT_IDS, type AgentId, type CreateTaskInput } from '@kacheri/shared';

export interface CreateTaskFormProps {
  onSubmit(input: CreateTaskInput): Promise<unknown>;
}

export function parseOwnedPaths(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function validateTaskInput(input: CreateTaskInput): string | null {
  if (!input.title.trim()) return 'Title is required.';
  if (!input.prompt.trim()) return 'Prompt is required.';
  if (input.ownedPaths.length === 0) return 'At least one owned path is required.';
  if (input.reviewers?.includes(input.agent)) return 'Reviewers must not include the author.';
  return null;
}

export function CreateTaskForm({ onSubmit }: CreateTaskFormProps) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState<AgentId>(AGENT_IDS[0]);
  const [reviewers, setReviewers] = useState<AgentId[]>([]);
  const [paths, setPaths] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleReviewer = (id: AgentId) =>
    setReviewers((cur) => (cur.includes(id) ? cur.filter((r) => r !== id) : [...cur, id]));

  const changeAgent = (id: AgentId) => {
    setAgent(id);
    setReviewers((cur) => cur.filter((r) => r !== id));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input: CreateTaskInput = {
      title: title.trim(),
      prompt: prompt.trim(),
      agent,
      ownedPaths: parseOwnedPaths(paths),
    };
    if (reviewers.length > 0) input.reviewers = reviewers;
    const invalid = validateTaskInput(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
      setTitle('');
      setPrompt('');
      setReviewers([]);
      setPaths('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="create-form" onSubmit={submit} aria-label="Create task">
      <h2>New task</h2>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Prompt
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} required />
      </label>
      <label>
        Author
        <select value={agent} onChange={(e) => changeAgent(e.target.value as AgentId)}>
          {AGENT_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Reviewers (default: one other agent)</legend>
        {AGENT_IDS.filter((id) => id !== agent).map((id) => (
          <label key={id} className="inline">
            <input type="checkbox" checked={reviewers.includes(id)} onChange={() => toggleReviewer(id)} />
            {id}
          </label>
        ))}
      </fieldset>
      <label>
        Owned paths (one glob per line)
        <textarea
          value={paths}
          onChange={(e) => setPaths(e.target.value)}
          rows={3}
          placeholder="packages/web/**"
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create task'}
      </button>
    </form>
  );
}
