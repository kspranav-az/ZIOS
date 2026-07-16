"""OpenTelemetry wiring stub (Phase 00 observability baseline).

No OTel SDK is wired yet — instrumentation arrives in the hardening phase
(Phase 11). The call site already exists in main.py so the real setup lands
without touching application startup code.
"""

import os


def init_tracing() -> None:
    if os.environ.get("OTEL_ENABLED") == "true":
        # Real OTEL SDK + exporter wiring arrives with Phase 11 hardening.
        pass
