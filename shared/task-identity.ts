export type TaskIdentityUser = {
  id: number;
  email?: string | null;
  /** Additional legacy IDs represented by this one visible owner option. */
  identityUserIds?: number[];
};

/**
 * A few legacy staff accounts share one authenticated email. Treat the IDs for
 * that same email as one task owner, so an assignment made to either account is
 * visible to the colleague who is actually signed in.
 */
export function normaliseTaskIdentityEmail(email?: string | null) {
  return (email ?? "").trim().toLowerCase();
}

export function resolveEquivalentTaskOwnerIds(
  currentUser: TaskIdentityUser | null | undefined,
  users: TaskIdentityUser[],
) {
  if (!currentUser) return [];

  const email = normaliseTaskIdentityEmail(currentUser.email);
  if (!email) return [currentUser.id];

  const ids = Array.from(new Set(users
    .filter((user) => normaliseTaskIdentityEmail(user.email) === email)
    .flatMap((user) => user.identityUserIds ?? [user.id])));

  return ids.includes(currentUser.id) ? ids : [currentUser.id, ...ids];
}
