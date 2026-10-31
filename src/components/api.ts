/** Thin client for the app's own /api/v1 endpoints. Throws the server's error message. */
export async function api(path: string, init?: RequestInit) {
  // a FormData body needs the browser to set its own multipart Content-Type, so only default to JSON otherwise
  const headers = init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers };
  const r = await fetch("/api/v1" + path, { ...init, headers });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error?.message ?? r.statusText);
  return body;
}
