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
import { formatDate } from '../../core/dates';
import { plural } from '../../core/polish';

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
  const back = () => button('Wróć', () => deps.back(), 'secondary');

  function helpBox(): HTMLElement {
    const copied = el('span', { class: 'muted small', role: 'status' });
    const copy = button(
      'Kopiuj ścieżkę',
      () => {
        deps.copyText(ROASTIME_FOLDER).then(
          () => (copied.textContent = ' Skopiowano.'),
          () => (copied.textContent = ' Kopiowanie jest tu zablokowane: zaznacz ścieżkę i naciśnij Cmd+C.'),
        );
      },
      'secondary',
    );
    return el(
      'div',
      { class: 'help-box' },
      el('p', {}, 'Jak wybrać folder RoasTime:'),
      el(
        'ol',
        {},
        el('li', {}, 'Kliknij poniżej „Wybierz folder RoasTime”.'),
        el(
          'li',
          {},
          'W oknie naciśnij ', el('kbd', {}, 'Cmd'), ' + ', el('kbd', {}, 'Shift'), ' + ', el('kbd', {}, 'G'), ', wklej ścieżkę i naciśnij Enter:',
          el('div', { class: 'path-line' }, el('code', {}, ROASTIME_FOLDER), ' ', copy, copied),
        ),
        el('li', {}, 'Kliknij „Prześlij” (Upload). Chrome zapyta, czy przesłać pliki do tej witryny: kliknij „Prześlij”. Pliki zostają na tym komputerze; Kraken tylko je czyta.'),
      ),
      el('p', { class: 'muted small' }, 'Następnym razem okno zwykle otworzy się już we właściwym miejscu.'),
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
      el('div', { class: 'page-head' }, el('h2', {}, 'Synchronizacja z RoasTime'), back()),
      el('p', {}, 'Kraken czyta dostawy zielonej kawy i wypały z RoasTime i pokazuje, co by się zmieniło. Nic nie jest zapisywane, dopóki nie klikniesz „Synchronizuj”.'),
      ...(note ? [note] : []),
      helpBox(),
      el('div', { class: 'actions' }, button('Wybierz folder RoasTime', () => input.click()), input),
    );
  }

  async function read(files: File[]): Promise<void> {
    render(el('p', {}, busy('Czytam folder RoasTime…')));
    const paths = files.map((f) => f.webkitRelativePath);
    if (!looksLikeRoastimeFolder(paths)) {
      start(message('Ten folder nie wygląda na folder „roast-time” z RoasTime (nie ma w nim folderów „containers” i „beans”). Wybierz go jeszcze raz.', 'error'));
      return;
    }
    try {
      // Only deliveries, coffees and roasts are read (recipes, settings… are left alone).
      const wanted = files.filter((f) => kindOf(f.webkitRelativePath) !== null);
      const folderFiles: FolderFile[] = await Promise.all(wanted.map(async (f) => ({ path: f.webkitRelativePath, text: await f.text() })));
      compare(parseRoastimeFiles(folderFiles));
    } catch (error) {
      start(message(`Kraken nie mógł odczytać folderu: ${deps.describeError(error)}`, 'error'));
    }
  }

  /** Compares with Kraken. Retried with the same files after a sign-in, so the folder is not chosen again. */
  function compare(data: RoastimeData, fromClick = false): void {
    render(el('p', {}, busy('Porównuję z Krakenem…')));
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
                retryLabel: 'Zaloguj się i kontynuuj',
                show,
                other: { label: 'Spróbuj ponownie', action: () => compare(data, true), mayHaveSaved: false },
                signedOutNote: 'Folder jest już odczytany; nie trzeba go wybierać ponownie.',
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

    const importButton = button('Synchronizuj', () => apply());
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
      summary.textContent = count === 0 ? ' Nic nie wybrano.' : ` Do zapisania: ${count} ${plural(count, 'zmiana', 'zmiany', 'zmian')}.`;
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
          el('strong', {}, item.fields.name || '(bez nazwy)'),
          ` · ${item.fields.country || 'bez kraju'} · ${formatKg(item.container.startGrams)} · dostarczona ${formatDate(item.fields.delivery_date ?? '')}`,
        ),
        el('ul', { class: 'choice-list' }, choice('add', 'Dodaj jako nową dostawę', codeLabel), choice('skip', 'Na razie pomiń')),
      );
    };

    const changedCard = (item: Extract<ImportItem, { kind: 'changed' }>) =>
      el(
        'div',
        { class: 'import-card' },
        el('p', {}, el('strong', {}, item.lot.code), ` · ${item.lot.name}: RoasTime ma inne wartości (odznacz, aby zostawić wartość z Krakena):`),
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
    const roastLabel = (r: Roast) => `${r.name || 'Wypał'} (${roastTimeText(r.roastedAt) || 'bez daty'})`;
    const listed = (roasts: readonly Roast[]) => roasts.map(roastLabel);
    const roastNodes = (): Node[] => {
      const nodes: Node[] = [];
      const added = roastPlan.added.length;
      if (added > 0) nodes.push(el('p', {}, `Zostanie dodanych nowych wypałów: ${added}.`));
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
            `Przywróć usunięte próbki, które są teraz prawdziwymi wypałami (w RoasTime wybrano kawę albo wpisano jej pierwszą dostawę): ${n}. Odznacz, jeśli usunąłeś je celowo.`,
          ),
          details('Pokaż je', withChanges(roastPlan.restored)),
        );
      }
      if (roastPlan.removed.length > 0) {
        const n = roastPlan.removed.length;
        nodes.push(
          details(
            `Próbki do usunięcia (bez kawy albo z kawą bez dostawy w RoasTime): ${n}. Nadal zobaczysz je przez „Pokaż usunięte”.`,
            listed(roastPlan.removed),
          ),
        );
      }
      if (roastPlan.changed.length > 0) {
        const n = roastPlan.changed.length;
        nodes.push(
          tickBox('update-roasts', updateRoasts, (checked) => (updateRoasts = checked), `Zaktualizuj wypały zmienione w RoasTime: ${n}`),
          details('Pokaż zmiany', withChanges(roastPlan.changed)),
        );
      }
      if (roastPlan.keptSamples.length > 0) {
        const n = roastPlan.keptSamples.length;
        nodes.push(
          details(
            `Próbki zostawione, bo w Krakenie mają dostawę, oznaczenie próbki albo uwagi: ${n} (usuń je w zakładce Wypały, jeśli niepotrzebne)`,
            listed(roastPlan.keptSamples),
          ),
        );
      }
      if (roastPlan.unchanged > 0) nodes.push(el('p', { class: 'muted' }, `Wypały zgodne z RoasTime: ${roastPlan.unchanged}.`));
      if (roastPlan.samples.length > 0) {
        nodes.push(details(`Próbki w RoasTime (nieśledzone): ${roastPlan.samples.length}`, roastPlan.samples));
      }
      if (roastPlan.skipped.length > 0) nodes.push(details(`Pominięte (niepobrane): ${roastPlan.skipped.length}`, roastPlan.skipped));
      if (roastPlan.goneFromRoastime.length > 0) {
        nodes.push(
          details(
            `Nie ma ich już w RoasTime: ${roastPlan.goneFromRoastime.length} (zostają w Krakenie; usuń je w zakładce Wypały, jeśli chcesz)`,
            listed(roastPlan.goneFromRoastime),
          ),
        );
      }
      return nodes;
    };

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Synchronizacja z RoasTime: podgląd'), back()),
      el(
        'p',
        { class: 'muted small' },
        'Porównywane są tylko dostawy i wypały pobrane z RoasTime; wpisane ręcznie nigdy się nie zmieniają. Wypały bez kawy wybranej w RoasTime albo z kawą bez dostawy to próbki i nie są śledzone. Synchronizacja nigdy nie zmienia cen, dostawcy, kodów, wybranych dostaw, oznaczeń próbek ani uwag.',
      ),
      ...[...plan.problems, ...roastPlan.problems].map((text) => message(text, 'error')),
      el('h2', { class: 'sub' }, 'Dostawy'),
      ...section(`Nowe dostawy (${fresh.length})`, fresh.map(newCard)),
      ...section(`Zmienione w RoasTime (${changed.length})`, changed.map(changedCard)),
      ...(same.length > 0 ? [el('p', { class: 'muted' }, `Dostawy zgodne z RoasTime: ${same.length}.`)] : []),
      ...section(
        'Tylko do wiadomości',
        [
          ...goneInRoastime.map((i) => el('p', { class: 'muted small' }, `${i.lot.code}: usunięta w RoasTime. Kraken ją zostawia; usuń ją w Krakenie, jeśli chcesz.`)),
          ...goneInKraken.map((i) => el('p', { class: 'muted small' }, `${i.lot.code}: usunięta w Krakenie, więc synchronizacja jej nie rusza. Przywróć ją w Krakenie, aby ją zaktualizować.`)),
        ],
      ),
      ...(fresh.length + changed.length === 0 ? [el('p', { class: 'muted' }, 'Brak nowych lub zmienionych dostaw.')] : []),
      el('h2', { class: 'sub' }, 'Wypały'),
      ...(roastEdits === 0 ? [el('p', { class: 'muted' }, 'Brak nowych lub zmienionych wypałów.')] : []),
      ...roastNodes(),
      ...(fresh.length + changed.length + roastEdits === 0
        ? [message('Wszystko z RoasTime jest już w Krakenie. Nie ma czego synchronizować.')]
        : []),
      el('div', { class: 'actions' }, importButton, summary, button('Anuluj', () => deps.back(), 'secondary')),
    );
    refresh();

    // Called inside the "Import selected" click, so a sign-in renewal can open Google's window.
    function apply(): void {
      const toSave = writes();
      if (changeCount(toSave) === 0) return;
      const step = (text: string) => render(el('p', {}, busy(text)));
      step('Synchronizuję…');
      deps.busy(true);
      deps
        .withGoogle(() => applySync(toSave, { lots: deps.lots, roasts: deps.roasts, whoAmI: deps.whoAmI, now: deps.now, onProgress: step }))
        .finally(() => deps.busy(false))
        .then((result) => {
          if (root.isConnected) deps.back(`Zsynchronizowano z RoasTime: ${summaryOf(result)}.`);
        })
        .catch((error: unknown) => {
          if (!root.isConnected) return;
          const cause = error instanceof ImportStopped ? error.cause : error;
          if (deps.isIgnorable(cause)) {
            start(message('Synchronizację przerwało inne logowanie. Wybierz folder jeszcze raz, aby kontynuować: to, co zapisane, zostanie rozpoznane.'));
            return;
          }
          const saved = error instanceof ImportStopped ? error.saved : 0;
          const total = error instanceof ImportStopped ? error.total : changeCount(toSave);
          const progress =
            saved > 0
              ? `Zanim to się stało, zapisano ${saved} z ${total} zmian.`
              : 'Kraken nie wie, czy coś zostało zapisane.';
          const show = (e: unknown) =>
            start(
              el(
                'div',
                {},
                message(`${progress} Wybierz folder jeszcze raz, aby dokończyć: to, co zapisane, zostanie rozpoznane i nie zostanie dodane drugi raz.`, 'error'),
                ...googleErrorNodes(e, deps, {
                  retry: () => start(),
                  retryLabel: 'Zaloguj się',
                  show,
                  other: { label: 'Wróć', action: () => deps.back(), mayHaveSaved: true },
                  signedOutNote: 'Zaloguj się, a potem wybierz folder jeszcze raz.',
                }),
              ),
            );
          show(cause);
        });
    }
  }

  start();
}
