/**
 * Display-name heuristics for first-login provisioning (FR-E1-1): the signup
 * flow knows only the email address, so org and user names are derived from
 * it. Deliberately simple for the pilot — both are editable later.
 */
function capitalize(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/** jane@acme.com -> "Acme" (first domain label, capitalized). */
export function orgNameFromEmail(email: string): string {
  const domain = email.split('@')[1] ?? '';
  const label = domain.split('.')[0]?.trim() ?? '';
  return label.length > 0 ? capitalize(label) : 'New Organization';
}

/** jane.doe@acme.com -> "Jane Doe" (local part split on separators). */
export function userNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local
    .split(/[._\-+]+/)
    .filter((part) => part.length > 0)
    .map(capitalize);
  return parts.length > 0 ? parts.join(' ') : email;
}
