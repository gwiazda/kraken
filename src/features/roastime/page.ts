// "Sync with RoasTime": choose the roast-time folder once, see one preview of the deliveries (lots) and the roasts,
// and save it all with one click (owner's request, 2026-11-15: one place, one step).
// Chrome cannot remember a folder inside ~/Library (it calls it "system files"), so the folder is chosen each time
// with the classic folder chooser; the help box keeps the path one click away (owner's request, 2026-11-15).

import { formatKg } from '../../core/numbers';
import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import type { LotsRepository } from '../lots';
import { roastTimeText, type Roast, type RoastsRepository } from '../roasts';
import { ImportStopped, applySync, changeCount, summaryOf, type SyncWrites } from './apply';
import { ROASTIME_FOLDER, kindOf, looksLikeRoastimeFolder, parseRoastimeFiles, type FolderFile, type RoastimeData } from './model';
import { defaultDecision, newLotCodes, operations, planImport, type Decision, type DiffColumn, type ImportItem, type ImportPlan } from './plan';
import { coffeesOf, planRoasts, type RoastPlan } from './roastPlan';

export interface RoastimeSyncDeps {
  lots: LotsRepository;
  roasts: RoastsRepository;
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
  /** Back to the page the sync was opened from, with an optional note ("Synced …"). */
  back: (note?: string) => void;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}

