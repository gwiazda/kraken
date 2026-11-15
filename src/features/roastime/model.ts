// Reading RoasTime's files (Aillio Bullet R2 PRO). The owner chooses the `roast-time` folder in Chrome; Kraken only
// reads `containers/` (one file per green coffee delivery), `beans/` (one file per coffee) and `roasts/` (one file
// per roast; Kraken keeps only the summary, never the temperature curves).
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

/** One roast, as RoasTime saved it. */
export interface RoastimeRoast {
  readonly id: string;
  readonly roastedAt: Date | null;
  readonly name: string;
  /** Empty when no coffee was chosen in RoasTime (e.g. samples). */
  readonly beanId: string;
  /** Green weight in whole grams; null if missing or not a number. */
  readonly greenGrams: number | null;
  /** Roasted weight in tenths of a gram; null if missing. */
  readonly roastedDecigrams: number | null;
  /** The roaster's comment in RoasTime, if any. */
  readonly comment: string;
}

export interface RoastimeData {
  readonly containers: readonly RoastimeContainer[];
  readonly beans: readonly RoastimeBean[];
  readonly roasts: readonly RoastimeRoast[];
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

/** A weight in grams written as a number or as text ("150", "132.5"); null if missing or not a non-negative number. */
function weight(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Which RoasTime folder a file is in, from its path; null for every other file. */
export function kindOf(path: string): 'containers' | 'beans' | 'roasts' | null {
  const parts = path.split('/');
  if (parts.length !== 3) return null; // roast-time / folder / file
  if ((parts[2] ?? '').startsWith('.')) return null; // hidden files macOS adds, e.g. .DS_Store
  const folder = parts[1];
  return folder === 'containers' || folder === 'beans' || folder === 'roasts' ? folder : null;
}

/** True if the chosen files look like RoasTime's folder (so Kraken can say "wrong folder" clearly). */
export function looksLikeRoastimeFolder(paths: readonly string[]): boolean {
  return paths.some((p) => kindOf(p) === 'containers') && paths.some((p) => kindOf(p) === 'beans');
}

export function parseRoastimeFiles(files: readonly FolderFile[]): RoastimeData {
  const containers: RoastimeContainer[] = [];
  const beans: RoastimeBean[] = [];
  const roasts: RoastimeRoast[] = [];
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
    if (kind === 'roasts') {
      const id = text(json.uid) || text(json.id);
      if (id === '') {
        problems.push(`RoasTime roast ${name} has no ID, so Kraken skipped it.`);
        continue;
      }
      const green = weight(json.weightGreen);
      const roasted = weight(json.weightRoasted);
      roasts.push({
        id,
        roastedAt: time(json.dateTime),
        name: text(json.roastName),
        beanId: text(json.beanId),
        greenGrams: green === null ? null : Math.round(green),
        roastedDecigrams: roasted === null || roasted === 0 ? null : Math.round(roasted * 10),
        comment: text(json.comments),
      });
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
  return { containers, beans, roasts, problems };
}
