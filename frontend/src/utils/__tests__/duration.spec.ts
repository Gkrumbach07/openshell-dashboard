import { parseSinceDuration } from '../duration';

// The forms `openshell logs --since` takes: a whole number and s, m or h.
describe('parseSinceDuration', () => {
  it.each([
    ['30s', 30_000],
    ['5m', 300_000],
    ['1h', 3_600_000],
    ['90m', 5_400_000],
    [' 15m ', 900_000],
  ])('reads %j as %d ms', (input, expected) => {
    expect(parseSinceDuration(input)).toBe(expected);
  });

  it.each([
    '',
    '5',
    'm',
    '5d',
    '5 m',
    '1.5h',
    '-5m',
    '5M',
    '5min',
    '1h30m',
    // Selects nothing, so it is not a window.
    '0m',
    // Too large to be a number of milliseconds.
    '99999999999999999999h',
  ])('does not take %j for a duration', (input) => {
    expect(parseSinceDuration(input)).toBeUndefined();
  });
});
