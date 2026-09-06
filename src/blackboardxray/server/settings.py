"""What a deployment configures, and where each value comes from.

The library `blackboardx` reads no environment variable by rule, because it is
a library and its configuration is its arguments. This is a server. A server's
address, its database and its port are deployment concerns and are read from
the environment, which is where a deployment puts them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

#: Where the record is kept. There is no default, because a monitoring
#: platform whose database is a guess is a platform that silently watches
#: nothing.
DATABASE_VARIABLE = "BLACKBOARDXRAY_DATABASE_URL"

HOST_VARIABLE = "BLACKBOARDXRAY_HOST"
PORT_VARIABLE = "BLACKBOARDXRAY_PORT"
ORIGINS_VARIABLE = "BLACKBOARDXRAY_ALLOWED_ORIGINS"

#: Whether a stranger who reaches the sign in page may make themselves an
#: account. Off, because the common self hosted case is one instance reachable
#: inside a company and the common mistake is one reachable outside it. The
#: first account is made by the setup screen either way; this governs everyone
#: after them, who otherwise arrive by invitation.
SIGNUP_VARIABLE = "BLACKBOARDXRAY_ALLOW_SIGNUP"


@dataclass(frozen=True)
class Provision:
    """What to create on first boot, for a deployment with no hands on it.

    A compose file or a chart sets these and the platform comes up with an
    organization, a project, an account and a key already in place. Applied
    only where each thing is absent, so restarting does not undo a change
    somebody made afterwards.
    """

    org_slug: str = ""
    org_name: str = ""
    project_slug: str = ""
    project_name: str = ""
    user_email: str = ""
    user_password: str = ""
    user_name: str = ""
    api_key: str = ""

    @property
    def wanted(self) -> bool:
        return bool(self.org_slug or self.user_email or self.project_slug)

    @classmethod
    def from_env(cls) -> Provision:
        at = os.environ.get
        return cls(
            org_slug=at("BLACKBOARDXRAY_INIT_ORG_SLUG", "").strip(),
            org_name=at("BLACKBOARDXRAY_INIT_ORG_NAME", "").strip(),
            project_slug=at("BLACKBOARDXRAY_INIT_PROJECT_SLUG", "").strip(),
            project_name=at("BLACKBOARDXRAY_INIT_PROJECT_NAME", "").strip(),
            user_email=at("BLACKBOARDXRAY_INIT_USER_EMAIL", "").strip(),
            user_password=at("BLACKBOARDXRAY_INIT_USER_PASSWORD", ""),
            user_name=at("BLACKBOARDXRAY_INIT_USER_NAME", "").strip(),
            api_key=at("BLACKBOARDXRAY_INIT_API_KEY", "").strip(),
        )


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str = "127.0.0.1"
    port: int = 8900
    allowed_origins: tuple[str, ...] = ()
    allow_signup: bool = False
    #: Events per second one key may send, and what it may send in one go after
    #: being quiet. Held per process, so several replicas each allow this much.
    ingest_rate: float = 2_000.0
    ingest_burst: float = 20_000.0
    provision: Provision = field(default_factory=Provision)

    @classmethod
    def from_env(cls) -> Settings:
        database_url = os.environ.get(DATABASE_VARIABLE, "")
        if not database_url:
            raise SystemExit(
                f"{DATABASE_VARIABLE} is not set. It names the Postgres database"
                " this platform keeps its record in, for example"
                " postgresql://localhost/blackboardxray"
            )
        origins = os.environ.get(ORIGINS_VARIABLE, "")
        return cls(
            database_url=database_url,
            host=os.environ.get(HOST_VARIABLE, "127.0.0.1"),
            port=_whole(os.environ.get(PORT_VARIABLE), 8900),
            allowed_origins=tuple(
                part.strip() for part in origins.split(",") if part.strip()
            ),
            allow_signup=_yes(os.environ.get(SIGNUP_VARIABLE)),
            ingest_rate=_number(os.environ.get("BLACKBOARDXRAY_INGEST_RATE"), 2_000.0),
            ingest_burst=_number(
                os.environ.get("BLACKBOARDXRAY_INGEST_BURST"), 20_000.0
            ),
            provision=Provision.from_env(),
        )


def _yes(given: str | None) -> bool:
    """Reads a flag the way a person writes one in a compose file."""
    return (given or "").strip().lower() in {"1", "true", "yes", "on"}


def _number(given: str | None, fallback: float) -> float:
    try:
        return float(given) if given else fallback
    except ValueError:
        return fallback


def _whole(given: str | None, fallback: int) -> int:
    if given is None or not given.isdigit():
        return fallback
    return int(given)
