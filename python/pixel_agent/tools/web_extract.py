"""Phase 4: IMDS/Private-IP Safe Web Extraction & Truncation (Hermes `tools/web_tools*.py`)."""

from __future__ import annotations

import ipaddress
import re
import socket
import ssl
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

BLOCKED_HOSTS = frozenset({"localhost", "metadata.google.internal", "metadata", "169.254.169.254"})


def validate_public_http_url(url: str) -> tuple[bool, str]:
    parsed = urllib.parse.urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https"):
        return False, f"Unsupported URL scheme '{parsed.scheme}'. Only http and https are allowed."
    host = (parsed.hostname or "").strip().lower()
    if not host or host in BLOCKED_HOSTS:
        return False, f"Blocked host '{host or 'empty'}' (loopback/metadata denied)."
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False, f"Blocked non-public IP address '{host}'."
    except ValueError:
        pass
    return True, parsed.geturl()


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = False
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in ("script", "style", "noscript"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in ("script", "style", "noscript"):
            self._skip = False
        elif tag.lower() in ("p", "div", "br", "li", "h1", "h2", "h3", "tr"):
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip and data.strip():
            self._parts.append(data.strip() + " ")

    def text(self) -> str:
        raw = "".join(self._parts)
        return re.sub(r"\n{3,}", "\n\n", raw).strip()


def extract_html_text(html: str, *, max_chars: int = 16_000) -> str:
    parser = _TextExtractor()
    parser.feed(html or "")
    text = parser.text()
    if len(text) > max_chars:
        return text[:max_chars].rstrip() + "\n...[truncated]"
    return text


def fetch_and_extract_url(url: str, *, max_chars: int = 16_000, timeout_s: float = 12.0) -> dict[str, Any]:
    ok, target_or_err = validate_public_http_url(url)
    if not ok:
        return {"ok": False, "error": target_or_err}
    parsed = urllib.parse.urlparse(target_or_err)
    host = parsed.hostname or ""
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return {"ok": False, "error": f"Resolved address '{ip}' for '{host}' is non-public (SSRF blocked)."}
    except Exception:
        pass

    req = urllib.request.Request(target_or_err, headers={"User-Agent": "PixelAgent/1.0"})
    ssl_ctx = ssl.create_default_context() if target_or_err.startswith("https://") else None
    try:
        with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_ctx) as resp:
            ctype = resp.headers.get("Content-Type", "")
            raw = resp.read(2_000_000).decode("utf-8", errors="replace")
        content = extract_html_text(raw, max_chars=max_chars) if "html" in ctype.lower() else raw[:max_chars]
        return {"ok": True, "url": target_or_err, "contentType": ctype, "content": content}
    except Exception as exc:
        return {"ok": False, "error": f"Web fetch failed: {exc}"}
