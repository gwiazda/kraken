// Public interface of the Lots feature (green coffee deliveries). Code outside `features/lots/` imports only this file.

export {
  LOTS_TAB,
  LOT_COLUMNS,
  emptyLotForm,
  formFromLot,
  isDeleted,
  lotFromFields,
  lotSource,
  sortLots,
  suggestCode,
  typedPricePerKg,
  validateLotForm,
  type Lot,
  type LotForm,
  type LotFormErrors,
  type LotPriceForm,
} from './model';
export { sheetLotsRepository, type LotsRepository } from './repo';
export { showLotsPage, type LotsPageDeps } from './page';
