import { runGuardrails } from "./checks";
import {
  FALLBACK_MODEL,
  MAX_TOKENS,
  MODELS,
  PRIMARY_MODEL,
  TEMPERATURE,
  XAI_MODEL,
  type ModelKey,
} from "./constants";
import { parseEntry } from "./parse";
import { SYSTEM_PROMPT } from "./system-prompt";

export type GenerateRequest = {
  thought: string;
  model?: ModelKey;
  openrouterKey?: string;
};

type ChatTarget = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: "openrouter" | "xai";
  extraHeaders?: Record<string, string>;
};

function resolveTarget(req: GenerateRequest): ChatTarget {
  const modelId = req.model === "glm" ? FALLBACK_MODEL : PRIMARY_MODEL;
  const userKey = req.openrouterKey?.trim();
  const envOpenRouter = process.env.OPENROUTER_API_KEY?.trim();
  const openrouterKey = userKey || envOpenRouter;
  const xaiKey = process.env.XAI_API_KEY?.trim();

  if (openrouterKey) {
    return {
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: openrouterKey,
      model: modelId,
      provider: "openrouter",
      extraHeaders: {
        "HTTP-Referer": "https://guardians-journal.app",
        "X-Title": "Guardian's Journal",
      },
    };
  }

  if (xaiKey) {
    return {
      baseUrl: "https://api.x.ai/v1",
      apiKey: xaiKey,
      model: XAI_MODEL,
      provider: "xai",
    };
  }

  throw Object.assign(new Error("missing_api_key"), { code: "missing_api_key" });
}

export function describeBackend(req: GenerateRequest) {
  try {
    const target = resolveTarget(req);
    const requested = req.model === "glm" ? MODELS.glm : MODELS.nemotron;
    return {
      provider: target.provider,
      model: target.model,
      requestedId: requested.id,
      usingFallback: target.provider === "xai",
    };
  } catch {
    return {
      provider: "none" as const,
      model: "",
      requestedId: req.model === "glm" ? MODELS.glm.id : MODELS.nemotron.id,
      usingFallback: false,
    };
  }
}

function isTransient(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function errorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "The API key was rejected. Check OPENROUTER_API_KEY, or paste a valid OpenRouter key in Settings.";
  }
  if (status === 429) {
    return "Rate limit hit. Wait a moment, or switch to GLM 5.2 in the model toggle.";
  }
  if (status >= 500) {
    return `The model provider failed (${status}). Retry once, or switch models.`;
  }
  const trimmed = body.slice(0, 280).trim();
  return trimmed ? `Model request failed (${status}): ${trimmed}` : `Model request failed (${status}).`;
}

async function postChat(target: ChatTarget, thought: string, stream: boolean): Promise<Response> {
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
      ...(target.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: target.model,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      stream,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: thought },
      ],
    }),
  });
  return res;
}

async function postChatWithRetry(target: ChatTarget, thought: string, stream: boolean): Promise<Response> {
  let res = await postChat(target, thought, stream);
  if (!res.ok && isTransient(res.status)) {
    const wait = res.status === 429 ? 1200 : 400;
    await new Promise((r) => setTimeout(r, wait));
    res = await postChat(target, thought, stream);
  }
  return res;
}

export async function streamGeneration(req: GenerateRequest): Promise<Response> {
  const thought = req.thought.trim();
  if (!thought) {
    return Response.json({ error: "Paste a raw thought first." }, { status: 400 });
  }

  let target: ChatTarget;
  try {
    target = resolveTarget(req);
  } catch {
    return Response.json(
      {
        error:
          "No API key found. Add OPENROUTER_API_KEY, or paste an OpenRouter key in Settings. Get a free key at openrouter.ai/keys.",
        code: "missing_api_key",
      },
      { status: 401 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({
        type: "meta",
        provider: target.provider,
        model: target.model,
        usingFallback: target.provider === "xai",
      });

      try {
        const res = await postChatWithRetry(target, thought, true);
        if (!res.ok) {
          const body = await res.text();
          send({ type: "error", message: errorMessage(res.status, body), status: res.status });
          controller.close();
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          send({ type: "error", message: "The model returned an empty stream." });
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data) as {
                choices?: { delta?: { content?: string }; message?: { content?: string } }[];
              };
              const piece = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
              if (piece) {
                full += piece;
                send({ type: "delta", text: piece });
              }
            } catch {
              // ignore malformed sse chunks
            }
          }
        }

        const parsed = parseEntry(full);
        const warnings = runGuardrails(full, parsed);
        send({
          type: "done",
          raw: full,
          parsed,
          warnings,
          malformed: !parsed,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function getStatus() {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    xai: Boolean(process.env.XAI_API_KEY?.trim()),
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
  };
}