export function showRoastimeSync(root: HTMLElement, deps: RoastimeSyncDeps): void {
  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);
  const back = () => button('Back', () => deps.back(), 'secondary');

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
      el('div', { class: 'page-head' }, el('h2', {}, 'Sync with RoasTime'), back()),
      el('p', {}, 'Kraken reads the green coffee deliveries and the roasts from RoasTime and shows what would change. Nothing is saved until you click "Sync".'),
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
      // Only deliveries, coffees and roasts are read (recipes, settings… are left alone).
      const wanted = files.filter((f) => kindOf(f.webkitRelativePath) !== null);
      const folderFiles: FolderFile[] = await Promise.all(wanted.map(async (f) => ({ path: f.webkitRelativePath, text: await f.text() })));
      compare(parseRoastimeFiles(folderFiles));
    } catch (error) {
      start(message(`Kraken could not read the folder: ${deps.describeError(error)}`, 'error'));
    }
  }

  /** Compares with Kraken. Retried with the same files after a sign-in, so the folder is not chosen again. */
  function compare(data: RoastimeData, fromClick = false): void {
    render(el('p', {}, busy('Comparing with Kraken…')));
    const both = () => Promise.all([deps.lots.load(), deps.roasts.load()]);
    (fromClick ? deps.withGoogle(both) : both())
      .then(([{ lots }, { roasts }]) => {
        if (root.isConnected) preview(planImport(data, lots, deps.now()), planRoasts(data.roasts, roasts, coffeesOf(data.containers, lots)));
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) {
          start();
          return;
        }
        const show = (e: unknown) =>
          start(
            el(
              'div',
              {},
              ...googleErrorNodes(e, deps, {
                retry: () => compare(data),
                retryLabel: 'Sign in and continue',
                show,
                other: { label: 'Try again', action: () => compare(data, true), mayHaveSaved: false },
                signedOutNote: 'The folder is already read; nothing to choose again.',
              }),
            ),
          );
        show(error);
      });
  }

  function preview(plan: ImportPlan, roastPlan: RoastPlan): void {
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

    const importButton = button('Sync', () => apply());
    const summary = el('span', { class: 'muted small' });
    let updateRoasts = true;
    let restoreRoasts = true;
    const writes = (): SyncWrites => ({
      lotOps: operations(plan, decisions),
      roastAdds: roastPlan.added.map((r) => r.fields),
      roastUpdates: updateRoasts ? roastPlan.changed.map((c) => ({ roast: c.roast, fields: c.fields })) : [],
      roastRemovals: roastPlan.removed,
      roastRestores: restoreRoasts ? roastPlan.restored.map((r) => ({ roast: r.roast, fields: r.fields })) : [],
    });
    /** The code shown next to "Add as a new lot", updated when deliveries are skipped (codes have no gaps). */
    const codeLabels = new Map<string, HTMLElement>();
    const refresh = () => {
      const codes = newLotCodes(plan, decisions);
      for (const [id, label] of codeLabels) label.textContent = codes.get(id) ?? '';
      const count = changeCount(writes());
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
      const codeLabel = el('strong', { class: 'new-code' });
      codeLabels.set(item.container.id, codeLabel);
      const choice = (value: 'add' | 'skip', label: string, extra?: Node) => {
        const radio = el('input', { type: 'radio', name: id, id: `${id}-${value}`, value });
        radio.checked = decisions.get(item.container.id)?.action === value;
        radio.addEventListener('change', () => {
          decisions.set(item.container.id, { action: value });
          refresh();
        });
        return el('li', {}, radio, ' ', el('label', { for: `${id}-${value}` }, label, ...(extra ? [' ', extra] : [])));
      };
      return el(
        'div',
        { class: 'import-card' },
        el(
          'p',
          {},
          el('strong', {}, item.fields.name || '(no name)'),
          ` · ${item.fields.country || 'no country'} · ${formatKg(item.container.startGrams)} · delivered ${item.fields.delivery_date}`,
        ),
        el('ul', { class: 'choice-list' }, choice('add', 'Add as a new lot', codeLabel), choice('skip', 'Skip for now')),
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
    const details = (title: string, lines: readonly string[]) =>
      el('details', { class: 'small' }, el('summary', {}, title), el('ul', {}, ...lines.map((line) => el('li', {}, line))));

    const roastEdits = roastPlan.added.length + roastPlan.changed.length + roastPlan.removed.length + roastPlan.restored.length;
    const roastLabel = (r: Roast) => `${r.name || 'Roast'} (${roastTimeText(r.roastedAt) || 'no date'})`;
    const listed = (roasts: readonly Roast[]) => roasts.map(roastLabel);
    const roastNodes = (): Node[] => {
      const nodes: Node[] = [];
      const added = roastPlan.added.length;
      if (added > 0) nodes.push(el('p', {}, `${added} new roast${added === 1 ? '' : 's'} will be added.`));
      const tickBox = (id: string, checked: boolean, onChange: (checked: boolean) => void, label: string) => {
        const box = el('input', { type: 'checkbox', id });
        box.checked = checked;
        box.addEventListener('change', () => {
          onChange(box.checked);
          refresh();
        });
        return el('p', {}, box, ' ', el('label', { for: id }, label));
      };
      const withChanges = (list: readonly { roast: Roast; changes: readonly string[] }[]) =>
        list.map((c) => `${roastLabel(c.roast)}: ${c.changes.join('; ')}`);
      if (roastPlan.restored.length > 0) {
        const n = roastPlan.restored.length;
        nodes.push(
          tickBox(
            'restore-roasts',
            restoreRoasts,
            (checked) => (restoreRoasts = checked),
            `Bring back ${n} deleted sample${n === 1 ? '' : 's'} that ${n === 1 ? 'is a real roast' : 'are real roasts'} now (a coffee chosen, or its first delivery entered, in RoasTime). Untick if you deleted ${n === 1 ? 'it' : 'them'} on purpose.`,
          ),
          details('Show them', withChanges(roastPlan.restored)),
        );
      }
      if (roastPlan.removed.length > 0) {
        const n = roastPlan.removed.length;
        nodes.push(
          details(
            `${n} sample${n === 1 ? '' : 's'} (no coffee, or a coffee with no delivery, in RoasTime) will be removed. You can still see ${n === 1 ? 'it' : 'them'} with "Show deleted".`,
            listed(roastPlan.removed),
          ),
        );
      }
      if (roastPlan.changed.length > 0) {
        const n = roastPlan.changed.length;
        nodes.push(
          tickBox('update-roasts', updateRoasts, (checked) => (updateRoasts = checked), `Update ${n} roast${n === 1 ? '' : 's'} changed in RoasTime`),
          details('Show the changes', withChanges(roastPlan.changed)),
        );
      }
      if (roastPlan.keptSamples.length > 0) {
        const n = roastPlan.keptSamples.length;
        nodes.push(
          details(
            `${n} sample${n === 1 ? '' : 's'} kept, because you gave ${n === 1 ? 'it' : 'them'} a lot, a sample mark or notes in Kraken (delete ${n === 1 ? 'it' : 'them'} on the Roasts page if not needed)`,
            listed(roastPlan.keptSamples),
          ),
        );
      }
      if (roastPlan.unchanged > 0) nodes.push(el('p', { class: 'muted' }, `${roastPlan.unchanged} roast${roastPlan.unchanged === 1 ? '' : 's'} already match RoasTime.`));
      if (roastPlan.samples.length > 0) {
        nodes.push(details(`${roastPlan.samples.length} sample${roastPlan.samples.length === 1 ? '' : 's'} in RoasTime (not tracked)`, roastPlan.samples));
      }
      if (roastPlan.skipped.length > 0) nodes.push(details(`${roastPlan.skipped.length} skipped (not imported)`, roastPlan.skipped));
      if (roastPlan.goneFromRoastime.length > 0) {
        nodes.push(
          details(
            `${roastPlan.goneFromRoastime.length} no longer in RoasTime (kept in Kraken; delete them on the Roasts page if you want)`,
            listed(roastPlan.goneFromRoastime),
          ),
        );
      }
      return nodes;
    };

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Sync with RoasTime: preview'), back()),
      el(
        'p',
        { class: 'muted small' },
        'Only lots and roasts that came from RoasTime are compared; anything entered by hand is never changed. Roasts with no coffee chosen in RoasTime, or whose coffee has no delivery there, are samples and are not tracked. Prices, supplier, codes, chosen lots, sample marks and notes are never changed by a sync.',
      ),
      ...[...plan.problems, ...roastPlan.problems].map((text) => message(text, 'error')),
      el('h2', { class: 'sub' }, 'Deliveries (lots)'),
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
      ...(fresh.length + changed.length === 0 ? [el('p', { class: 'muted' }, 'No new or changed deliveries.')] : []),
      el('h2', { class: 'sub' }, 'Roasts'),
      ...(roastEdits === 0 ? [el('p', { class: 'muted' }, 'No new or changed roasts.')] : []),
      ...roastNodes(),
      ...(fresh.length + changed.length + roastEdits === 0
        ? [message('Everything in RoasTime is already in Kraken. Nothing to sync.')]
        : []),
      el('div', { class: 'actions' }, importButton, summary, button('Cancel', () => deps.back(), 'secondary')),
    );
    refresh();

    // Called inside the "Import selected" click, so a sign-in renewal can open Google's window.
    function apply(): void {
      const toSave = writes();
      if (changeCount(toSave) === 0) return;
      const step = (text: string) => render(el('p', {}, busy(text)));
      step('Syncing…');
      deps.busy(true);
      deps
        .withGoogle(() => applySync(toSave, { lots: deps.lots, roasts: deps.roasts, whoAmI: deps.whoAmI, now: deps.now, onProgress: step }))
        .finally(() => deps.busy(false))
        .then((result) => {
          if (root.isConnected) deps.back(`Synced with RoasTime: ${summaryOf(result)}.`);
        })
        .catch((error: unknown) => {
          if (!root.isConnected) return;
          const cause = error instanceof ImportStopped ? error.cause : error;
          if (deps.isIgnorable(cause)) {
            start(message('The sync was interrupted by another sign-in. Choose the folder again to continue: what is saved is recognised.'));
            return;
          }
          const saved = error instanceof ImportStopped ? error.saved : 0;
          const total = error instanceof ImportStopped ? error.total : changeCount(toSave);
          const progress =
            saved > 0
              ? `${saved} of ${total} changes were saved before this happened.`
              : 'Kraken cannot tell whether anything was saved.';
          const show = (e: unknown) =>
            start(
              el(
                'div',
                {},
                message(`${progress} Choose the folder again to finish: what is saved is recognised and not added twice.`, 'error'),
                ...googleErrorNodes(e, deps, {
                  retry: () => start(),
                  retryLabel: 'Sign in',
                  show,
                  other: { label: 'Back', action: () => deps.back(), mayHaveSaved: true },
                  signedOutNote: 'Sign in, then choose the folder again.',
                }),
              ),
            );
          show(cause);
        });
    }
  }

  start();
}
