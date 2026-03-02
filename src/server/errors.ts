export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toHttpError(err: unknown, fallbackStatus = 500): {
  status: number;
  code: string;
  message: string;
} {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { status: fallbackStatus, code: "internal_error", message };
}
