const APP_ORIGIN = "https://watchparty.invalid";

export function safeRedirectPath(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }

  try {
    const destination = new URL(value, APP_ORIGIN);
    if (destination.origin !== APP_ORIGIN) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
