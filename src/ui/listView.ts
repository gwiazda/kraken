// A list with a search bar, a filter under every column heading and pages (owner, 2026-11-20), shared by every tab.
// A page gives its rows, its columns (how each can be filtered) and how to draw a row. While typing, only the rows,
// the count and the pages are redrawn, so the cursor stays where it is. What was typed or chosen is remembered per
// list until the page is reloaded (owner: "yes, until reload").

import { PAGE_SIZES, anyFilter, choicesOf, emptyListState, listPage, monthsOf, searchable, type FilterValue, type ListColumn, type ListState } from '../core/listFilter';
import { button, cardTable, el } from './dom';

/** Each list's search, filters and page, kept while Kraken is open (not stored anywhere). */
const remembered = new Map<string, ListState>();

/** Forgets every list's search and filters (another sheet was opened, or the user signed out). */
export const forgetLists = () => remembered.clear();

/** One column of the table: its heading and how it is filtered (null for none, e.g. the column with the buttons). */
export interface ListViewColumn<T> {
  readonly header: string | Node;
  readonly filter: ListColumn<T> | null;
}

export interface ListViewOptions<T> {
  /** Which list, e.g. "roasts": its filters are remembered under this name. */
  readonly key: string;
  readonly rows: readonly T[];
  /** The table's columns, in order (heading and filter together, so they can never be out of step). */
  readonly columns: readonly ListViewColumn<T>[];
  /** Everything shown in a row, for the search bar. */
  readonly text: (row: T) => string;
  /** The table row(s) of one entry (e.g. the row and its hidden "Delete …?" line). */
  readonly rowNodes: (row: T) => HTMLTableRowElement[];
  readonly tableClass?: string;
  /** What the rows are, for screen readers ("wypały"), and what shows when there are none ("Nie ma jeszcze wypałów."). */
  readonly names: { readonly rows: string; readonly none: string };
}

