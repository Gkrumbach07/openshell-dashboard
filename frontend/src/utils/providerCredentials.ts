import type { ProfileCredential } from '../types';

// The key the gateway stores a profile credential under. It accepts a
// credential's env var names as keys when the profile declares any, and the
// credential's own name only when it declares none; anything else is refused
// as "not declared by profile". The first env var is the one the gateway
// itself names when a required credential is missing.
//
// `storedKeys` are the keys a provider already holds. When one of them belongs
// to this credential it is the one to write to, so that rotating a credential
// stored under a later env var replaces it instead of adding a second copy.
export const credentialStorageKey = (
  credential: ProfileCredential,
  storedKeys: string[] = [],
): string => {
  const accepted = credential.envVars?.length
    ? credential.envVars
    : [credential.name];
  return accepted.find((key) => storedKeys.includes(key)) ?? accepted[0];
};

// A date, or a date and time with its UTC offset, as RFC 3339 writes them. A
// time without an offset is refused: it would be read in the browser's own
// time zone.
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2}))?$/;

// Date.parse rolls a day that does not exist over into the next month
// (February 30 becomes March 2), so the date is checked on its own.
const isCalendarDate = (year: number, month: number, day: number): boolean => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

// Reads what a credential expiry field holds as epoch milliseconds: a whole
// number of milliseconds, or an RFC 3339 date or date and time. An empty field
// is undefined, which leaves the expiry as it is.
//
// Anything that is not a time still to come is NaN and must not be sent. The
// gateway reads an expiry that has passed as an expired credential and
// withholds it from every sandbox, and that is where a mistake lands: zero,
// text that is no date, and a number in epoch seconds, which read as
// milliseconds is a day in January 1970.
export const parseCredentialExpiry = (
  text: string,
  nowMs: number = Date.now(),
): number | undefined => {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  let ms = NaN;
  const date = RFC3339.exec(trimmed);
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed);
  } else if (
    date &&
    isCalendarDate(Number(date[1]), Number(date[2]), Number(date[3]))
  ) {
    ms = Date.parse(trimmed.replace(/[t ]/, 'T').replace(/z$/, 'Z'));
  }
  return Number.isSafeInteger(ms) && ms > nowMs ? ms : NaN;
};
