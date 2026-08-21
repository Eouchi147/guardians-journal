import { createFileRoute } from "@tanstack/react-router";
import { getStatus } from "@/lib/journal/generate.server";

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: async () => Response.json(getStatus()),
    },
  },
});
