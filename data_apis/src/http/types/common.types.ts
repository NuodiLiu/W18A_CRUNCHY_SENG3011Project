/** Standard error response body returned by the error handler middleware. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