export function listView<T>(options: ListViewOptions<T>): HTMLElement {
  let state: ListState = remembered.get(options.key) ?? emptyListState();
  const filterable = options.columns.flatMap((c) => (c.filter ? [c.filter] : []));
  // Each row's text for the search, made comparable once (not again on every key press).
  const searchTexts = new Map(options.rows.map((row) => [row, searchable(options.text(row))]));
  const searchText = (row: T) => searchTexts.get(row) ?? '';
  const set = (next: Partial<ListState>) => {
    state = { ...state, ...next };
    remembered.set(options.key, state);
    update();
  };
  const setFilter = (key: string, value: FilterValue) => set({ filters: { ...state.filters, [key]: value }, page: 1 });

  // The search bar and the count.
  const search = el('input', { type: 'search', class: 'list-search', placeholder: 'Szukaj…', 'aria-label': `Szukaj: ${options.names.rows}`, autocomplete: 'off' });
  search.value = state.search;
  search.addEventListener('input', () => set({ search: search.value, page: 1 }));
  const count = el('span', { class: 'list-count muted small', role: 'status' });
  const clear = button('Wyczyść filtry', () => {
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
    const label = `Filtr: ${column.label}`;
    if (column.kind === 'choice' || column.kind === 'month') {
      const options_ = column.kind === 'choice' ? choicesOf(options.rows, column.values).map((c) => ({ value: c.value, label: c.value, count: c.count })) : monthsOf(options.rows, column.value);
      const select = el('select', { class: 'list-filter', 'aria-label': label }, el('option', { value: '' }, 'Wszystkie'), ...options_.map((o) => el('option', { value: o.value }, `${o.label} (${o.count})`)));
      // A remembered choice that is not in the list any more (e.g. its last row was deleted) still shows.
      if (typeof current === 'string' && current !== '' && !options_.some((o) => o.value === current)) select.append(el('option', { value: current }, `${current} (0)`));
      select.value = typeof current === 'string' ? current : '';
      select.addEventListener('change', () => setFilter(column.key, select.value));
      resets.push(() => (select.value = ''));
      return select;
    }
    if (column.kind === 'text') {
      const input = el('input', { type: 'text', class: 'list-filter', placeholder: 'zawiera…', 'aria-label': label, autocomplete: 'off' });
      input.value = typeof current === 'string' ? current : '';
      input.addEventListener('input', () => setFilter(column.key, input.value));
      resets.push(() => (input.value = ''));
      return input;
    }
    const range = typeof current === 'object' ? current : { from: '', to: '' };
    const from = el('input', { type: 'text', inputmode: 'decimal', class: 'list-filter list-range', placeholder: 'od', 'aria-label': `${label}: od`, autocomplete: 'off' });
    const to = el('input', { type: 'text', inputmode: 'decimal', class: 'list-filter list-range', placeholder: 'do', 'aria-label': `${label}: do`, autocomplete: 'off' });
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
      el('tr', {}, ...options.columns.map((c) => el('th', { scope: 'col' }, c.header))),
      ...(filterable.length > 0 ? [el('tr', { class: 'list-filters' }, ...options.columns.map((c) => el('td', {}, control(c.filter))))] : []),
    ),
    body,
  );

  // The pages: built once; an update changes only the text and which buttons work (so the focus stays on them).
  const sizes = el('select', { 'aria-label': 'Ile na stronie' }, ...PAGE_SIZES.map((n) => el('option', { value: String(n) }, n === 0 ? 'Wszystkie' : String(n))));
  sizes.value = String(state.pageSize);
  sizes.addEventListener('change', () => set({ pageSize: Number(sizes.value), page: 1 }));
  const previous = button('← Poprzednia', () => set({ page: state.page - 1 }), 'link');
  const next = button('Następna →', () => set({ page: state.page + 1 }), 'link');
  const where = el('span', {});
  const pager = el('div', { class: 'list-pager small' }, previous, where, next, el('label', { class: 'list-size' }, 'Na stronie ', sizes));

  function update(): void {
    const page = listPage(options.rows, filterable, state, searchText);
    if (page.page !== state.page) {
      state = { ...state, page: page.page }; // fewer pages left after filtering
      remembered.set(options.key, state);
    }
    const narrowed = anyFilter(state);
    body.replaceChildren(
      ...(page.rows.length > 0
        ? page.rows.flatMap(options.rowNodes)
        : [el('tr', {}, el('td', { colspan: String(options.columns.length), class: 'muted' }, narrowed ? 'Nic nie pasuje do wyszukiwania i filtrów.' : options.names.none))]),
    );
    count.textContent =
      page.matching === 0
        ? narrowed
          ? `Nic nie pasuje (wszystkich: ${page.total}).`
          : ''
        : `Pokazano ${page.first}–${page.last} z ${page.matching}${narrowed ? ` (po filtrach; wszystkich: ${page.total})` : ''}.`;
    clear.hidden = !narrowed;
    cardTable(table);
    const focused = document.activeElement;
    previous.disabled = page.page <= 1;
    next.disabled = page.page >= page.pages;
    // On the first or last page that button stops working: the focus moves to the other one, not off the list.
    if (focused === next && next.disabled && !previous.disabled) previous.focus();
    if (focused === previous && previous.disabled && !next.disabled) next.focus();
    where.textContent = `Strona ${page.page} z ${page.pages}`;
  }

  // On a phone the filters under the headings are folded away behind this button (on a computer it is hidden).
  const filtersButton = button('Filtry', () => filtersButton.setAttribute('aria-expanded', String(table.classList.toggle('show-filters'))), 'secondary');
  filtersButton.classList.add('filters-toggle');
  filtersButton.setAttribute('aria-expanded', 'false');

  update();
  return el(
    'div',
    { class: 'list-view' },
    el('div', { class: 'list-tools' }, search, ...(filterable.length > 0 ? [filtersButton] : []), count, clear),
    el('div', { class: 'table-wrap' }, table),
    pager,
  );
}
