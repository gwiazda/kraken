// Public interface of the schema module: the Kraken sheet's structure (`_meta`, migrations).
// Code outside `schema/` imports only from this file.

export { createKrakenSpreadsheet, describeMetaProblem, inspectSpreadsheet, updateSpreadsheet, type ConnectResult } from './connect';
export { MigrationError, updatePlan } from './migrate';
