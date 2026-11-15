// Public interface of the schema module: the Kraken sheet's structure (`_meta`, later migrations).
// Code outside `schema/` imports only from this file.

export { createKrakenSpreadsheet, describeMetaProblem, inspectSpreadsheet, type ConnectResult } from './connect';
