// Public interface of the Products feature. Code outside `features/products/` imports only this file.

export { isDeleted as isProductDeleted, productFromFields, sortProducts, type Product } from './model';
export { sheetProductsRepository, type ProductsRepository } from './repo';
export { showProductsPage, type ProductsPageDeps } from './page';
export { showPlannerPage, type PlannerPageDeps } from './plannerPage';
export type { PlannerStart } from './planner';
