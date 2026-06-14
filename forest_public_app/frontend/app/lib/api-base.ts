const LOCAL_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_PRODUCTION_API_BASE_URL = "https://forest-calculation-api.onrender.com";

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function resolveApiBaseUrl() {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return normalizeBaseUrl(configuredBaseUrl);
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return LOCAL_API_BASE_URL;
    }
  }

  return DEFAULT_PRODUCTION_API_BASE_URL;
}

export const API_BASE_URL = resolveApiBaseUrl();

export function describeApiError(error: unknown) {
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "Could not reach the backend service. If this is a Vercel preview URL, Render may be blocking it via CORS. Open the main Vercel site or add this preview domain to CORS_ORIGINS.";
  }
  return error instanceof Error ? error.message : "Could not reach the backend service.";
}
