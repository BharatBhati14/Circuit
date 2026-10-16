export class InvalidWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkflowError";
  }
}
