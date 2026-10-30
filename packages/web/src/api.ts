import type {
  ApiError,
  CreateTaskInput,
  MergeResult,
  ServerEvent,
  Task,
  TaskDetail,
  TaskDiff,
} from '@kacheri/shared';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface EventSubscription {
  close(): void;
}

export interface EventHandlers {
  onEvent(event: ServerEvent): void;
  onOpen?(): void;
  onError?(): void;
}

export interface KacheriApi {
  listTasks(): Promise<Task[]>;
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<TaskDetail>;
  startTask(id: string): Promise<Task>;
  reviewTask(id: string): Promise<Task>;
  mergeTask(id: string): Promise<MergeResult>;
  rejectTask(id: string): Promise<Task>;
  getDiff(id: string): Promise<TaskDiff>;
  subscribe(handlers: EventHandlers): EventSubscription;
}

export interface ApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  EventSource?: typeof EventSource;
}

function isApiError(body: unknown): body is ApiError {
  return typeof body === 'object' && body !== null && typeof (body as ApiError).error === 'string';
}

export function parseServerEvent(data: string): ServerEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const type = (parsed as { type?: unknown }).type;
    if (type === 'task' || type === 'run' || type === 'log' || type === 'verdict') {
      return parsed as ServerEvent;
    }
    return null;
  } catch {
    return null;
  }
}

export function defaultFetch(): typeof fetch {
  return (input, init) => globalThis.fetch(input, init);
}

export async function requestJson<T>(
  doFetch: typeof fetch,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch (err) {
    throw new ApiRequestError(`daemon unreachable: ${(err as Error).message}`, 0);
  }
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!res.ok) {
    const message = isApiError(parsed) ? parsed.error : text || `HTTP ${res.status}`;
    throw new ApiRequestError(message, res.status);
  }
  if (parsed === undefined) {
    throw new ApiRequestError(`invalid JSON response from ${method} ${url}`, res.status);
  }
  return parsed as T;
}

export function createApi(opts: ApiOptions = {}): KacheriApi {
  const base = `${opts.baseUrl ?? ''}/api`;
  const doFetch: typeof fetch = opts.fetch ?? defaultFetch();
  const request = <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> =>
    requestJson<T>(doFetch, method, `${base}${path}`, body);

  const enc = encodeURIComponent;

  return {
    listTasks: () => request<Task[]>('GET', '/tasks'),
    createTask: (input) => request<Task>('POST', '/tasks', input),
    getTask: (id) => request<TaskDetail>('GET', `/tasks/${enc(id)}`),
    startTask: (id) => request<Task>('POST', `/tasks/${enc(id)}/start`),
    reviewTask: (id) => request<Task>('POST', `/tasks/${enc(id)}/review`),
    mergeTask: (id) => request<MergeResult>('POST', `/tasks/${enc(id)}/merge`),
    rejectTask: (id) => request<Task>('POST', `/tasks/${enc(id)}/reject`),
    getDiff: (id) => request<TaskDiff>('GET', `/tasks/${enc(id)}/diff`),
    subscribe(handlers) {
      const ES = opts.EventSource ?? globalThis.EventSource;
      if (!ES) {
        handlers.onError?.();
        return { close() {} };
      }
      const source = new ES(`${base}/events`);
      source.onopen = () => handlers.onOpen?.();
      source.onerror = () => handlers.onError?.();
      source.onmessage = (msg: MessageEvent<string>) => {
        const event = parseServerEvent(msg.data);
        if (event) handlers.onEvent(event);
      };
      return { close: () => source.close() };
    },
  };
}
