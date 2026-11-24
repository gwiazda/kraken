// Public interface of the Clients feature. Code outside `features/clients/` imports only this file.

export { discountText as clientDiscountText, isDeleted as isClientDeleted, sortClients, type Client } from './model';
export { sheetClientsRepository, type ClientsRepository } from './repo';
export { showClientsPage } from './page';
export { dealKey, offerDeals, type SpecialPrice } from './modelPrices';
export { sheetSpecialPricesRepository, type SpecialPricesRepository } from './repoPrices';
