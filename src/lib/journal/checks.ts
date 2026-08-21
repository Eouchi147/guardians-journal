import { CORRECTION_INVITATION, WARNING_BLOCK } from "./constants";
import type { ParsedEntry } from "./parse";

export type GuardrailWarning = {
  code: string;
  message: string;
};

const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

export function runGuardrails(raw: string, parsed: ParsedEntry | null): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];
  const source = raw;

  if (!/^TITLE\s*$/m.test(source) || !/^DEK\s*$/m.test(source) || !/^TAGS\s*$/m.test(source) || !/^BODY\s*$/m.test(source)) {
    warnings.push({
      code: "headers",
      message: "Output is missing one or more exact section headers: TITLE, DEK, TAGS, BODY.",
    });
  }

  if (source.includes(EM_DASH) || source.includes(EN_DASH)) {
    warnings.push({
      code: "dashes",
      message: "Em dashes or en dashes appear in the output. The house style forbids them.",
    });
  }

  const body = parsed?.body?.trim() ?? extractBody(source);
  if (!body.includes(WARNING_BLOCK) && !body.toLowerCase().includes("reconstructed from raw, unedited notes")) {
    warnings.push({
      code: "warning-block",
      message: "The italic warning block is missing from the top of BODY.",
    });
  } else if (body && !body.startsWith(WARNING_BLOCK) && !body.startsWith("*This entry was reconstructed")) {
    warnings.push({
      code: "warning-block-position",
      message: "The italic warning block is not at the top of BODY.",
    });
  }

  if (!body.includes(CORRECTION_INVITATION)) {
    warnings.push({
      code: "correction",
      message: "The correction invitation is missing from the bottom of BODY.",
    });
  } else if (body && !body.endsWith(CORRECTION_INVITATION)) {
    warnings.push({
      code: "correction-position",
      message: "The correction invitation is not at the bottom of BODY.",
    });
  }

  return warnings;
}

function extractBody(raw: string): string {
  const match = raw.match(/^BODY\s*$([\s\S]*?)(?=^FLAGGED\s*$|$)/m);
  return (match?.[1] ?? "").trim();
}
