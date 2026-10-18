import { getRawDbPool } from "./db";

export const MOMENTUM_RULE_KEYS = [
  "community_reaction",
  "community_comment",
  "community_confirmation",
  "community_agent_win",
  "accountability_action",
  "knowledge_base_checkpoint",
  "webinar_checkpoint",
  "verified_event_attendance",
] as const;

export type MomentumRuleKey = typeof MOMENTUM_RULE_KEYS[number];

type MomentumRule = {
  id: number;
  ruleKey: MomentumRuleKey;
  label: string;
  description: string;
  area: string;
  enabled: number | boolean | string;
  points: number;
  weeklyCap: number;
  minimumTextLength: number;
};

export type MomentumAward = {
  agentId: number;
  ruleKey: MomentumRuleKey;
  sourceType: string;
  sourceId: number;
  sourceLabel: string;
  pointsOverride?: number;
};

/** MySQL/TiDB drivers can return TINYINT values as either numbers or strings. */
export function isMomentumRuleEnabled(enabled: MomentumRule["enabled"] | null | undefined) {
  return enabled === true || enabled === 1 || enabled === "1";
}

function startOfUtcWeek(date = new Date()) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export async function getMomentumRule(ruleKey: MomentumRuleKey) {
  const pool = await getRawDbPool();
  const [rows] = await pool.execute("SELECT * FROM momentum_rules WHERE ruleKey = ? LIMIT 1", [ruleKey]);
  return ((rows as MomentumRule[])[0] ?? null) as MomentumRule | null;
}

/**
 * Awards once for a durable provider/source identity. The unique constraint is
 * the replay guard; a mutation retry or a double click never creates points twice.
 */
export async function awardMomentum(input: MomentumAward) {
  const pool = await getRawDbPool();
  const [agentRows] = await pool.execute(
    "SELECT role, isActive, portalStatus FROM users WHERE id = ? LIMIT 1",
    [input.agentId],
  );
  const agent = (agentRows as Array<{ role: string; isActive: number | boolean; portalStatus: string }>)[0];
  if (!agent || agent.role !== "agent" || !agent.isActive || agent.portalStatus !== "active") {
    return { awarded: false, reason: "ineligible_agent", points: 0 } as const;
  }

  const rule = await getMomentumRule(input.ruleKey);
  if (!rule || !isMomentumRuleEnabled(rule.enabled)) return { awarded: false, reason: "rule_disabled", points: 0 } as const;
  const points = Math.max(0, Math.floor(input.pointsOverride ?? rule.points));
  if (!points) return { awarded: false, reason: "no_points", points: 0 } as const;

  if (rule.weeklyCap > 0) {
    const [weekRows] = await pool.execute(
      `SELECT COALESCE(SUM(points), 0) AS total
       FROM momentum_ledger
       WHERE agentId = ? AND ruleKey = ? AND status = 'awarded' AND awardedAt >= ?`,
      [input.agentId, input.ruleKey, startOfUtcWeek()],
    );
    const alreadyAwarded = Number((weekRows as Array<{ total: number | string }>)[0]?.total ?? 0);
    if (alreadyAwarded + points > rule.weeklyCap) {
      return { awarded: false, reason: "weekly_cap", points: 0 } as const;
    }
  }

  const [result] = await pool.execute(
    `INSERT IGNORE INTO momentum_ledger
       (agentId, ruleKey, sourceType, sourceId, sourceLabel, points, status)
     VALUES (?, ?, ?, ?, ?, ?, 'awarded')`,
    [input.agentId, input.ruleKey, input.sourceType, input.sourceId, input.sourceLabel.slice(0, 500), points],
  );
  return (result as { affectedRows?: number }).affectedRows === 1
    ? { awarded: true, reason: "awarded", points } as const
    : { awarded: false, reason: "already_awarded", points: 0 } as const;
}

