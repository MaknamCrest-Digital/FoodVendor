"""Provider-neutral identity: who a verified bearer token says the caller is.

Routes and tenant/platform lookups depend on `Identity`, never on a specific
auth provider's token format, so the provider can be replaced by adding another
`IdentityVerifier`. Identity comes only from a verified token, never from a
request body.
"""
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Identity:
    provider: str
    subject: str
    email: str | None
    # True only when the provider asserts it in a claim the user cannot edit.
    email_verified: bool


class IdentityVerifier(Protocol):
    provider: str

    def verify(self, token: str) -> Identity:
        """Return the token's identity, or raise HTTPException (401 invalid, 503 unconfigured)."""
        ...
