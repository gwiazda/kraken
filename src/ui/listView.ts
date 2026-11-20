// A list with a search bar, a filter under every column heading and pages (owner, 2026-11-20), shared by every tab.
// A page gives its rows, its columns (how each can be filtered) and how to draw a row. While typing, only the rows,
// the count and the pages are redrawn, so the cursor stays where it is. What was typed or chosen is remembered per
// list until the page is reloaded (owner: "yes, until reload").

import { PAGE_SIZES, anyFilter, choicesOf, emptyListState, listPage, monthsOf, type FilterValue, type ListColumn, type ListState } from '../core/listFilter';
import { button, el } from './dom';

/** Each list's search, filters and page, kept while Kraken is open (not stored anywhere). */
const remembered = new Map<string, ListState>();

export interface ListViewOptions<T> {
  /** Which list, e.g. "roasts": its filters are remembered under this name. */
  readonly key: string;
  readonly rows: readonly T[];
  /** One per table column, in order: how it is filtered, or null for none (e.g. the column with the buttons). */
  readonly columns: readonly (ListColumn<T> | null)[];
  readonly headers: readonly (string | Node)[];
  /** Everything shown in a row, for the search bar. */
  readonly text: (row: T) => string;
  /** The table row(s) of one entry (e.g. the row and its hidden "Delete …?" line). */
  readonly rowNodes: (row: T) => HTMLTableRowElement[];
  readonly tableClass?: string;
  /** What a row is called in the count: ["roast", "roasts"]. */
  readonly noun: readonly [string, string];
}

export function listView<T>(options: ListViewOptions<T>): HTMLElement {
  let state: ListState = remembered.get(options.key) ?? emptyListState();
  const filterable = options.columns.filter((c): c is ListColumn<T> => c !== null);
  const set = (next: Partial<ListState>) => {
    state = { ...state, ...next };
    remembered.set(options.key, state);
    update();
  };
  const setFilter = (key: string, value: FilterValue) => set({ filters: { ...state.filters, [key]: value }, page: 1 });

  // The search bar and the count.
  const search = el('input', { type: 'search', class: 'list-search', placeholder: 'Search…', 'aria-label': `Search the ${options.noun[1]}`, autocomplete: 'off' });
  search.value = state.search;
  search.addEventListener('input', () => set({ search: search.value, page: 1 }));
  const count = el('span', { class: 'list-count muted small', role: 'status' });
  const clear = button('Clear filters', () => {
    state = { ...state, search: '', filters: {}, page: 1 };
    remembered.set(options.key, state);
    search.value = '';
    for (const reset of resets) reset();
    update();
  }, 'link');

  // A filter under each heading.
  const resets: (() => void)[] = [];
  const control = (column: ListColumn<T> | null): Node => {
    if (column === null) return document.createTextNode('');
    const current = state.filters[column.key];
    const label = `Filter ${column.label}`;
    if (column.kind === 'choice' || column.kind === 'month') {
      const options_ = column.kind === 'choice' ? choicesOf(options.rows, column.values).map((c) => ({ value: c.value, label: c.value, count: c.count })) : monthsOf(options.rows, column.value);
      const select = el('select', { class: 'list-filter', 'aria-label': label }, el('option', { value: '' }, 'All'), ...options_.map((o) => el('option', { value: o.value }, `${o.label} (${o.count})`)));
      // A remembered choice that is not in the list any more (e.g. its last row was deleted) still shows.
      if (typeof current === 'string' && current !== '' && !options_.some((o) => o.value === current)) select.append(el('option', { value: current }, `${current} (0)`));
      select.value = typeof current === 'string' ? current : '';
      select.addEventListener('change', () => setFilter(column.key, select.value));
      resets.push(() => (select.value = ''));
      return select;
    }
    if (column.kind === 'text') {
      const input = el('input', { type: 'text', class: 'list-filter', placeholder: 'contains…', 'aria-label': label, autocomplete: 'off' });
      input.value = typeof current === 'string' ? current : '';
      input.addEventListener('input', () => setFilter(column.key, input.value));
      resets.push(() => (input.value = ''));
      return input;
    }
    const range = typeof current === 'object' ? current : { from: '', to: '' };
    const from = el('input', { type: 'text', inputmode: 'decimal', class: 'list-filter list-range', placeholder: 'from', 'aria-label': `${label}: from`, autocomplete: 'off' });
    const to = el('input', { type: 'text', inputmode: 'decimal', class: 'list-filter list-range', placeholder: 'to', 'aria-label': `${label}: to`, autocomplete: 'off' });
    from.value = range.from;
    to.value = range.to;
    const changed = () => setFilter(column.key, { from: from.value, to: to.value });
    from.addEventListener('input', changed);
    to.addEventListener('input', changed);
    resets.push(() => {
      from.value = '';
      to.value = '';
    });
    return el('span', { class: 'list-range-pair' }, from, to);
  };

  const body = el('tbody', {});
  const table = el(
    'table',
    { class: `data-table ${options.tableClass ?? ''}`.trim() },
    el(
      'thead',
      {},
      el('tr', {}, ...options.headers.map((h) => el('th', { scope: 'col' }, h))),
      ...(filterable.length > 0 ? [el('tr', { class: 'list-filters' }, ...options.columns.map((c) => el('td', {}, control(c))))] : []),
    ),
    body,
  );

  // The pages.
  const pager = el('div', { class: 'list-pager small' });
  const sizes = el('select', { 'aria-label': `${options.noun[1]} per page` }, ...PAGE_SIZES.map((n) => el('option', { value: String(n) }, n === 0 ? 'All' : String(n))));
  sizes.value = String(state.pageSize);
  sizes.addEventListener('change', () => set({ pageSize: Number(sizes.value), page: 1 }));
  const previous = button('← Previous', () => set({ page: state.page - 1 }), 'link');
  const next = button('Next →', () => set({ page: state.page + 1 }), 'link');
  const where = el('span', {});

  function update(): void {
    const page = listPage(options.rows, filterable, state, options.text);
    if (page.page !== state.page) state = { ...state, page: page.page };
    const narrowed = anyFilter(state);
    body.replaceChildren(
      ...(page.rows.length > 0
        ? page.rows.flatMap(options.rowNodes)
        : [el('tr', {}, el('td', { colspan: String(options.headers.length), class: 'muted' }, narrowed ? `No ${options.noun[1]} match the search and filters.` : `No ${options.noun[1]}.`))]),
    );
    const noun = (n: number) => (n === 1 ? options.noun[0] : options.noun[1]);
    count.textContent =
      page.matching === 0
        ? narrowed
          ? `None of the ${page.total} ${noun(page.total)} match.`
          : ''
        : `Showing ${page.first}–${page.last} of ${page.matching} ${noun(page.matching)}${narrowed ? ` (filtered from ${page.total})` : ''}.`;
    clear.hidden = !narrowed;
    previous.disabled = page.page <= 1;
    next.disabled = page.page >= page.pages;
    where.textContent = `Page ${page.page} of ${page.pages}`;
    pager.replaceChildren(previous, where, next, el('label', { class: 'list-size' }, 'Per page ', sizes));
  }

  update();
  return el('div', { class: 'list-view' }, el('div', { class: 'list-tools' }, search, count, clear), el('div', { class: 'table-wrap' }, table), pager);
}
