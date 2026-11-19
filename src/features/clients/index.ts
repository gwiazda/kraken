// Public interface of the Clients feature. Code outside `features/clients/` imports only this file.

export { formatNip, isDeleted as isClientDeleted, sortClients, type Client } from './model';
export { sheetClientsRepository, type ClientsRepository } from './repo';
export { showClientsPage, type ClientsPageDeps } from './page';
