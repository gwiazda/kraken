// Every migration, oldest first. Add new ones at the end with the next version number.

import type { Migration } from '../migrationTypes';
import { addLots } from './002-add-lots';

export const MIGRATIONS: readonly Migration[] = [addLots];
