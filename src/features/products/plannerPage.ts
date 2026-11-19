// The Product planner tab (owner, 2026-11-19; renamed from "Planner"): a scratchpad to try beans, shares and prices before buying or deciding
// ("when I think about buying some beans I need to know what price to put on my product"). Nothing is saved. It is
// the same planner as in the product form (planner.ts), so a change to one is a change to both.
// Everything from outside comes through PlannerPageDeps (main.ts provides it).

import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import type { CostsRepository } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import { isDeleted, sortProducts } from './model';
import { beansOf, formFromBean } from './modelBeans';
import { createPlanner, loadPlannerData, type PlannerStart } from './planner';
import type { ProductsRepository } from './repo';

export interface PlannerPageDeps {
  /** The products, to compare the plan with. */
  products: ProductsRepository;
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
  /** The plan after each change, so Back/Forward can bring it back (it is kept only in this browser tab). */
  remember: (plan: PlannerStart) => void;
}

/** A fresh planner: one bean to choose, no prices. */
export const EMPTY_PLAN: PlannerStart = {
  beans: [{ kind: 'lot', lotId: '', plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: 100 }],
  prices: {},
};

/** `start`: what to begin with (e.g. a product's beans and prices from "Try in Product planner"); else an empty plan. */
export function showPlannerPage(root: HTMLElement, deps: PlannerPageDeps, start: PlannerStart = EMPTY_PLAN, fromClick = false): void {
  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(fromClick = false): void {
    render(el('p', {}, busy('Loading lots and packaging…')));
    // The products are only for the comparison: if they cannot be read, the planner still opens, with a note.
    const products = () =>
      deps.products.load().catch((error: unknown) => {
        if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
        return { products: [], beans: [], problems: [`Your products could not be read for the comparison (${deps.describeError(error)}).`] };
      });
    const data = () => Promise.all([loadPlannerData(deps), products()]);
    (fromClick ? deps.withGoogle(data) : data())
      .then(([found, stored]) => {
        if (!root.isConnected) return;
        // Every product with its beans and main prices, to compare the plan with.
        const products = sortProducts(stored.products)
          .filter((p) => !isDeleted(p))
          .map((p) => ({ name: p.name, beans: beansOf(stored.beans, p.id).map(formFromBean), prices: p.prices }));
        const show = (plan: PlannerStart) => {
          const planner = createPlanner(found, plan, {
            pricesTitle: 'Prices to try, with VAT',
            pricesIntro: 'Type a price to see what it earns, or click a suggestion. ',
            onChange: deps.remember,
            extra: { discounts: found.discounts, products },
          });
          render(
            el('div', { class: 'page-head' }, el('h2', {}, 'Product planner')),
            el(
              'p',
              { class: 'muted small' },
              'Try beans, shares and prices before you buy or decide: lots you have, or a planned bean with the price you were quoted. Nothing is saved; when you like it, make a product from it.',
            ),
            ...[...found.problems, ...stored.problems].map((text) => message(text, 'error')),
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
              retryLabel: 'Sign in and open the Product planner',
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
