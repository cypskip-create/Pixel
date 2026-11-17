/** Parse and constrain links before handing them to the operating system. */
export function safeExternalHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname || url.username.length > 0 || url.password.length > 0) return null;
    if (/[\u0000-\u001f\u007f]/.test(value)) return null;
    return url.href;
  } catch {
    return null;
  }
}
