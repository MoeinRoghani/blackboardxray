"""Observability for blackboard runs.

Two halves ship in one package. The client half wraps a run and sends what it
sees, and needs `blackboardx`. The server half stores what arrives and serves
the interface, and needs `fastapi` and `psycopg`. Neither needs the other, so
each is imported on demand and the absence of one is reported naming what to
install rather than as an import error from a module you did not ask for.
"""

from typing import TYPE_CHECKING, Any

from blackboardxray.events import (
    SCHEMA_VERSION,
    Event,
    EventError,
    EventKind,
    XrayError,
    carry,
)

if TYPE_CHECKING:
    from blackboardxray._transport import Dropped, Sender, Transport
    from blackboardxray.observe import Xray

__all__ = [
    "SCHEMA_VERSION",
    "Dropped",
    "Event",
    "EventError",
    "EventKind",
    "Sender",
    "Transport",
    "Xray",
    "XrayError",
    "carry",
]

_ON_DEMAND = {
    "Xray": ("blackboardxray.observe", "blackboardx"),
    "Dropped": ("blackboardxray._transport", "blackboardx"),
    "Sender": ("blackboardxray._transport", "blackboardx"),
    "Transport": ("blackboardxray._transport", "blackboardx"),
}


def __getattr__(name: str) -> Any:
    """Imports a name that needs a half of the package, and says which one."""
    entry = _ON_DEMAND.get(name)
    if entry is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, needs = entry
    from importlib import import_module

    try:
        module = import_module(module_name)
    except ImportError as absent:
        raise ImportError(f"{name} needs {needs}: pip install {needs}") from absent
    return getattr(module, name)
