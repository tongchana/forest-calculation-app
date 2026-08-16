export function resolveApiBaseUrl() {
  return "";
}

export const API_BASE_URL = resolveApiBaseUrl();

export function describeApiError(error: unknown) {
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "Could not reach the backend service. Check that the frontend rewrite target and Render backend are both online.";
  }
  return error instanceof Error ? error.message : "Could not reach the backend service.";
}
