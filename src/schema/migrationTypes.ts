// What a migration may do. Steps are data, not free code, and there is deliberately no step that deletes
// anything: a mistake in a future migration cannot remove the owners' data.

export type MigrationStep = {
  /** Adds a new tab with a header row. Already there with the same headers: skipped (safe to run again). */
  kind: 'add-tab';
  tab: string;
  headers: readonly string[];
};

export interface Migration {
  /** The data version the sheet has after this migration. */
  toVersion: number;
  /** Shown to the user, e.g. "adds the Lots tab". */
  description: string;
  steps: readonly MigrationStep[];
}
