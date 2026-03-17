"""
Hugging Face Spaces shim.

HF Spaces requires a Python entry point. Since Nebula Chat is a FastAPI app,
we tell the Space to launch it directly using uvicorn via subprocess.
The Space `sdk` in README.md is set to `gradio` only for metadata purposes;
we override the actual launch command here.
"""
import subprocess
import sys
import os

# HF Spaces exposes the app on port 7860 by default
port = int(os.environ.get("PORT", 7860))

subprocess.run(
    [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(port)],
    check=True
)
