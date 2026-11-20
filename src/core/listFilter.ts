// Filtering and paging a list (owner, 2026-11-20: "filter on every column, with a search bar"; 25 per page, can be
// changed; remembered until the page is reloaded). Shared by every list (Roasts first, then the other tabs): a page
// only says what its columns are. Pure: no Google, no screen; knows nothing about Kraken's tabs.

/** How one column can be filtered. */
export type ListColumn<T> =
  | {
      /** A list of the values in this column (e.g. the coffees); a row matches when one of its values is chosen. */
      readonly kind: 'choice';
      readonly key: string;
      readonly label: string;
      readonly values: (row: T) => readonly string[];
    }
  | {
      /** A text box: the row matches when the column contains what is typed (capitals and accents ignored). */
      readonly kind: 'text';
      readonly key: string;
      readonly label: string;
      readonly value: (row: T) => string;
    }
  | {
      /** A list of months (from a YYYY-MM-DD date): "November 2026". */
      readonly kind: 'month';
      readonly key: string;
      readonly label: string;
      readonly value: (row: T) => string;
    }
  | {
      /** "from" and "to" boxes for a number; `parse` reads what is typed (e.g. "1,2" kg → 1200 g). */
      readonly kind: 'range';
      readonly key: string;
      readonly label: string;
      readonly value: (row: T) => number | null;
      readonly parse: (typed: string) => number | null;
    };

/** What is typed or chosen in a column's filter: a choice, text or month (YYYY-MM), or a range. */
export type FilterValue = string | { readonly from: string; readonly to: string };

export interface ListState {
  readonly search: string;
  readonly filters: Readonly<Record<string, FilterValue>>;
  /** 1 = the first page. */
  readonly page: number;
  /** Rows per page; 0 = all on one page. */
  readonly pageSize: number;
}

export const PAGE_SIZES = [25, 50, 100, 0] as const;
export const emptyListState = (): ListState => ({ search: '', filters: {}, page: 1, pageSize: 25 });

/**
 * For comparing: lower case, without accents and extra spaces ("Kenia  Ñ" → "kenia n", "Żółty" → "zolty"). The
 * Polish ł has no accent to take away, so it becomes l by hand.
 */
export const searchable = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** True when a filter is set (an empty text or an empty range is not). */
export function isActive(value: FilterValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return value.from.trim() !== '' || value.to.trim() !== '';
}

/** True when anything narrows the list (the search or a column filter). */
export const anyFilter = (state: ListState) => state.search.trim() !== '' || Object.values(state.filters).some(isActive);

function matches<T>(row: T, column: ListColumn<T>, value: FilterValue | undefined): boolean {
  if (!isActive(value) || value === undefined) return true;
  switch (column.kind) {
    case 'choice':
      return typeof value === 'string' && column.values(row).includes(value);
    case 'text':
      return typeof value === 'string' && searchable(column.value(row)).includes(searchable(value));
    case 'month':
      return typeof value === 'string' && column.value(row).startsWith(`${value}-`);
    case 'range': {
      if (typeof value === 'string') return true;
      const n = column.value(row);
      const from = value.from.trim() === '' ? null : column.parse(value.from);
      const to = value.to.trim() === '' ? null : column.parse(value.to);
      if (from === null && to === null) return true; // nothing readable typed yet
      if (n === null) return false;
      return (from === null || n >= from) && (to === null || n <= to);
    }
  }
}

export interface ListPage<T> {
  /** The rows of the page shown. */
  readonly rows: T[];
  /** Rows matching the search and filters (all pages). */
  readonly matching: number;
  /** All rows before filtering. */
  readonly total: number;
  /** The page shown (corrected when the filters left fewer pages) and how many there are (at least 1). */
  readonly page: number;
  readonly pages: number;
  /** "Showing 26–50 of 89": the first and last row number shown (0 and 0 when nothing matches). */
  readonly first: number;
  readonly last: number;
}

/**
 * The rows matching the search (over `text(row)`, everything shown in the row) and every column filter, then the
 * page asked for. The rows keep their order.
 */
export function listPage<T>(rows: readonly T[], columns: readonly ListColumn<T>[], state: ListState, text: (row: T) => string): ListPage<T> {
  const search = searchable(state.search);
  const matching = rows.filter((row) => (search === '' || searchable(text(row)).includes(search)) && columns.every((c) => matches(row, c, state.filters[c.key])));
  const size = state.pageSize > 0 ? state.pageSize : Math.max(matching.length, 1);
  const pages = Math.max(1, Math.ceil(matching.length / size));
  const page = Math.min(Math.max(1, state.page), pages);
  const start = (page - 1) * size;
  const shown = matching.slice(start, start + size);
  return { rows: shown, matching: matching.length, total: rows.length, page, pages, first: shown.length === 0 ? 0 : start + 1, last: start + shown.length };
}

/** The values to choose from in a 'choice' column, with how many rows have each, in Polish alphabetical order. */
export function choicesOf<T>(rows: readonly T[], values: (row: T) => readonly string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const v of new Set(values(row))) if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'pl'));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The months in a 'month' column (YYYY-MM, newest first) with their names ("November 2026") and counts. */
export function monthsOf<T>(rows: readonly T[], value: (row: T) => string): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const month = /^\d{4}-\d{2}/.exec(value(row))?.[0];
    if (month) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, count]) => ({ value: month, label: `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`, count }));
}
