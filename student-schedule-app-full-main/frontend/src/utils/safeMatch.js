export function safeMatch(value, regex) {
  if (typeof value !== "string") return null;
  if (!value.trim()) return null;
  return value.match(regex);
}
