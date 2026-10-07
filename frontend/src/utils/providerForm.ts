// What the Add Provider and Edit Provider forms work out before they send
// anything. Both follow the OpenShell TUI, crates/openshell-tui/src at v0.1.2.

// A name no provider in the workspace has yet, starting from a provider type:
// "openai", then "openai-1", "openai-2" and so on. It is unique_provider_name
// in the TUI's app.rs, which gives up after 99 and returns the type itself;
// the gateway then says the name is taken.
export const uniqueProviderName = (
  base: string,
  existing: string[],
): string => {
  if (!existing.includes(base)) {
    return base;
  }
  for (let i = 1; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.includes(candidate)) {
      return candidate;
    }
  }
  return base;
};

export type ConfigRow = { key: string; value: string };

export const configRowsOf = (
  config: Record<string, string> = {},
): ConfigRow[] =>
  Object.entries(config).map(([key, value]) => ({ key, value }));

// The configuration the rows describe: a row without a key is not an entry,
// and a key given twice keeps its last value.
//
// A key is any text, "constructor" and "__proto__" included. The rows are
// collected in a Map and turned into an object by Object.fromEntries, which
// makes each one an entry of its own: assigned to a plain object, "__proto__"
// would set the object's prototype instead of an entry.
const entriesOf = (rows: ConfigRow[]): Map<string, string> => {
  const entries = new Map<string, string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key) {
      entries.set(key, row.value);
    }
  }
  return entries;
};

// The configuration a new provider is created with.
export const configFromRows = (rows: ConfigRow[]): Record<string, string> =>
  Object.fromEntries(entriesOf(rows));

// The configuration an edit changed, as the gateway takes it: the keys whose
// value is new or different, and each key that was removed with an empty
// value, which is how the gateway is told to remove one. A key the edit left
// alone is not in it, so whatever value that key has by now stays.
//
// `original` is the configuration as it was when the form opened, not as it
// is when the form is saved: only what the person changed is written. It is
// how spawn_update_provider in the TUI's lib.rs builds its request.
export const configChanges = (
  original: Record<string, string>,
  rows: ConfigRow[],
): Record<string, string> => {
  // What the provider had, entry by entry. Not `key in original`, which is
  // also true of what every object inherits, such as "constructor".
  const before = new Map(Object.entries(original));
  const edited = entriesOf(rows);
  const changes = new Map<string, string>();
  for (const [key, value] of edited) {
    // A new key with no value is nothing to store.
    if (before.get(key) !== value && !(value === '' && !before.has(key))) {
      changes.set(key, value);
    }
  }
  for (const key of before.keys()) {
    if (!edited.has(key)) {
      changes.set(key, '');
    }
  }
  return Object.fromEntries(changes);
};
