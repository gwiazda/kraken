// Public interface of the Costs & prices feature. Code outside `features/costs/` imports only this file.

export { sheetCostsRepository, type CostsRepository } from './repo';
export { showPackagingPage, type CostsPageDeps } from './page';
export { DEFAULT_SETTINGS, readSettings, type CostSettings } from './model';
export { lotLosses, pricingFor, type LotLoss, type LotSuggestion } from './present';
export { validateLoss } from './model';
export { activeDiscounts, type Discount } from './modelDiscounts';
