// Every migration, oldest first. Add new ones at the end with the next version number.

import type { Migration } from '../migrationTypes';
import { addLots } from './002-add-lots';
import { addRoasts } from './003-add-roasts';
import { addCosts } from './004-add-costs';
import { addPriceList } from './005-add-price-list';
import { addProducts } from './006-add-products';

export const MIGRATIONS: readonly Migration[] = [addLots, addRoasts, addCosts, addPriceList, addProducts];
