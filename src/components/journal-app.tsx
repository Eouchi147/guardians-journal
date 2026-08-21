import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Feather,
  KeyRound,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { MODELS, type ModelKey } from "@/lib/journal/constants";
import { formatEntry, parseEntry, type ParsedEntry } from "@/lib/journal/parse";
import type { GuardrailWarning } from "@/lib/journal/checks";
import { cn } from "@/lib/utils";

type Status = {
  openrouter: boolean;
  xai: boolean;
  primaryModel: string;
  fallbackModel: string;
};

type HistoryItem = {
  id: string;
  createdAt: number;
  thought: string;
  raw: string;
  title: string;
};

const HISTORY_KEY = "guardians-journal.history";
const KEY_STORE = "guardians-journal.openrouter-key";
const MODEL_STORE = "guardians-journal.model";

export function JournalApp() {
  const [thought, setThought] = useState("");
  const [model, setModel] = useState<ModelKey>("nemotron");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedEntry | null>(null);
  const [warnings, setWarnings] = useState<GuardrailWarning[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [backendNote, setBackendNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      const storedKey = sessionStorage.getItem(KEY_STORE);
      if (storedKey) setOpenrouterKey(storedKey);
      const storedModel = localStorage.getItem(MODEL_STORE);
      if (storedModel === "glm" || storedModel === "nemotron") setModel(storedModel);
      const storedHistory = localStorage.getItem(HISTORY_KEY);
      if (storedHistory) setHistory(JSON.parse(storedHistory) as HistoryItem[]);
    } catch {
      // ignore storage failures
    }
    void fetch("/api/status")
      .then((r) => r.json())
      .then((s: Status) => setStatus(s))
      .catch(() => setStatus({ openrouter: false, xai: false, primaryModel: "", fallbackModel: "" }));
  }, []);

  const hasServerKey = Boolean(status?.openrouter || status?.xai);
  const canGenerate = thought.trim().length > 0 && !streaming && (hasServerKey || openrouterKey.trim().length > 0);

  const copyText = useMemo(() => {
    if (parsed) return formatEntry(parsed);
    return raw;
  }, [parsed, raw]);

  async function generate() {
    const input = thought.trim();
    if (!input || streaming) return;
    setStreaming(true);
    setError(null);
    setWarnings([]);
    setParsed(null);
    setRaw("");
    setCopied(false);
    setBackendNote(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          thought: input,
          model,
          openrouterKey: openrouterKey.trim() || undefined,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Generation failed (${res.status}).`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("The model returned an empty stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = JSON.parse(line.slice(5).trim()) as StreamEvent;
          if (payload.type === "meta") {
            if (payload.usingFallback) {
              setBackendNote("No OpenRouter key on the server. Writing with Grok so the desk still works. Paste a free OpenRouter key to run Nemotron or GLM.");
            } else {
              setBackendNote(`Writing with ${payload.model}.`);
            }
          } else if (payload.type === "delta") {
            assembled += payload.text;
            setRaw(assembled);
          } else if (payload.type === "error") {
            throw new Error(payload.message);
          } else if (payload.type === "done") {
            assembled = payload.raw || assembled;
            setRaw(assembled);
            setParsed(payload.parsed);
            setWarnings(payload.warnings ?? []);
            if (payload.malformed) {
              setWarnings((w) => [
                ...w,
                { code: "malformed", message: "The model output could not be parsed into TITLE / DEK / TAGS / BODY. Raw text is still below." },
              ]);
            }
            if (assembled.trim()) {
              const title = payload.parsed?.title || "Untitled entry";
              pushHistory({
                id: `${Date.now()}`,
                createdAt: Date.now(),
                thought: input,
                raw: assembled,
                title,
              });
            }
          }
        }
      }
      requestAnimationFrame(() => outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setStreaming(false);
    }
  }

  function pushHistory(item: HistoryItem) {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 16);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function loadHistory(item: HistoryItem) {
    setThought(item.thought);
    setRaw(item.raw);
    setParsed(parseEntry(item.raw));
    setWarnings([]);
    setError(null);
    setBackendNote(null);
  }

  function clearHistory() {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
  }

  async function copyOutput() {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function onModel(next: ModelKey) {
    setModel(next);
    try {
      localStorage.setItem(MODEL_STORE, next);
    } catch {
      // ignore
    }
  }

  function onKeyChange(value: string) {
    setOpenrouterKey(value);
    try {
      if (value) sessionStorage.setItem(KEY_STORE, value);
      else sessionStorage.removeItem(KEY_STORE);
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <div className="desk-wash pointer-events-none fixed inset-0" />
      <header className="relative border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-xs tracking-kicker text-forest uppercase">The Guardian's Journal</p>
              <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                Raw thought, finished entry
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
                Dump the unedited note. The engine returns a titled journal entry with a dek, tags, and a body that starts with the reconstruction warning.
              </p>
            </div>
            <BookOpen className="mt-1 size-7 shrink-0 text-forest" strokeWidth={1.5} aria-hidden="true" />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-lg bg-bg-warm p-1 shadow-paper">
              {(Object.keys(MODELS) as ModelKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onModel(key)}
                  className={cn(
                    "min-h-11 rounded-md px-4 text-sm font-medium transition-colors duration-150",
                    model === key ? "bg-paper text-ink shadow-paper" : "text-muted hover:text-ink",
                  )}
                >
                  {MODELS[key].label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-3 text-sm text-muted transition-colors hover:text-ink"
            >
              <KeyRound className="size-4" strokeWidth={1.75} />
              {showKey ? "Hide key" : "OpenRouter key"}
            </button>
          </div>

          {showKey ? (
            <div className="rounded-xl bg-paper p-4 shadow-paper">
              <label htmlFor="or-key" className="text-sm font-medium text-ink-soft">
                OpenRouter API key
              </label>
              <p className="mt-1 text-sm text-muted">
                Free key at openrouter.ai/keys. Stored only in this browser session. Needed for Nemotron and GLM. If omitted, the desk uses Grok when a server key is present.
              </p>
              <input
                id="or-key"
                type="password"
                autoComplete="off"
                value={openrouterKey}
                onChange={(e) => onKeyChange(e.target.value)}
                placeholder="sk-or-..."
                className="mt-3 h-11 w-full rounded-lg border-0 bg-bg px-3 text-sm text-ink shadow-inset outline-none ring-forest/30 placeholder:text-faint focus:ring-2"
              />
            </div>
          ) : null}
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:py-10">
        <section className="flex min-h-[28rem] flex-col">
          <div className="mb-3 flex items-end justify-between gap-3">
            <label htmlFor="thought" className="font-display text-lg text-ink">
              Raw thought
            </label>
            <span className="text-xs tabular-nums text-faint">{thought.trim().length} chars</span>
          </div>
          <textarea
            id="thought"
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            placeholder="Leave it messy. Voice dump, midnight note, argument with yourself. Do not tidy it first."
            className="min-h-72 flex-1 resize-y rounded-xl bg-paper p-4 text-base leading-relaxed text-ink shadow-paper outline-none ring-forest/30 placeholder:text-faint focus:ring-2 sm:min-h-96 sm:p-5"
          />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void generate()}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-forest px-5 text-sm font-medium text-paper transition-colors duration-150 hover:bg-forest-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {streaming ? <LoaderCircle className="size-4 animate-spin" /> : <Feather className="size-4" strokeWidth={1.75} />}
              {streaming ? "Writing entry" : "Generate entry"}
            </button>
            <p className="text-xs leading-relaxed text-muted sm:max-w-xs">
              {MODELS[model].hint} Free-model limits are roughly 20 requests per minute.
            </p>
          </div>
          {error ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-paper px-3 py-3 text-sm text-danger shadow-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
        </section>

        <section ref={outputRef} className="min-h-[28rem]">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="font-display text-lg text-ink">Entry</h2>
            <button
              type="button"
              disabled={!copyText}
              onClick={() => void copyOutput()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors hover:text-ink disabled:opacity-40"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <article className="rounded-xl bg-paper p-5 shadow-paper sm:p-7">
            {!raw && !streaming ? (
              <EmptyEntry />
            ) : parsed ? (
              <FinishedEntry entry={parsed} />
            ) : (
              <LiveDraft text={raw} streaming={streaming} />
            )}
          </article>

          {backendNote ? <p className="mt-3 text-xs text-muted">{backendNote}</p> : null}

          {warnings.length > 0 ? (
            <div className="mt-4 rounded-xl bg-paper p-4 shadow-warn">
              <p className="flex items-center gap-2 text-sm font-medium text-warn">
                <AlertTriangle className="size-4" />
                Guardrail warnings. Raw model output is still returned.
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                {warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {parsed?.flagged ? (
            <div className="mt-4 rounded-xl bg-paper p-4 shadow-danger">
              <p className="text-sm font-medium text-danger">Flagged</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{parsed.flagged}</p>
            </div>
          ) : null}
        </section>
      </main>

      {history.length > 0 ? (
        <aside className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-ink">This desk</h2>
            <button
              type="button"
              onClick={clearHistory}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:text-ink"
            >
              <Trash2 className="size-4" />
              Clear
            </button>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => loadHistory(item)}
                  className="flex min-h-14 w-full flex-col items-start rounded-xl bg-paper px-4 py-3 text-left shadow-paper transition-colors hover:bg-bg-warm"
                >
                  <span className="font-display text-sm text-ink">{item.title}</span>
                  <span className="mt-1 text-xs text-faint">
                    {new Date(item.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}

type StreamEvent =
  | { type: "meta"; provider: string; model: string; usingFallback: boolean }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; raw: string; parsed: ParsedEntry | null; warnings: GuardrailWarning[]; malformed?: boolean };

function EmptyEntry() {
  return (
    <div className="flex min-h-80 flex-col justify-center">
      <p className="font-display text-sm tracking-kicker text-forest uppercase">Waiting</p>
      <h3 className="mt-3 font-display text-2xl text-ink">The page is blank until you dump a thought.</h3>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
        Output arrives live, then locks into TITLE, DEK, TAGS, and BODY. The body always opens with the italic reconstruction warning and closes with the correction invitation.
      </p>
      <dl className="mt-8 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-faint">Title</dt>
          <dd className="mt-1 text-ink">4 to 9 concrete words. No colon.</dd>
        </div>
        <div>
          <dt className="text-faint">Dek</dt>
          <dd className="mt-1 text-ink">One plain sentence.</dd>
        </div>
        <div>
          <dt className="text-faint">Tags</dt>
          <dd className="mt-1 text-ink">Two to four lowercase labels.</dd>
        </div>
        <div>
          <dt className="text-faint">Body</dt>
          <dd className="mt-1 text-ink">Finished entry, then copy as structured text.</dd>
        </div>
      </dl>
    </div>
  );
}

function FinishedEntry({ entry }: { entry: ParsedEntry }) {
  const tags = entry.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return (
    <div>
      <p className="font-display text-xs tracking-kicker text-forest uppercase">Title</p>
      <h3 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">{entry.title || "Untitled"}</h3>
      {entry.dek ? <p className="mt-3 text-base leading-relaxed text-ink-soft">{entry.dek}</p> : null}
      {tags.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag} className="rounded-full bg-bg px-3 py-1 text-xs tracking-wide text-muted">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-8 space-y-4 border-t border-rule pt-6 text-base leading-7 text-ink">
        {entry.body.split(/\n{2,}/).map((para, i) => (
          <p key={i} className={i === 0 ? "italic text-muted" : undefined}>
            {renderInline(para)}
          </p>
        ))}
      </div>
    </div>
  );
}

function LiveDraft({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div>
      <p className="font-display text-xs tracking-kicker text-forest uppercase">
        {streaming ? "Writing" : "Draft"}
      </p>
      <pre className="mt-4 whitespace-pre-wrap font-serif text-base leading-7 text-ink">
        {text || "…"}
      </pre>
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}
