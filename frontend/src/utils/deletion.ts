import { AlertVariant } from '@patternfly/react-core';

import type { DeletionOutcome } from '../types';

const OUTCOMES: readonly DeletionOutcome[] = [
  'completed',
  'accepted',
  'already_absent',
  'unspecified',
];

// The outcome in the answer to a delete. An answer that names none the
// dashboard knows is "unspecified" and never read as a deletion, except one
// from an endpoint that reports only `deleted: true`.
export const deletionOutcome = (result: unknown): DeletionOutcome => {
  if (typeof result !== 'object' || result === null) {
    return 'unspecified';
  }
  const { outcome, deleted } = result as {
    outcome?: unknown;
    deleted?: unknown;
  };
  if (outcome === undefined) {
    return deleted === true ? 'completed' : 'unspecified';
  }
  return OUTCOMES.find((known) => known === outcome) ?? 'unspecified';
};

// What a resource is called in a message: "sandbox" for one, "sandboxes" for
// several.
export type ResourceNoun = {
  singular: string;
  plural: string;
};

export type DeletionNotice = {
  variant: AlertVariant;
  title: string;
};

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

// What a delete did to one resource, in the words of `openshell sandbox
// delete` and the TUI. Only the first is a deletion that has happened: an
// accepted one is still being cleaned up, and an unspecified outcome is the
// failure the CLI treats it as.
export const describeDeletion = (
  noun: ResourceNoun,
  name: string,
  outcome: DeletionOutcome,
): DeletionNotice => {
  const subject = `${capitalize(noun.singular)} "${name}"`;
  switch (outcome) {
    case 'completed':
      return { variant: AlertVariant.success, title: `${subject} deleted` };
    case 'accepted':
      return {
        variant: AlertVariant.info,
        title: `${subject} deletion accepted; cleanup is pending`,
      };
    case 'already_absent':
      return {
        variant: AlertVariant.success,
        title: `${subject} already deleted`,
      };
    default:
      return {
        variant: AlertVariant.danger,
        title: `Unsupported deletion outcome for ${noun.singular} "${name}"`,
      };
  }
};

const count = (outcomes: DeletionOutcome[], outcome: DeletionOutcome): number =>
  outcomes.filter((candidate) => candidate === outcome).length;

// The same for several resources deleted together, each with the outcome the
// gateway gave it. names and outcomes are in the same order.
export const describeDeletions = (
  noun: ResourceNoun,
  names: string[],
  outcomes: DeletionOutcome[],
): DeletionNotice => {
  if (names.length === 1) {
    return describeDeletion(noun, names[0], outcomes[0] ?? 'unspecified');
  }
  const completed = count(outcomes, 'completed');
  const accepted = count(outcomes, 'accepted');
  const absent = count(outcomes, 'already_absent');
  const unsupported = names.length - completed - accepted - absent;
  const things = (n: number) => (n === 1 ? noun.singular : noun.plural);

  const parts: string[] = [];
  if (completed > 0) {
    parts.push(`${completed} ${things(completed)} deleted`);
  }
  if (accepted > 0) {
    parts.push(
      `${accepted} ${noun.singular} ${accepted === 1 ? 'deletion' : 'deletions'} accepted; cleanup is pending`,
    );
  }
  if (absent > 0) {
    parts.push(`${absent} ${things(absent)} already deleted`);
  }
  if (unsupported > 0) {
    parts.push(
      `Unsupported deletion outcome for ${unsupported} ${things(unsupported)}`,
    );
  }

  let variant = AlertVariant.success;
  if (unsupported > 0) {
    variant = AlertVariant.danger;
  } else if (accepted > 0) {
    variant = AlertVariant.info;
  }
  return { variant, title: parts.join('. ') };
};
