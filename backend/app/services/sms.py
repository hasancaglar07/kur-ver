from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4


@dataclass
class SmsSendResult:
    ok: bool
    provider_ref: str | None
    error: str | None = None


class SmsProvider:
    def send(self, phone: str, message: str) -> SmsSendResult:
        raise NotImplementedError


class MockSmsProvider(SmsProvider):
    def send(self, phone: str, message: str) -> SmsSendResult:
        if not phone.strip():
            return SmsSendResult(ok=False, provider_ref=None, error="empty phone")
        return SmsSendResult(ok=True, provider_ref=f"mock-{uuid4()}")


def get_sms_provider() -> SmsProvider:
    return MockSmsProvider()
