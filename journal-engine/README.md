# Guardian's Journal Engine

Turns one raw, unedited thought into a finished journal entry.

The engine embeds the full Guardian's Journal system prompt, calls OpenRouter, and returns this structure and nothing else:

```
TITLE
<4 to 9 word concrete title, no colon, no subtitle>

DEK
<one plain sentence>

TAGS
<two to four lowercase tags, comma-separated>

BODY
<the full entry, starting with the italic warning block>
```

If an unverifiable citation had to be dropped, a `FLAGGED` section is appended after `BODY`.

## Get a free OpenRouter key

1. Open [openrouter.ai](https://openrouter.ai) and create an account.
2. Go to [openrouter.ai/keys](https://openrouter.ai/keys) and create a key.
3. Export it:

```bash
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Or copy `.env.example` to `.env` and paste the key there.

Free-model rate limits are roughly **20 requests per minute** and **50 to 1000 requests per day**, depending on account tier. If Nemotron is rate-limited, switch to GLM 5.2.

## Setup

Python 3.11 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## CLI

```bash
python journal_engine.py "raw thought here"
```

Interactive mode reads stdin until EOF (Ctrl-D):

```bash
python journal_engine.py
```

Switch to the fallback free model:

```bash
python journal_engine.py --model glm "raw thought here"
```

Print the finished entry at once instead of streaming:

```bash
python journal_engine.py --no-stream "raw thought here"
```

## Web UI (Streamlit)

```bash
python journal_engine.py --web
```

or

```bash
streamlit run streamlit_app.py
```

Paste a thought in the large text area and click **Generate entry**. The formatted output appears in a copyable block.

## Change the model

Default: `nvidia/nemotron-3-ultra-550b-a55b:free`

Fallback: `z-ai/glm-5.2:free`

If a stronger free model appears on OpenRouter, set:

```bash
export JOURNAL_MODEL=provider/new-free-model:free
```

or edit `PRIMARY_MODEL` / `FALLBACK_MODEL` in `journal_engine.py`.

Temperature is `0.4`. Max tokens is `2500`.

## Guardrails

After generation the engine checks:

- No em dashes or en dashes
- Italic warning block at the top of BODY
- Correction invitation at the bottom of BODY
- Exact section headers TITLE / DEK / TAGS / BODY

If a check fails, a warning is printed and the raw model output is still returned.
