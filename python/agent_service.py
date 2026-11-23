#!/usr/bin/env python3
"""Pixel Python Agent Service entrypoint (protocol: pixel-agent-v2)."""

from __future__ import annotations

import os
import sys

# Ensure the `python/` directory is importable regardless of cwd.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from pixel_agent.__main__ import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
