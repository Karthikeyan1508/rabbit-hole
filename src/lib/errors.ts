import { NextResponse } from 'next/server';

export interface AppErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, any> | unknown;
}

export interface ApiErrorResponse {
  error: AppErrorPayload;
}

export function apiError(
  message: string,
  statusCode = 400,
  code = 'BAD_REQUEST',
  retryable = false,
  details?: Record<string, any>
) {
  return NextResponse.json<ApiErrorResponse>(
    {
      error: {
        code,
        message,
        retryable,
        details,
      },
    },
    { status: statusCode }
  );
}

