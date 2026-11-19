// Public interface of the Clients feature. Code outside `features/clients/` imports only this file.

export { isDeleted as isClientDeleted, sortClients, type Client } from './model';
export { sheetClientsRepository, type ClientsRepository } from './repo';
export { showClientsPage } from './page';
