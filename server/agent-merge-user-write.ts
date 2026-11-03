import { and, eq, isNull, notLike, or } from "drizzle-orm";
import { users } from "../drizzle/schema";
/** Query-level guard: a request passing the earlier identity read before a merge
 * still cannot later UPDATE/DELETE the permanently archived user row. Uses the
 * existing suspensionReason field, so rolling deployments need no new user column. */
export function writableAgentUser(id: number) {
  return and(eq(users.id,id),or(isNull(users.suspensionReason),notLike(users.suspensionReason,"merged_into:%")));
}
