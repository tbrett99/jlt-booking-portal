// Transaction-local state only; never a client permission, cache or persistent grant.
const accountPlans = new WeakMap<object, ReadonlySet<number>>();
export function setHandbookAccountLockPlan(database: object, ids: number[]) {
  accountPlans.set(database, new Set(ids));
}
export function getHandbookAccountLockPlan(database: object): ReadonlySet<number> | undefined {
  return accountPlans.get(database);
}
