/** Accept a whole decimal entry, including a localized decimal separator. Blank fields are optional. */
export function parseDecimal(input: string, errorMessage: string): number | null {
  const text = input.trim().replace(',', '.');
  if (!text) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(errorMessage);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(errorMessage);
  return value;
}
