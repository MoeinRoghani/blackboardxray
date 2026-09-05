# blackboardxray

Observability for [blackboard](https://github.com/MoeinRoghani/blackboardx) runs.
One server, one database, one interface. An application reaches it by naming an
endpoint and a token.

## Why it exists

`blackboardx` makes the record durable and leaves the run in the process. The
store holds the regions, the contributions, the premise versions, the sequence,
the two deadlines and the outcome. It does not hold who was notified, who
acknowledged, what admission refused, or which delivery failed, and the
library's logging rule forbids logging any of them on the grounds that the agent
already saw them.

So the record is observable and the run is not. That is what this is for.

## Install and run

```
pip install 'blackboardxray[server]'
createdb blackboardxray
export BLACKBOARDXRAY_DATABASE_URL=postgresql://localhost/blackboardxray
blackboardxray key production
blackboardxray serve
```

`key` prints a token once. The database holds its hash and cannot print it
again.

## Observe a run

```python
from blackboardxray import Xray

xray = Xray(endpoint="http://localhost:8900", token="bxr_...")

model = xray.create_model(
    board_id="incident-4471",
    store=SqliteStore("incidents.sqlite3"),
    regions=[Level("platform"), Premise("window")],
    premises={"window": ["20:00", "22:00"]},
    agents=[Agent(name="ocp", notify=investigate)],
    limits=RunLimits(wall_clock=timedelta(minutes=10), idle=timedelta(seconds=30)),
)
```

Every argument is the one `blackboard.create_model` takes and means the same
thing. What comes back is the library's own model. The library is not modified
and is not asked to grow a hook.

An agent deployed as its own service wraps its board instead:

```python
board = xray.agent_board(BoardClient(base_url=..., board_id=..., agent="ocp"))
```

## What is recorded

Ten kinds, in the blackboard's own vocabulary.

| Kind | When |
| --- | --- |
| `run.opened` | A model was created, with its regions, premises and limits |
| `agent.registered` | An agent joined, at creation or afterwards |
| `write.admitted` | A level write passed admission and reached the board |
| `write.refused` | A write was refused, with the cause and the rule's reason |
| `write.conflicted` | A premise write named a version no longer current |
| `premise.set` | A premise write reached the board |
| `notification.dispatched` | A notification left for one agent |
| `notification.acknowledged` | An agent reported it had stopped |
| `notification.failed` | Delivery raised, so the agent never received it |
| `run.closed` | The run closed, with its outcome and who did not finish |

A contribution's content is recorded, truncated past 4kB. A deployment whose
contributions may not leave the process passes `content_limit=0`, which records
the size and the shape and none of the content.

## License

Apache-2.0.
