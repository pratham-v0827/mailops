import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Wraps a route handler: maps HttpError/ZodError to JSON responses and hides internal errors. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return NextResponse.json(await fn(...args));
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      }
      if (e instanceof ZodError) {
        return NextResponse.json({ error: 'Invalid request', details: e.issues }, { status: 400 });
      }
      console.error(e);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}
