export type TaskIdentityUser = {
  id: number;
  email?: string | null;
  /** Server-verified task history IDs represented by this visible active owner. */
  identityUserIds?: number[];
};
export function normaliseTaskIdentityEmail(email?: string | null) {
  return (email ?? "").trim().toLowerCase();
}
export function isPositiveTaskIdentityId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
/** Explicit task identity membership works even when an archived user's email is null. */
export function resolveEquivalentTaskOwnerIds(
  currentUser: TaskIdentityUser | null | undefined,
  users: TaskIdentityUser[],
): number[] {
  if (!currentUser || !isPositiveTaskIdentityId(currentUser.id)) return [];
  const email = normaliseTaskIdentityEmail(currentUser.email);
  const equivalents = users.filter((user) => isPositiveTaskIdentityId(user.id) && (
    user.id === currentUser.id
    || user.identityUserIds?.includes(currentUser.id)
    || (email !== "" && normaliseTaskIdentityEmail(user.email) === email)
  ));
  return Array.from(new Set([currentUser.id, ...equivalents.flatMap((user) =>
    [user.id, ...(user.identityUserIds ?? [])].filter(isPositiveTaskIdentityId),
  )]));
}
