export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields?: unknown) {
    super(message);
  }
}
