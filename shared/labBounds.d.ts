type OptionalNumber = number | null | undefined;
export function comparatorOf(text?: string | null): string;
export function definitely(value: OptionalNumber, comparator: string, op: 'gt' | 'gte' | 'lt' | 'lte', limit: OptionalNumber): boolean;
export function rangeFlag(value: OptionalNumber, low: OptionalNumber, high: OptionalNumber, text?: string | null): 'ok' | 'high' | 'low' | '';
