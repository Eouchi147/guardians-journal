import { createFileRoute } from "@tanstack/react-router";
import { streamGeneration, type GenerateRequest } from "@/lib/journal/generate.server";
import type { ModelKey } from "@/lib/journal/constants";

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: GenerateRequest;
        try {
          body = (await request.json()) as GenerateRequest;
        } catch {
          return Response.json({ error: "Request body must be JSON." }, { status: 400 });
        }
        const model: ModelKey = body.model === "glm" ? "glm" : "nemotron";
        return streamGeneration({
          thought: typeof body.thought === "string" ? body.thought : "",
          model,
          openrouterKey: typeof body.openrouterKey === "string" ? body.openrouterKey : undefined,
        });
      },
    },
  },
});
