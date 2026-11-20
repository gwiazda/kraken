// The products with what one bag of each size costs (from their beans, the lots, the packaging and the roast loss),
// for other pages that show what a price earns (Clients: special prices). The same calculation as a product's page.

import type { BagSize } from '../../domain/bagSizes';
import type { CostsRepository, Discount } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import type { Product } from './model';
import { beansOf, formFromBean } from './modelBeans';
import { loadPlannerData } from './planner';
import { costing } from './present';
import { costsBySize } from './priceTable';
import type { ProductsRepository } from './repo';

export interface ProductsWithCosts {
  readonly products: Product[];
  /** Per product id (not deleted ones): the cost of one bag per size, in grosze (a size missing: it cannot be worked out). */
  readonly bagCosts: ReadonlyMap<string, Partial<Record<BagSize, number>>>;
  readonly vatTenths: number;
  readonly discounts: Discount[];
  /** Why something could not be read (the products are still given, without costs then). */
  readonly problems: string[];
}

export async function loadProductsWithCosts(sources: {
  products: ProductsRepository;
  costs: CostsRepository;
  lots: LotsRepository;
  roasts: RoastsRepository;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
}): Promise<ProductsWithCosts> {
  const [stored, data] = await Promise.all([sources.products.load(), loadPlannerData(sources)]);
  const bagCosts = new Map(
    stored.products.filter((p) => p.deletedAt === '').map((p) => {
      const made = costing(beansOf(stored.beans, p.id).map(formFromBean), data.beanLots, data.packaging, data.settings.vatTenths, data.settings.defaultLossTenths, p.prices);
      return [p.id, costsBySize(made.rows) as Partial<Record<BagSize, number>>] as const;
    }),
  );
  return { products: stored.products, bagCosts, vatTenths: data.settings.vatTenths, discounts: data.discounts, problems: [...stored.problems, ...data.problems] };
}
