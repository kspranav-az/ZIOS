import { describe, expect, it } from 'vitest';
import { orgNameFromEmail, userNameFromEmail } from './naming';

describe('orgNameFromEmail', () => {
  it('uses the first domain label, capitalized', () => {
    expect(orgNameFromEmail('jane@acme.com')).toBe('Acme');
    expect(orgNameFromEmail('jane@stark-industries.io')).toBe('Stark-industries');
  });

  it('falls back when the domain is malformed', () => {
    expect(orgNameFromEmail('jane@')).toBe('New Organization');
  });
});

describe('userNameFromEmail', () => {
  it('derives a display name from the local part', () => {
    expect(userNameFromEmail('jane.doe@acme.com')).toBe('Jane Doe');
    expect(userNameFromEmail('j_smith@acme.com')).toBe('J Smith');
    expect(userNameFromEmail('neo@acme.com')).toBe('Neo');
  });
});
