export class PlaneProfileValidationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'PlaneProfileValidationError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, PlaneProfileValidationError.prototype);
  }
}

