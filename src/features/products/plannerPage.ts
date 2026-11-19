// The Planner tab (owner, 2026-11-19): a scratchpad to try beans, shares and prices before buying or deciding
// ("when I think about buying some beans I need to know what price to put on my product"). Nothing is saved. It is
// the same planner as in the product form (planner.ts), so a change to one is a change to both.
// Everything from outside comes through PlannerPageDeps (main.ts provides it).

import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import type { CostsRepository } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import { createPlanner, loadPlannerData, type PlannerStart } from './planner';

export interface PlannerPageDeps {
  costs: CostsRepository;
  lots: LotsRepository;
  roasts: RoastsRepository;
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  /** Opens "Add product" with these beans and prices filled in. */
  createProduct: (start: PlannerStart) => void;
}

/** A fresh planner: one bean to choose, no prices. */
export const EMPTY_PLAN: PlannerStart = {
  beans: [{ kind: 'lot', lotId: '', plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: 100 }],
  prices: {},
};

/** `start`: what to begin with (e.g. a product's beans and prices from "Try in Planner"); else an empty plan. */
export function showPlannerPage(root: HTMLElement, deps: PlannerPageDeps, start: PlannerStart = EMPTY_PLAN, fromClick = false): void {
  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(fromClick = false): void {
    render(el('p', {}, busy('Loading lots and packaging…')));
    const data = () => loadPlannerData(deps, (e) => deps.isSignedOut(e) || deps.isIgnorable(e), deps.describeError);
    (fromClick ? deps.withGoogle(data) : data())
      .then((found) => {
        if (!root.isConnected) return;
        const show = (plan: PlannerStart) => {
          const planner = createPlanner(found, plan, {
            pricesTitle: 'Prices to try, with VAT',
            pricesIntro: 'Type a price to see what it earns, or click a suggestion. ',
          });
          render(
            el('div', { class: 'page-head' }, el('h2', {}, 'Planner')),
            el(
              'p',
              { class: 'muted small' },
              'Try beans, shares and prices before you buy or decide: lots you have, or a planned bean with the price you were quoted. Nothing is saved; when you like it, make a product from it.',
            ),
            ...found.problems.map((text) => message(text, 'error')),
            planner.node,
            el(
              'div',
              { class: 'actions' },
              button('Create product from this', () => deps.createProduct({ beans: planner.beans(), prices: planner.prices() })),
              button('Start over', () => show(EMPTY_PLAN), 'secondary'),
            ),
          );
        };
        show(start);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Sign in and open the Planner',
              show,
              other: { label: 'Try again', action: () => load(true), mayHaveSaved: false },
              signedOutNote: 'Nothing was lost.',
            }),
          );
        show(error);
      });
  }

  load(fromClick);
}
