// Step 3 — data box loader + helpers.
//
// The data box is a local, gitignored vault of labeled test fixtures. For now
// it holds only `logins` (Step 6 adds payments/addresses/identity). Each
// category is a fallback list: the runner tries entries in order until one
// works. TEST/FAKE DATA ONLY — it lives in plaintext on disk.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Login {
  label: string;
  username: string;
  password: string;
}

export interface DataBox {
  logins: Login[];
}

const here = dirname(fileURLToPath(import.meta.url));
const DATABOX_PATH = join(here, "databox.json");

let cache: DataBox | null = null;

export function loadDataBox(): DataBox {
  if (cache) return cache;
  let raw: string;
  try {
    raw = readFileSync(DATABOX_PATH, "utf8");
  } catch {
    throw new Error(
      `Data box not found at ${DATABOX_PATH}. ` +
        `Copy src/data/databox.example.json to databox.json and fill in test credentials.`,
    );
  }
  cache = JSON.parse(raw) as DataBox;
  return cache;
}

/**
 * Returns logins in the order the runner should try them. When `label` is
 * given, the matching entry is tried first and the rest act as fallback; an
 * unknown label falls back to file order. Without a label, file order is kept.
 */
export function getLogins(label?: string): Login[] {
  const logins = loadDataBox().logins ?? [];
  if (logins.length === 0) {
    throw new Error("Data box has no logins.");
  }
  if (!label) return logins;
  const match = logins.filter((l) => l.label === label);
  const rest = logins.filter((l) => l.label !== label);
  return match.length === 0 ? logins : [...match, ...rest];
}
