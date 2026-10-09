export interface ErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export function errorResponse(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}
