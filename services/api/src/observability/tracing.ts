/**
 * OpenTelemetry wiring stub (Phase 00 observability baseline).
 *
 * No OTel SDK is wired yet — instrumentation arrives in the hardening phase
 * (Phase 11). The bootstrap call site already exists in main.ts so the real
 * NodeSDK/exporter setup lands without touching application startup code.
 */
export function initTracing(): void {
  if (process.env.OTEL_ENABLED === 'true') {
    // Real OTEL NodeSDK + exporter wiring arrives with Phase 11 hardening.
  }
}
