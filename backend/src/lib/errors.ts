export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly detail?: unknown;

  constructor(code: string, status = 500, detail?: unknown) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
