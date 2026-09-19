export class EpubReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubReadError";
  }
}
