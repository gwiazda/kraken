// Public interface of the costs feature (Packaging & discounts page, the cost calculation). Code outside `features/costs/` imports only this file.

export { sheetCostsRepository, type CostsRepository } from './repo';
export { showPackagingPage, type CostsPageDeps } from './page';
export { DEFAULT_SETTINGS, readSettings, type CostSettings } from './model';
export { lotLosses, pricingFor, type BeanLot, type LotLoss } from './present';
export { validateLoss } from './model';
export { activeDiscounts, discountForWeight, discountsReady, type Discount } from './modelDiscounts';
