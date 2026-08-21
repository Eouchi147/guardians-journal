# Guardian's Journal

A private desk that turns one man's raw, unedited thoughts into a finished journal entry.

Paste the messy note. The engine returns:

```
TITLE
DEK
TAGS
BODY
```

BODY always opens with the italic reconstruction warning and closes with the correction invitation. If an unverifiable citation had to be dropped, a `FLAGGED` section follows.

## Use it online (Vercel)

This repo is a Vite app. Vercel must use the **Vite** (or **Other**) framework preset, not Python. Streamlit is local-only and lives under `journal-engine/`.

1. Import the GitHub repo in Vercel
2. Framework Preset: **Vite** (or Other). Build command: `npm run build`
3. Add env var `OPENROUTER_API_KEY` (free key from [openrouter.ai/keys](https://openrouter.ai/keys))
4. Deploy

You can also paste an OpenRouter key in the desk UI without setting the env var.

## Python engine (CLI + Streamlit)

Local only. Streamlit cannot run on Vercel.

```bash
cd journal-engine
pip install -r requirements.txt
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
python journal_engine.py "raw thought here"
python journal_engine.py --web
```

Full setup, rate-limit notes, and how to change the model ID: [journal-engine/README.md](journal-engine/README.md).

## OpenRouter

1. Create a free account at [openrouter.ai](https://openrouter.ai)
2. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys)
3. Free-model limits are about **20 RPM** and **50 to 1000 RPD**

Default model: `nvidia/nemotron-3-ultra-550b-a55b:free`  
Fallback: `z-ai/glm-5.2:free`
