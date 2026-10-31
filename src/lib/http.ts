export const err = (status: number, code: string, message: string, retryable = false, details: unknown = {}) =>
  Response.json({ error: { code, message, retryable, details } }, { status });

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
