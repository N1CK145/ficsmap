import type { ApiErrorCode } from '../shared/api.js';

export class HttpError extends Error {
  constructor(public status: number, public code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}
