"""Credentials, and the identifiers that name things in a URL.

Nothing here touches the database. It is the arithmetic of authentication:
turning a password into something safe to store, turning it back into a yes or
no, and minting the opaque identifiers the rest of the platform hands out.

**Passwords are hashed with scrypt**, from the standard library, so the server
takes no cryptography dependency. The stored form names the algorithm and its
cost, which is what lets the cost be raised later: an old hash still verifies
against the parameters it was made with, and is replaced with a stronger one
the next time its owner signs in successfully. A scheme that hard codes its
cost can only be changed by locking everybody out.

**Everything secret is stored as a SHA-256 digest**: session tokens, API keys
and invite tokens alike. These are already high entropy random values, so they
need no salt and no slow hash. A password is different, because a person chose
it, and that is the only thing here that gets scrypt.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass

#: scrypt's cost. `n` is the work factor, `r` the block size, `p` the
#: parallelism. At these values one hash costs about seventy milliseconds and
#: thirty-four megabytes, which is the point: an attacker with the database
#: pays that per guess, and a person signing in pays it once.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1

#: Python's scrypt refuses anything over thirty-two megabytes unless told
#: otherwise, and the parameters above need thirty-four. Left at the default,
#: every sign in raises rather than being slow, which is a failure that only
#: shows up once real parameters are chosen.
SCRYPT_MAXMEM = 128 * 1024 * 1024

#: Length is the only rule. Composition rules push people towards `Passw0rd!`
#: and away from the long memorable phrases that are actually harder to guess,
#: which is why NIST stopped recommending them.
MINIMUM_PASSWORD = 10

#: A ceiling, because scrypt hashes whatever it is given and a megabyte of
#: password is a way to make one request cost a lot of server.
MAXIMUM_PASSWORD = 1024

#: How long a session lasts without being used, and the longest it may live.
SESSION_IDLE_DAYS = 14

#: How many characters of randomness a session token carries.
SESSION_BYTES = 32

#: How long an invite may be accepted for.
INVITE_DAYS = 7


class IdentityError(Exception):
    """A credential could not be made or read."""


class WeakPassword(IdentityError):
    """The password does not meet the one rule there is."""


@dataclass(frozen=True)
class Secret:
    """A credential and the digest of it. The value is readable once."""

    value: str
    digest: str


def check_password(password: str) -> None:
    """Raises unless the password may be used."""
    if len(password) < MINIMUM_PASSWORD:
        raise WeakPassword(
            f"a password is at least {MINIMUM_PASSWORD} characters."
            " A phrase you can remember beats a short word you cannot."
        )
    if len(password) > MAXIMUM_PASSWORD:
        raise WeakPassword(f"a password is at most {MAXIMUM_PASSWORD} characters")


def hash_password(password: str) -> str:
    """Returns the stored form: the algorithm, its cost, the salt and the key."""
    check_password(password)
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=32,
        maxmem=SCRYPT_MAXMEM,
    )
    return "$".join(
        [
            "scrypt",
            str(SCRYPT_N),
            str(SCRYPT_R),
            str(SCRYPT_P),
            _encode(salt),
            _encode(key),
        ]
    )


def verify_password(password: str, stored: str) -> bool:
    """Answers whether the password made this hash. Never raises."""
    try:
        algorithm, n, r, p, salt, key = stored.split("$")
        if algorithm != "scrypt":
            return False
        computed = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(_decode(key)),
            maxmem=SCRYPT_MAXMEM,
        )
    except (ValueError, TypeError, MemoryError):
        # A stored hash this build cannot read is not a hash that matches. It
        # must not be an exception either: that would turn one corrupt row into
        # a five hundred on a sign in page.
        return False
    return hmac.compare_digest(computed, _decode(key))


def needs_rehash(stored: str) -> bool:
    """Whether this hash was made with parameters weaker than today's.

    Answered on a successful sign in, which is the one moment the password is
    in hand and can be hashed again. Raising the cost is otherwise a change
    that applies only to people who join afterwards.
    """
    try:
        algorithm, n, r, p, _, _ = stored.split("$")
    except ValueError:
        return True
    return (algorithm, int(n), int(r), int(p)) != (
        "scrypt",
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
    )


def digest(value: str) -> str:
    """The stored form of a high entropy secret."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def issue(prefix: str, *, size: int = SESSION_BYTES) -> Secret:
    """Mints a secret and the digest to store beside it."""
    value = f"{prefix}{secrets.token_urlsafe(size)}"
    return Secret(value=value, digest=digest(value))


def public_id(kind: str) -> str:
    """An opaque identifier for something a URL names.

    A serial primary key in a URL says how many of a thing exist and invites
    walking the range. This says nothing.
    """
    return f"{kind}_{secrets.token_hex(10)}"


def _encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
