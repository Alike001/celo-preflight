export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