export async function reverseMomentumForSource(params: {
  agentId?: number;
  sourceType: string;
  sourceId: number;
  reversedById: number;
  reason: string;
}) {
  const pool = await getRawDbPool();
  const filters = ["sourceType = ?", "sourceId = ?", "status = 'awarded'"];
  const values: Array<string | number> = [params.sourceType, params.sourceId];
  if (params.agentId) {
    filters.push("agentId = ?");
    values.push(params.agentId);
  }
  const [result] = await pool.execute(
    `UPDATE momentum_ledger
     SET status = 'reversed', reversedAt = NOW(), reversedById = ?, reversalReason = ?
     WHERE ${filters.join(" AND ")}`,
    [params.reversedById, params.reason, ...values],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

export async function reverseMomentumForCommunityPost(postId: number, reversedById: number, reason: string) {
  const pool = await getRawDbPool();
  const [result] = await pool.execute(
    `UPDATE momentum_ledger
     SET status = 'reversed', reversedAt = NOW(), reversedById = ?, reversalReason = ?
     WHERE sourceId = ? AND sourceType IN ('community_post', 'community_reaction', 'community_comment', 'community_confirmation')
       AND status = 'awarded'`,
    [reversedById, reason, postId],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

export async function getMyMomentum(agentId: number) {
  const pool = await getRawDbPool();
  const [summaryRows] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'awarded' THEN points ELSE 0 END), 0) AS totalPoints,
       COALESCE(SUM(CASE WHEN status = 'awarded' AND awardedAt >= ? THEN points ELSE 0 END), 0) AS monthPoints
     FROM momentum_ledger WHERE agentId = ?`,
    [startOfUtcMonth(), agentId],
  );
  const [recentRows] = await pool.execute(
    `SELECT id, ruleKey, sourceLabel, points, awardedAt
     FROM momentum_ledger WHERE agentId = ? AND status = 'awarded'
     ORDER BY awardedAt DESC LIMIT 5`,
    [agentId],
  );
  return {
    totalPoints: Number((summaryRows as Array<{ totalPoints: number | string }>)[0]?.totalPoints ?? 0),
    monthPoints: Number((summaryRows as Array<{ monthPoints: number | string }>)[0]?.monthPoints ?? 0),
    recent: recentRows as Array<{ id: number; ruleKey: MomentumRuleKey; sourceLabel: string; points: number; awardedAt: Date }>,
  };
}

/** The agent-facing Community view exposes only active-agent names and points. */
export async function getMomentumAgentOverview(agentId: number) {
  const personal = await getMyMomentum(agentId);
  const pool = await getRawDbPool();
  const monthStart = startOfUtcMonth();
  const [leaderboardRows, ruleRows, rankRows] = await Promise.all([
    pool.execute(
      `SELECT l.agentId, COALESCE(NULLIF(u.name, ''), 'JLT agent') AS agentName, SUM(l.points) AS points
       FROM momentum_ledger l
       INNER JOIN users u ON u.id = l.agentId
       WHERE l.status = 'awarded' AND l.awardedAt >= ?
         AND u.role = 'agent' AND u.isActive = true AND u.portalStatus = 'active'
       GROUP BY l.agentId, u.name
       ORDER BY points DESC, agentName ASC
       LIMIT 5`,
      [monthStart],
    ),
    pool.execute(
      `SELECT ruleKey, label, description, area, points, weeklyCap, minimumTextLength
       FROM momentum_rules
       WHERE enabled = true AND ruleKey IN ('community_reaction', 'community_comment', 'community_confirmation', 'community_agent_win', 'accountability_action')
       ORDER BY FIELD(ruleKey, 'community_reaction', 'community_comment', 'community_confirmation', 'community_agent_win', 'accountability_action')`,
    ),
    personal.monthPoints > 0
      ? pool.execute(
          `SELECT 1 + COUNT(*) AS position
           FROM (
             SELECT l.agentId, SUM(l.points) AS points
             FROM momentum_ledger l
             INNER JOIN users u ON u.id = l.agentId
             WHERE l.status = 'awarded' AND l.awardedAt >= ?
               AND u.role = 'agent' AND u.isActive = true AND u.portalStatus = 'active'
             GROUP BY l.agentId
           ) monthly
           WHERE monthly.points > ?`,
          [monthStart, personal.monthPoints],
        )
      : Promise.resolve([[]] as unknown as [unknown[], unknown]),
  ]);
  return {
    agentId,
    ...personal,
    leaderboard: leaderboardRows[0] as Array<{ agentId: number; agentName: string; points: number }>,
    rank: personal.monthPoints > 0 ? Number((rankRows[0] as Array<{ position: number | string }>)[0]?.position ?? 0) : null,
    rules: ruleRows[0] as Array<Pick<MomentumRule, "ruleKey" | "label" | "description" | "area" | "points" | "weeklyCap" | "minimumTextLength">>,
  };
}

export async function getMomentumAdminDashboard() {
  const pool = await getRawDbPool();
  const [rules, leaderboardRows, recentRows] = await Promise.all([
    pool.execute("SELECT * FROM momentum_rules ORDER BY area, label"),
    pool.execute(
      `SELECT l.agentId, COALESCE(u.name, u.email, CONCAT('Agent #', l.agentId)) AS agentName, SUM(l.points) AS points
       FROM momentum_ledger l INNER JOIN users u ON u.id = l.agentId
       WHERE l.status = 'awarded' AND l.awardedAt >= ?
       GROUP BY l.agentId, u.name, u.email ORDER BY points DESC, agentName ASC LIMIT 10`,
      [startOfUtcMonth()],
    ),
    pool.execute(
      `SELECT l.id, l.agentId, COALESCE(u.name, u.email, CONCAT('Agent #', l.agentId)) AS agentName,
              l.ruleKey, l.sourceType, l.sourceId, l.sourceLabel, l.points, l.status, l.awardedAt, l.reversalReason
       FROM momentum_ledger l INNER JOIN users u ON u.id = l.agentId
       ORDER BY l.awardedAt DESC LIMIT 50`,
    ),
  ]);
  const normalisedRules = (rules[0] as MomentumRule[]).map((rule) => ({
    ...rule,
    enabled: isMomentumRuleEnabled(rule.enabled),
    points: Number(rule.points),
    weeklyCap: Number(rule.weeklyCap),
    minimumTextLength: Number(rule.minimumTextLength),
  }));
  return {
    rules: normalisedRules,
    activeRuleCount: normalisedRules.filter((rule) => rule.enabled).length,
    leaderboard: leaderboardRows[0] as Array<{ agentId: number; agentName: string; points: number }>,
    recent: recentRows[0] as Array<{ id: number; agentId: number; agentName: string; ruleKey: string; sourceType: string; sourceId: number; sourceLabel: string; points: number; status: "awarded" | "reversed"; awardedAt: Date; reversalReason: string | null }>,
  };
}

export async function updateMomentumRule(params: {
  ruleKey: MomentumRuleKey;
  enabled: boolean;
  points: number;
  weeklyCap: number;
  minimumTextLength: number;
}) {
  const pool = await getRawDbPool();
  const [result] = await pool.execute(
    `UPDATE momentum_rules
     SET enabled = ?, points = ?, weeklyCap = ?, minimumTextLength = ?
     WHERE ruleKey = ?`,
    [params.enabled, Math.floor(params.points), Math.floor(params.weeklyCap), Math.floor(params.minimumTextLength), params.ruleKey],
  );
  if (!(result as { affectedRows?: number }).affectedRows) throw new Error("Momentum rule not found");
}
