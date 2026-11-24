"""Pixel Stage 8 Python-First Gateway, Messaging Platforms, Webhooks & Remote API."""

from .pairing import PairingManager, REMOTE_CAPABILITY_SCOPES, DEFAULT_REMOTE_SCOPES
from .platforms import (
    BasePlatformAdapter,
    InboundMessage,
    OutboundMessage,
    PLATFORM_INVENTORY,
    TelegramAdapter,
    DiscordAdapter,
    SlackAdapter,
    WhatsAppCloudAdapter,
    MatrixAdapter,
    GenericWebhookPlatformAdapter,
    create_platform_adapter,
)
from .webhooks_and_api import GatewayHttpServer, WebhookRegistry
from .runtime import GatewayService

__all__ = [
    "PairingManager",
    "REMOTE_CAPABILITY_SCOPES",
    "DEFAULT_REMOTE_SCOPES",
    "BasePlatformAdapter",
    "InboundMessage",
    "OutboundMessage",
    "PLATFORM_INVENTORY",
    "TelegramAdapter",
    "DiscordAdapter",
    "SlackAdapter",
    "WhatsAppCloudAdapter",
    "MatrixAdapter",
    "GenericWebhookPlatformAdapter",
    "create_platform_adapter",
    "GatewayHttpServer",
    "WebhookRegistry",
    "GatewayService",
]
