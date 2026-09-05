"""Running the platform.

    blackboardxray serve
    blackboardxray project <slug>
    blackboardxray key <slug> [name]

`serve` runs the server. `project` creates one and is safe to run again.
`key` issues a token and prints it once, because the database holds its hash
and cannot print it later.
"""

from __future__ import annotations

import sys

from blackboardxray.server.db import Database
from blackboardxray.server.settings import Settings


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    command = arguments[0] if arguments else "serve"
    settings = Settings.from_env()
    if command == "serve":
        import uvicorn

        from blackboardxray.server.app import build

        uvicorn.run(build(settings), host=settings.host, port=settings.port)
        return 0
    database = Database(settings.database_url)
    try:
        if command == "project":
            if len(arguments) < 2:
                print("usage: blackboardxray project <slug> [name]")
                return 2
            project = database.create_project(arguments[1], _at(arguments, 2))
            print(f"project {project.slug} is id {project.id}")
            return 0
        if command == "key":
            if len(arguments) < 2:
                print("usage: blackboardxray key <slug> [name]")
                return 2
            project = database.create_project(arguments[1])
            issued = database.issue_key(project.id, _at(arguments, 2) or "")
            print(f"project: {project.slug}")
            print(f"token:   {issued.token}")
            print("This token is shown once. The database holds its hash.")
            return 0
        print(__doc__)
        return 2
    finally:
        database.close()


def _at(arguments: list[str], index: int) -> str | None:
    return arguments[index] if len(arguments) > index else None


if __name__ == "__main__":
    raise SystemExit(main())
