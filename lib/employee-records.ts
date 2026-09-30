export function maskPhone(value: string) {
  const visible = value.replace(/\s+/g, "");
  if (visible.length <= 4) return "•".repeat(visible.length);
  return `${"•".repeat(Math.min(8, visible.length - 4))}${visible.slice(-4)}`;
}

export function maskIdentifier(value: string) {
  const compact = value.trim();
  if (compact.length <= 4) return "•".repeat(compact.length);
  return `${"•".repeat(Math.min(12, compact.length - 4))}${compact.slice(-4)}`;
}

export function redactRecordValues<T extends Record<string, unknown>>(record: T) {
  return {
    fields: Object.keys(record).sort(),
    populatedFields: Object.entries(record).filter(([, value]) => value !== null && value !== "").map(([key]) => key).sort(),
  };
}
