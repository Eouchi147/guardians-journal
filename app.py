"""Streamlit UI for the Guardian's Journal Engine."""

from __future__ import annotations

import streamlit as st

from journal_engine import (
    FALLBACK_MODEL,
    JournalEngineError,
    PRIMARY_MODEL,
    generate_entry,
    resolve_api_key,
    resolve_model,
    run_guardrails,
)

st.set_page_config(page_title="Guardian's Journal", layout="wide")

st.markdown(
    """
    <style>
      html, body, [class*="css"] { font-family: Georgia, "Times New Roman", serif; }
      .stApp { background: #F3EFE6; color: #1A1916; }
    </style>
    """,
    unsafe_allow_html=True,
)

st.title("Guardian's Journal")
st.caption("Raw thought, finished entry.")

model_label = st.radio(
    "Model",
    ("Nemotron 3 Ultra", "GLM 5.2"),
    horizontal=True,
    help="Switch to GLM 5.2 if Nemotron is rate-limited.",
)
model = resolve_model("glm" if model_label.startswith("GLM") else "nemotron")

thought = st.text_area(
    "Raw thought",
    height=280,
    placeholder="Leave it messy. Voice dump, midnight note, argument with yourself.",
)

col1, _col2 = st.columns([1, 3])
with col1:
    run = st.button("Generate entry", type="primary", use_container_width=True)

if run:
    if not thought.strip():
        st.warning("Paste a raw thought first.")
    else:
        try:
            resolve_api_key()
        except JournalEngineError as exc:
            st.error(str(exc))
        else:
            placeholder = st.empty()
            pieces: list[str] = []

            def on_token(delta: str) -> None:
                pieces.append(delta)
                placeholder.code("".join(pieces), language=None)

            try:
                assembled = generate_entry(
                    thought.strip(),
                    model=model,
                    stream=True,
                    on_token=on_token,
                )
            except JournalEngineError as exc:
                st.error(str(exc))
            else:
                placeholder.code(assembled, language=None)
                warnings = run_guardrails(assembled)
                if warnings:
                    st.warning("Guardrail check failed. Raw model output is still shown.")
                    for item in warnings:
                        st.write(f"- {item.message}")
                st.download_button("Download entry", assembled, file_name="journal-entry.txt")

st.markdown(
    f"<p style='color:#6F6A62;font-size:0.85rem'>Primary: <code>{PRIMARY_MODEL}</code> · "
    f"Fallback: <code>{FALLBACK_MODEL}</code> · Free-model limits ≈ 20 RPM.</p>",
    unsafe_allow_html=True,
)
