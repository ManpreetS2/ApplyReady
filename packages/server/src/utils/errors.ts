import type { ApiError } from "@applyready/shared";

export class AppError extends Error {
  code: string;
  status: number;
  details?: unknown;
  nextSteps?: string[];

  constructor(
    code: string,
    message: string,
    status = 400,
    nextSteps?: string[],
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.nextSteps = nextSteps;
    this.details = details;
  }

  toJSON(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        nextSteps: this.nextSteps,
      },
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
