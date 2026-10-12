/*
 * The app writes JSON as `${JSON.stringify(value)}::jsonb`. With the postgres driver that text was then
 * JSON-encoded a second time, so the database held a jsonb *string* instead of an object. Salary rules,
 * pay structures and monthly attendance summaries were all stored that way, and reading them back gave
 * text where the code expected an object.
 *
 * serializeJson: text that is already JSON goes to the database as it is; anything else is stringified once.
 * parseJson:     also unwraps values already stored the old way, so existing rows read correctly.
 */
export const serializeJson = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

export function parseJson(text: string): unknown {
  let value: unknown = JSON.parse(text);
  for (let layer = 0; layer < 3 && typeof value === "string"; layer++) {
    const inner = value.trim();
    if (!/^[\[{"]/.test(inner)) break;
    let next: unknown;
    try { next = JSON.parse(inner); } catch { break; }
    if (typeof next === "string" || (typeof next === "object" && next !== null)) value = next; else break;
  }
  return value;
}

export const jsonTypes = { json: { to: 114, from: [114, 3802], serialize: serializeJson, parse: parseJson } };
