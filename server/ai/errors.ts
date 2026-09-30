export class AiError extends Error {
  constructor(
    message: string,
    readonly statusCode = 503,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
