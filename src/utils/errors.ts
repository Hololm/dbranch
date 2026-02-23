export class DbranchError extends Error {
  public readonly userMessage: string;

  constructor(userMessage: string, options?: { cause?: Error }) {
    super(userMessage, options);
    this.name = "DbranchError";
    this.userMessage = userMessage;
  }
}
