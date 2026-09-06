"""What one sender is allowed to do to the platform.

A token bucket per key. A sender that goes over gets a 429 with `Retry-After`,
which the client already knows how to obey: its transport reads that header,
waits the time it names, and tries again, so being limited costs a delay rather
than the events.

**Held in memory, and that is stated rather than hidden.** With several
replicas each holds its own bucket, so the effective limit is the configured
one times the number of replicas. The alternative is a round trip to Postgres
or Redis on the hottest path in the platform, to defend against a sender the
operator controls and can turn off. This is a fairness mechanism against a
misconfigured loop, not a defence against an attacker, and the documentation
says so.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

#: How many events a key may send per second, sustained.
DEFAULT_RATE = 2_000.0

#: How much it may send in one go after being quiet. A run closing sends a
#: burst, so a bucket that cannot hold one punishes the normal case.
DEFAULT_BURST = 20_000.0

#: How many keys are tracked before the least recently used are forgotten. A
#: bound, because a deployment issuing keys in a loop should not be able to
#: grow this without limit.
MAX_TRACKED = 10_000


@dataclass
class Bucket:
    tokens: float
    at: float


@dataclass
class Limiter:
    """A token bucket per key, refilled by the clock."""

    rate: float = DEFAULT_RATE
    burst: float = DEFAULT_BURST
    _buckets: dict[str, Bucket] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def take(self, key: str, cost: int) -> float:
        """Takes `cost` from this key's bucket. Answers seconds to wait, or 0.

        A batch at or above the whole bucket is not refused for ever, because
        that would mean a batch bigger than the burst could never be sent at
        all. It waits for a full bucket and then spends all of it. Letting it
        straight through instead, which is what this did first, meant a sender
        whose batches were larger than the configured burst was never limited
        at any rate: every call took the same shortcut.
        """
        if self.rate <= 0:
            return 0.0
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                if len(self._buckets) >= MAX_TRACKED:
                    self._forget_oldest()
                bucket = Bucket(tokens=self.burst, at=now)
                self._buckets[key] = bucket
            bucket.tokens = min(
                self.burst, bucket.tokens + (now - bucket.at) * self.rate
            )
            bucket.at = now
            if cost >= self.burst:
                if bucket.tokens >= self.burst:
                    bucket.tokens = 0.0
                    return 0.0
                return (self.burst - bucket.tokens) / self.rate
            if bucket.tokens >= cost:
                bucket.tokens -= cost
                return 0.0
            missing = cost - bucket.tokens
            return missing / self.rate

    def _forget_oldest(self) -> None:
        oldest = min(self._buckets, key=lambda key: self._buckets[key].at)
        del self._buckets[oldest]
