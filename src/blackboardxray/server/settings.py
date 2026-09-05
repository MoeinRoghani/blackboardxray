"""What a deployment configures, and where each value comes from.

The library `blackboardx` reads no environment variable by rule, because it is
a library and its configuration is its arguments. This is a server. A server's
address, its database and its port are deployment concerns and are read from
the environment, which is where a deployment puts them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

#: Where the record is kept. There is no default, because a monitoring
#: platform whose database is a guess is a platform that silently watches
#: nothing.
DATABASE_VARIABLE = "BLACKBOARDXRAY_DATABASE_URL"

HOST_VARIABLE = "BLACKBOARDXRAY_HOST"
PORT_VARIABLE = "BLACKBOARDXRAY_PORT"
ORIGINS_VARIABLE = "BLACKBOARDXRAY_ALLOWED_ORIGINS"


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str = "127.0.0.1"
    port: int = 8900
    allowed_origins: tuple[str, ...] = ()

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
        )


def _whole(given: str | None, fallback: int) -> int:
    if given is None or not given.isdigit():
        return fallback
    return int(given)
