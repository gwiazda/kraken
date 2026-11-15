// The "Import from RoasTime" screen: choose the roast-time folder, see a preview, import what is ticked.
// Chrome cannot remember a folder inside ~/Library (it calls it "system files"), so the folder is chosen each time
// with the classic folder chooser; the help box keeps the path one click away (owner's request, 2026-11-15).

import { busy, button, el, message } from '../../ui/dom';
import type { LotsRepository } from '../lots';
import { ROASTIME_FOLDER, kindOf, looksLikeRoastimeFolder, parseRoastimeFiles, type FolderFile } from './model';
import { defaultDecision, operations, planImport, type Decision, type DiffColumn, type ImportItem, type ImportPlan, type Operation } from './plan';

export interface RoastimeImportDeps {
  repo: LotsRepository;
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  /** Opens Google's sign-in window. Call it inside a click. */
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  copyText: (text: string) => Promise<void>;
  now: () => Date;
  /** Back to the Lots list, with an optional note ("Imported …"). */
  backToLots: (note?: string) => void;
}

export function showRoastimeImport(root: HTMLElement, deps: RoastimeImportDeps): void {
  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);
  const back = (note?: string) => button('Back to lots', () => deps.backToLots(note), 'secondary');

  function helpBox(): HTMLElement {
    const copied = el('span', { class: 'muted small', role: 'status' });
    const copy = button(
      'Copy path',
      () => {
        deps.copyText(ROASTIME_FOLDER).then(
          () => (copied.textContent = ' Copied.'),
          () => (copied.textContent = ' Copying is blocked here: select the path and press Cmd+C.'),
        );
      },
      'secondary',
    );
    return el(
      'div',
      { class: 'help-box' },
      el('p', {}, 'How to choose the RoasTime folder:'),
      el(
        'ol',
        {},
        el('li', {}, 'Click "Choose RoasTime folder" below.'),
        el('li', {}, 'In the window, press ', el('kbd', {}, 'Cmd'), ' + ', el('kbd', {}, 'Shift'), ' + ', el('kbd', {}, 'G'), ', paste the path and press Enter:'),
        el('li', { class: 'path-line' }, el('code', {}, ROASTIME_FOLDER), ' ', copy, copied),
        el('li', {}, 'Click "Upload". Chrome then asks "Upload … files to this site?": click "Upload". The files stay on this computer; Kraken only reads them.'),
      ),
      el('p', { class: 'muted small' }, 'Next time the window usually opens in the right place already.'),
    );
  }

  function start(note?: Node): void {
    const input = el('input', { type: 'file', id: 'roastime-folder', class: 'visually-hidden' });
    input.webkitdirectory = true;
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) void read(files);
    });
    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Import from RoasTime'), back()),
      el('p', {}, 'Kraken reads the green coffee deliveries from RoasTime and shows what would change. Nothing is saved until you click "Import selected".'),
      ...(note ? [note] : []),
      helpBox(),
      el('div', { class: 'actions' }, button('Choose RoasTime folder', () => input.click()), input),
    );
  }

  async function read(files: File[]): Promise<void> {
    render(el('p', {}, busy('Reading the RoasTime folder…')));
    const paths = files.map((f) => f.webkitRelativePath);
    if (!looksLikeRoastimeFolder(paths)) {
      start(message('That folder does not look like RoasTime\'s "roast-time" folder (it has no "containers" and "beans" folders). Please choose it again.', 'error'));
      return;
    }
    try {
      // Only the deliveries and coffees are read; the roasts are left alone.
      const wanted = files.filter((f) => kindOf(f.webkitRelativePath) !== null);
      const folderFiles: FolderFile[] = await Promise.all(wanted.map(async (f) => ({ path: f.webkitRelativePath, text: await f.text() })));
      const data = parseRoastimeFiles(folderFiles);
      render(el('p', {}, busy('Comparing with the lots in Kraken…')));
      const { lots } = await deps.repo.load();
      preview(planImport(data, lots, deps.now()));
    } catch (error) {
      if (deps.isIgnorable(error)) return;
      start(el('div', {}, ...errorNodes(error, () => start())));
    }
  }

  function errorNodes(error: unknown, retry: () => void): Node[] {
    if (deps.isSignedOut(error)) {
      return [
        message('Your Google sign-in ran out. Sign in, then choose the folder again.', 'error'),
        button('Sign in', () => {
          deps.signIn().then(retry, (e: unknown) => {
            if (!deps.isIgnorable(e)) start(el('div', {}, ...errorNodes(e, retry)));
          });
        }),
      ];
    }
    return [message(deps.describeError(error), 'error')];
  }

  function preview(plan: ImportPlan): void {
    const decisions = new Map<string, Decision>();
    for (const item of plan.items) {
      const decision = defaultDecision(item);
      if (decision) decisions.set(item.container.id, decision);
    }
    const byKind = <K extends ImportItem['kind']>(kind: K) => plan.items.filter((i): i is Extract<ImportItem, { kind: K }> => i.kind === kind);
    const fresh = byKind('new');
    const changed = byKind('changed');
    const same = byKind('same');
    const goneInRoastime = byKind('deleted-in-roastime');
    const goneInKraken = byKind('deleted-in-kraken');

    const importButton = button('Import selected', () => apply());
    const summary = el('span', { class: 'muted small' });
    const refresh = () => {
      const count = operations(plan, decisions).length;
      importButton.disabled = count === 0;
      summary.textContent = count === 0 ? ' Nothing selected.' : ` ${count} change${count === 1 ? '' : 's'} to save.`;
    };

    /** Tick boxes for differences; `accept` is the list they update. */
    const diffBoxes = (id: string, diffs: readonly { column: DiffColumn; label: string; kraken: string; roastime: string }[], getAccept: () => DiffColumn[], setAccept: (a: DiffColumn[]) => void) =>
      el(
        'ul',
        { class: 'diff-list' },
        ...diffs.map((d) => {
          const box = el('input', { type: 'checkbox', id: `${id}-${d.column}` });
          box.checked = getAccept().includes(d.column);
          box.addEventListener('change', () => {
            setAccept(box.checked ? [...getAccept(), d.column] : getAccept().filter((c) => c !== d.column));
            refresh();
          });
          return el(
            'li',
            {},
            box,
            ' ',
            el('label', { for: `${id}-${d.column}` }, `${d.label}: `, el('span', { class: 'old' }, d.kraken), ' → ', el('span', { class: 'new' }, d.roastime)),
          );
        }),
      );

    const newCard = (item: Extract<ImportItem, { kind: 'new' }>) => {
      const id = `rt-${item.container.id}`;
      const choice = (value: 'add' | 'skip', label: string) => {
        const radio = el('input', { type: 'radio', name: id, id: `${id}-${value}`, value });
        radio.checked = decisions.get(item.container.id)?.action === value;
        radio.addEventListener('change', () => {
          decisions.set(item.container.id, { action: value });
          refresh();
        });
        return el('li', {}, radio, ' ', el('label', { for: `${id}-${value}` }, label));
      };
      return el(
        'div',
        { class: 'import-card' },
        el(
          'p',
          {},
          el('strong', {}, item.fields.name || '(no name)'),
          ` · ${item.fields.country || 'no country'} · ${item.fields.quantity_kg} kg · delivered ${item.fields.delivery_date}`,
        ),
        el('ul', { class: 'choice-list' }, choice('add', `Add as a new lot ${item.fields.code}`), choice('skip', 'Skip for now')),
      );
    };

    const changedCard = (item: Extract<ImportItem, { kind: 'changed' }>) =>
      el(
        'div',
        { class: 'import-card' },
        el('p', {}, el('strong', {}, item.lot.code), ` · ${item.lot.name}: RoasTime has different values (untick to keep Kraken's value):`),
        diffBoxes(
          `rt-${item.container.id}`,
          item.differences,
          () => {
            const d = decisions.get(item.container.id);
            return d?.action === 'update' ? [...d.accept] : [];
          },
          (accept) => decisions.set(item.container.id, { action: 'update', accept }),
        ),
      );

    const section = (title: string, nodes: Node[]) => (nodes.length === 0 ? [] : [el('h3', {}, title), ...nodes]);

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Import from RoasTime: preview'), back()),
      el(
        'p',
        { class: 'muted small' },
        'Only lots imported from RoasTime before are compared. Lots entered by hand are never changed. Prices, delivery cost, supplier, notes and codes are never changed by an import.',
      ),
      ...plan.problems.map((text) => message(text, 'error')),
      ...section(`New deliveries (${fresh.length})`, fresh.map(newCard)),
      ...section(`Changed in RoasTime (${changed.length})`, changed.map(changedCard)),
      ...(same.length > 0 ? [el('p', { class: 'muted' }, `${same.length} lot${same.length === 1 ? '' : 's'} already match${same.length === 1 ? 'es' : ''} RoasTime.`)] : []),
      ...section(
        'Only for your information',
        [
          ...goneInRoastime.map((i) => el('p', { class: 'muted small' }, `${i.lot.code}: deleted in RoasTime. Kraken keeps it; delete it in Kraken if you want.`)),
          ...goneInKraken.map((i) => el('p', { class: 'muted small' }, `${i.lot.code}: deleted in Kraken, so the import leaves it alone. Restore it in Kraken to update it.`)),
        ],
      ),
      ...(fresh.length + changed.length === 0 ? [message('Everything in RoasTime is already in Kraken. Nothing to import.')] : []),
      el('div', { class: 'actions' }, importButton, summary, button('Cancel', () => deps.backToLots(), 'secondary')),
    );
    refresh();

    // Called inside the "Import selected" click, so a sign-in renewal can open Google's window.
    function apply(): void {
      const ops = operations(plan, decisions);
      if (ops.length === 0) return;
      let done = 0;
      render(el('p', {}, busy(`Importing… (0 of ${ops.length})`)));
      const step = (text: string) => render(el('p', {}, busy(text)));
      deps
        .withGoogle(async () => {
          const by = ops.some((op) => op.kind === 'add') ? await deps.whoAmI() : '';
          for (const op of ops) {
            step(`Importing… ${op.label} (${done + 1} of ${ops.length})`);
            await run(op, by);
            done++;
          }
        })
        .then(() => {
          if (root.isConnected) deps.backToLots(`Imported from RoasTime: ${summaryOf(ops)}.`);
        })
        .catch((error: unknown) => {
          if (!root.isConnected || deps.isIgnorable(error)) return;
          const partial =
            done === 0
              ? 'Nothing was imported.'
              : `${done} of ${ops.length} changes were saved before this happened. Choose the folder again to import the rest: what is saved is recognised.`;
          start(el('div', {}, message(partial, 'error'), ...errorNodes(error, () => start())));
        });
    }
  }

  async function run(op: Operation, by: string): Promise<void> {
    if (op.kind === 'add') await deps.repo.add(op.fields, by, deps.now());
    else await deps.repo.update(op.lot, op.fields, deps.now());
  }

  start();
}

/** "2 added, 1 updated" */
export function summaryOf(ops: readonly Operation[]): string {
  const count = (prefix: string) => ops.filter((op) => op.label.startsWith(prefix)).length;
  const parts = [
    [count('Add '), 'added'],
    [count('Update '), 'updated'],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');
}
