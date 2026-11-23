"""Entrypoint for `python -m pixel_agent`."""

from __future__ import annotations

import sys

from .protocol import PixelAgentProtocolServer


def main() -> int:
    # Ensure UTF-8 stdio on Windows regardless of legacy console codepage
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    return PixelAgentProtocolServer().serve_forever()


if __name__ == "__main__":
    raise SystemExit(main())
