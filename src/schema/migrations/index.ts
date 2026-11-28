// Every migration, oldest first. Add new ones at the end with the next version number.

import type { Migration } from '../migrationTypes';
import { addLots } from './002-add-lots';
import { addRoasts } from './003-add-roasts';
import { addCosts } from './004-add-costs';
import { addPriceList } from './005-add-price-list';
import { addProducts } from './006-add-products';
import { addDiscounts } from './007-add-discounts';
import { addProductBeans } from './008-add-product-beans';
import { addClients } from './009-add-clients';
import { addSales } from './010-add-sales';
import { addProductPosition } from './011-add-product-position';
import { addSpecialPrices } from './012-add-special-prices';
import { addSaleNotes } from './013-add-sale-notes';
import { addProductStatus } from './014-add-product-status';
import { addDiscountFromKg } from './015-add-discount-from-kg';
import { addSalePrices } from './016-add-sale-prices';
import { addSaleInvoiceLink } from './017-add-sale-invoice-link';

export const MIGRATIONS: readonly Migration[] = [addLots, addRoasts, addCosts, addPriceList, addProducts, addDiscounts, addProductBeans, addClients, addSales, addProductPosition, addSpecialPrices, addSaleNotes, addProductStatus, addDiscountFromKg, addSalePrices, addSaleInvoiceLink];
