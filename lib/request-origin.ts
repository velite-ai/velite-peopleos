type WriteOriginInput = {
  origin: string | null;
  requestOrigin: string;
  appUrl?: string;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
};

function normalizedOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function firstForwardedValue(value: string | null | undefined) {
  return value?.split(",")[0]?.trim() || null;
}

export function isAllowedWriteOrigin({
  origin,
  requestOrigin,
  appUrl,
  forwardedHost,
  forwardedProto,
}: WriteOriginInput) {
  if (!origin) return true;

  const browserOrigin = normalizedOrigin(origin);
  if (!browserOrigin) return false;

  const allowedOrigins = new Set<string>();
  const internalOrigin = normalizedOrigin(requestOrigin);
  const configuredOrigin = normalizedOrigin(appUrl);
  if (internalOrigin) allowedOrigins.add(internalOrigin);
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);

  const host = firstForwardedValue(forwardedHost);
  const protocol = firstForwardedValue(forwardedProto);
  if (host && (protocol === "http" || protocol === "https")) {
    const proxyOrigin = normalizedOrigin(`${protocol}://${host}`);
    if (proxyOrigin) allowedOrigins.add(proxyOrigin);
  }

  return allowedOrigins.has(browserOrigin);
}
