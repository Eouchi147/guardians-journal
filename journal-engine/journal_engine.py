#!/usr/bin/env python3
"""Guardian's Journal Engine.

CLI:
    python journal_engine.py "raw thought here"
    python journal_engine.py --model glm "raw thought here"
    python journal_engine.py            # interactive: stdin until EOF
    python journal_engine.py --web      # Streamlit UI
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from typing import Callable, Iterable

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from system_prompt import CORRECTION_INVITATION, SYSTEM_PROMPT, WARNING_BLOCK

PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
FALLBACK_MODEL = "z-ai/glm-5.2:free"
TEMPERATURE = 0.4
MAX_TOKENS = 2500
OPENROUTER_BASE = "https://openrouter.ai/api/v1"

EM_DASH = "\u2014"
EN_DASH = "\u2013"


class JournalEngineError(RuntimeError):
    pass


@dataclass
class GuardrailWarning:
    code: str
    message: str


def _client(api_key: str):
    from openai import OpenAI

    return OpenAI(
        api_key=api_key,
        base_url=OPENROUTER_BASE,
        default_headers={
            "HTTP-Referer": "https://guardians-journal.app",
            "X-Title": "Guardian's Journal",
        },
    )


def resolve_api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise JournalEngineError(
            "Missing OPENROUTER_API_KEY. Get a free key at https://openrouter.ai/keys "
            "and export it, or copy .env.example to .env."
        )
    return key


def resolve_model(name: str) -> str:
    if name in ("glm", "fallback", FALLBACK_MODEL):
        return os.environ.get("JOURNAL_FALLBACK_MODEL", FALLBACK_MODEL)
    return os.environ.get("JOURNAL_MODEL", PRIMARY_MODEL)


def _is_transient(exc: Exception) -> bool:
    name = type(exc).__name__
    if name in {"RateLimitError", "APIConnectionError", "APITimeoutError", "InternalServerError"}:
        return True
    status = getattr(exc, "status_code", None)
    return status in {408, 409, 429, 500, 502, 503, 529}


def generate_entry(
    thought: str,
    *,
    model: str = PRIMARY_MODEL,
    stream: bool = True,
    api_key: str | None = None,
    on_token: Callable[[str], None] | None = None,
) -> str:
    """Turn one raw thought into a finished journal entry."""
    key = api_key or resolve_api_key()
    client = _client(key)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": thought},
    ]

    def _create(streaming: bool):
        return client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
            stream=streaming,
        )

    last_error: Exception | None = None
    for attempt in (1, 2):
        try:
            if stream:
                pieces: list[str] = []
                completion = _create(True)
                for chunk in completion:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        pieces.append(delta)
                        if on_token is not None:
                            on_token(delta)
                        else:
                            sys.stdout.write(delta)
                            sys.stdout.flush()
                if pieces and on_token is None:
                    sys.stdout.write("\n")
                return "".join(pieces)
            completion = _create(False)
            return completion.choices[0].message.content or ""
        except Exception as exc:  # noqa: BLE001 - surface provider errors cleanly
            last_error = exc
            if attempt == 1 and _is_transient(exc):
                wait = 1.2 if "RateLimit" in type(exc).__name__ else 0.4
                time.sleep(wait)
                continue
            raise JournalEngineError(_format_provider_error(exc)) from exc
    raise JournalEngineError(_format_provider_error(last_error))



def _format_provider_error(exc: Exception | None) -> str:
    if exc is None:
        return "The model request failed."
    name = type(exc).__name__
    status = getattr(exc, "status_code", None)
    if name == "RateLimitError" or status == 429:
        return (
            "Rate limit hit on the free OpenRouter model (about 20 RPM / 50 to 1000 RPD). "
            "Wait, or rerun with --model glm."
        )
    if name in {"AuthenticationError"} or status in {401, 403}:
        return "OPENROUTER_API_KEY was rejected. Check the key at https://openrouter.ai/keys."
    if status:
        return f"Model request failed ({status}): {exc}"
    return f"Model request failed: {exc}"


def run_guardrails(text: str) -> list[GuardrailWarning]:
    warnings: list[GuardrailWarning] = []
    if not all(f"\n{h}\n" in f"\n{text}\n" or text.startswith(f"{h}\n") for h in ("TITLE", "DEK", "TAGS", "BODY")):
        # Also accept headers as their own lines without relying on surrounding newlines only
        missing = [h for h in ("TITLE", "DEK", "TAGS", "BODY") if not _has_header(text, h)]
        if missing:
            warnings.append(
                GuardrailWarning(
                    "headers",
                    "Output is missing one or more exact section headers: " + ", ".join(missing) + ".",
                )
            )
    if EM_DASH in text or EN_DASH in text:
        warnings.append(
            GuardrailWarning("dashes", "Em dashes or en dashes appear in the output. The house style forbids them.")
        )
    body = _section(text, "BODY")
    if WARNING_BLOCK not in body and "reconstructed from raw, unedited notes" not in body.lower():
        warnings.append(
            GuardrailWarning("warning-block", "The italic warning block is missing from the top of BODY.")
        )
    elif body and not (body.startswith(WARNING_BLOCK) or body.startswith("*This entry was reconstructed")):
        warnings.append(
            GuardrailWarning("warning-block-position", "The italic warning block is not at the top of BODY.")
        )
    if CORRECTION_INVITATION not in body:
        warnings.append(
            GuardrailWarning("correction", "The correction invitation is missing from the bottom of BODY.")
        )
    elif body and not body.endswith(CORRECTION_INVITATION):
        warnings.append(
            GuardrailWarning("correction-position", "The correction invitation is not at the bottom of BODY.")
        )
    return warnings


def _has_header(text: str, header: str) -> bool:
    for line in text.splitlines():
        if line.strip() == header:
            return True
    return False


def _section(text: str, header: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    capture = False
    collected: list[str] = []
    for line in lines:
        if line.strip() in {"TITLE", "DEK", "TAGS", "BODY", "FLAGGED"}:
            if line.strip() == header:
                capture = True
                continue
            if capture:
                break
        elif capture:
            collected.append(line)
    return "\n".join(collected).strip()


def print_warnings(warnings: Iterable[GuardrailWarning]) -> None:
    items = list(warnings)
    if not items:
        return
    sys.stderr.write("\nWARNING: guardrail check failed. Raw model output is still above.\n")
    for item in items:
        sys.stderr.write(f"  - {item.message}\n")


def read_stdin() -> str:
    if sys.stdin.isatty():
        sys.stderr.write("Paste the raw thought, then Ctrl-D (Ctrl-Z on Windows) when done.\n")
    return sys.stdin.read()


def launch_web() -> None:
    try:
        from streamlit.web import cli as stcli
    except ImportError as exc:
        raise JournalEngineError(
            "Streamlit is not installed. Run: pip install -r requirements.txt"
        ) from exc
    app = os.path.join(os.path.dirname(os.path.abspath(__file__)), "streamlit_app.py")
    sys.argv = ["streamlit", "run", app, "--server.headless=true"]
    raise SystemExit(stcli.main())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Turn one raw thought into a finished Guardian's Journal entry."
    )
    parser.add_argument("thought", nargs="?", help="Raw, unedited thought. Omit to read stdin.")
    parser.add_argument(
        "--model",
        choices=("nemotron", "glm"),
        default="nemotron",
        help="nemotron (default) or glm if rate-limited.",
    )
    parser.add_argument("--no-stream", action="store_true", help="Print the finished entry at once.")
    parser.add_argument("--web", action="store_true", help="Launch the Streamlit UI.")
    args = parser.parse_args(argv)

    if args.web:
        try:
            launch_web()
        except JournalEngineError as exc:
            sys.stderr.write(f"{exc}\n")
            return 1
        return 0

    thought = args.thought if args.thought is not None else read_stdin()
    thought = thought.strip()
    if not thought:
        sys.stderr.write("No thought provided.\n")
        return 1

    model = resolve_model(args.model)
    try:
        text = generate_entry(thought, model=model, stream=not args.no_stream)
    except JournalEngineError as exc:
        sys.stderr.write(f"{exc}\n")
        return 1

    if args.no_stream:
        sys.stdout.write(text)
        if not text.endswith("\n"):
            sys.stdout.write("\n")

    print_warnings(run_guardrails(text))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
