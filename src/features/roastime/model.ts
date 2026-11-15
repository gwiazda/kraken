// Reading RoasTime's files (Aillio Bullet R2 PRO). The owner chooses the `roast-time` folder in Chrome; Kraken only
// reads `containers/` (one file per green coffee delivery) and `beans/` (one file per coffee).
// Pure: no screen, no Google. Made-up examples: docs/samples/roastime-*.example.json.

/** The folder to choose, for the help box on the import screen. */
export const ROASTIME_FOLDER = '~/Library/Application Support/roast-time';

/** One RoasTime container = one delivery of green coffee = one Kraken lot. */
export interface RoastimeContainer {
  readonly id: string;
  readonly beanId: string;
  /** Starting amount, in grams. */
  readonly startGrams: number;
  readonly deleted: boolean;
  /** When the container was created in RoasTime, or null if the file has no readable time. */
  readonly createdAt: Date | null;
}

export interface RoastimeBean {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly region: string;
  readonly process: string;
  /** RoasTime's supplier code (no names in the files). */
  readonly vendorCode: string;
}

export interface RoastimeData {
  readonly containers: readonly RoastimeContainer[];
  readonly beans: readonly RoastimeBean[];
  /** Files Kraken could not use, one sentence each. */
  readonly problems: readonly string[];
}

/** A file from the chosen folder: its path inside the folder (e.g. `roast-time/containers/abc`) and its text. */
export interface FolderFile {
  readonly path: string;
  readonly text: string;
}

type Json = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function time(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  const seconds = (value as { _seconds?: unknown } | null)?._seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

/** Which RoasTime folder a file is in ('containers' or 'beans'), from its path; null for every other file. */
export function kindOf(path: string): 'containers' | 'beans' | null {
  const parts = path.split('/');
  if (parts.length !== 3) return null; // roast-time / folder / file
  if ((parts[2] ?? '').startsWith('.')) return null; // hidden files macOS adds, e.g. .DS_Store
  const folder = parts[1];
  return folder === 'containers' || folder === 'beans' ? folder : null;
}

/** True if the chosen files look like RoasTime's folder (so Kraken can say "wrong folder" clearly). */
export function looksLikeRoastimeFolder(paths: readonly string[]): boolean {
  return paths.some((p) => kindOf(p) === 'containers') && paths.some((p) => kindOf(p) === 'beans');
}

export function parseRoastimeFiles(files: readonly FolderFile[]): RoastimeData {
  const containers: RoastimeContainer[] = [];
  const beans: RoastimeBean[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const kind = kindOf(file.path);
    if (!kind) continue;
    const name = file.path.split('/').slice(1).join('/');
    let json: Json;
    try {
      const parsed: unknown = JSON.parse(file.text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      json = parsed as Json;
    } catch {
      problems.push(`RoasTime file ${name} could not be read, so Kraken skipped it.`);
      continue;
    }
    if (kind === 'containers') {
      const id = text(json.id);
      const beanId = text(json.beanId);
      const grams = json.startOnHand;
      if (id === '' || beanId === '' || typeof grams !== 'number' || !Number.isSafeInteger(grams) || grams < 0) {
        problems.push(`RoasTime delivery ${name} is missing its ID, coffee or starting amount, so Kraken skipped it.`);
        continue;
      }
      containers.push({ id, beanId, startGrams: grams, deleted: json.deleted === true, createdAt: time(json.createdAt) });
    } else {
      const id = text(json.uid) || text(json.id);
      if (id === '') {
        problems.push(`RoasTime coffee ${name} has no ID, so Kraken skipped it.`);
        continue;
      }
      const vendors = Array.isArray(json.vendorIds) ? json.vendorIds : [];
      beans.push({
        id,
        name: text(json.name),
        country: text(json.country),
        region: text(json.region),
        process: text(json.process),
        vendorCode: text(vendors[0]),
      });
    }
  }
  return { containers, beans, problems };
}
