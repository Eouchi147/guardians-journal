export const WARNING_BLOCK =
  "*This entry was reconstructed from raw, unedited notes. It is an interpretation of what was meant, not a transcript. Confirm it before you treat it as finished.*";

export const CORRECTION_INVITATION =
  "If any of this is wrong, tell me. I will correct it.";

export const PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
export const FALLBACK_MODEL = "z-ai/glm-5.2:free";
export const XAI_MODEL = "grok-4.5";

export const TEMPERATURE = 0.4;
export const MAX_TOKENS = 2500;

export const MODELS = {
  nemotron: {
    id: PRIMARY_MODEL,
    label: "Nemotron 3 Ultra",
    hint: "Primary. Frontier reasoning, 1M context.",
  },
  glm: {
    id: FALLBACK_MODEL,
    label: "GLM 5.2",
    hint: "Use if Nemotron is rate-limited.",
  },
} as const;

export type ModelKey = keyof typeof MODELS;
