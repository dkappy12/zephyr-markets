type LogLevel = "info" | "warn" | "error";

type LogInput = {
  scope: string;
  event: string;
  level?: LogLevel;
  data?: Record<string, unknown>;
};

function emit(level: LogLevel, payload: Record<string, unknown>) {
  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }
  if (level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }
  console.info(JSON.stringify(payload));
}

export function logEvent(input: LogInput): void {
  emit(input.level ?? "info", {
    ts: new Date().toISOString(),
    scope: input.scope,
    event: input.event,
    ...(input.data ?? {}),
  });
}
