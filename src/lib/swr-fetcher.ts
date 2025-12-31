export const jsonFetcher = async (url: string) => {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');

  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string')
        ? (body as { error: string }).error
        : `Request failed: ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return body;
};


