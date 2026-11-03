import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { agentMergeCandidates, agentMergeHistory, executeAgentMerge, previewAgentMerge } from "./agent-merge-service";
import { archivedAgentDetails } from "./agent-merge-history";
const id = z.number().int().positive();
const pair = z.object({ sourceUserId: id, primaryUserId: id, keepBanksAsIs: z.boolean().optional() }).refine(v=>v.sourceUserId!==v.primaryUserId,"Choose two different agents.");
const superOnly = adminProcedure.use(({ ctx, next })=>{if(ctx.user.role!=="super_admin") throw new TRPCError({code:"FORBIDDEN",message:"Only a Super Admin can review or perform an agent merge."});return next({ctx});});
export const agentMergeRouter = router({
  candidates: superOnly.input(z.object({search:z.string().trim().min(2).max(150)})).query(({input})=>agentMergeCandidates(input.search)),
  preview: superOnly.input(pair).query(({ctx,input})=>previewAgentMerge(input.sourceUserId,input.primaryUserId,ctx.user.id,input.keepBanksAsIs===true)),
  execute: superOnly.input(z.object({sourceUserId:id,primaryUserId:id,previewToken:z.string().min(20).max(2000),reason:z.string().trim().min(10).max(2000),confirmation:z.string().max(100),samePersonConfirmed:z.literal(true),primaryChoicesConfirmed:z.literal(true),archivedLearningConfirmed:z.literal(true),keepBanksAsIs:z.boolean().optional()})).mutation(({ctx,input})=>executeAgentMerge(input,{id:ctx.user.id,name:ctx.user.name})),
  history: adminProcedure.input(z.object({userId:id})).query(({input})=>agentMergeHistory(input.userId)),
  archivedDetails: adminProcedure.input(z.object({sourceUserId:id})).query(({input})=>archivedAgentDetails(input.sourceUserId)),
});
