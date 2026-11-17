import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import * as orm from "drizzle-orm";
import * as schema from "../drizzle/schema";
const text = fs.readFileSync("server/routers.ts", "utf8");
const source = ts.createSourceFile("routers.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function callback(namespace: string, operation: string, dependencies: Record<string, any>) {
 let entry: ts.PropertyAssignment | undefined;
 const find = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(source) === namespace && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "router" && !!node.initializer.arguments[0] && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
  entry = node.initializer.arguments[0].properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === operation) as ts.PropertyAssignment | undefined;
 } ts.forEachChild(node, find); };
 find(source); if (!entry || !ts.isCallExpression(entry.initializer)) throw new Error(`Actual ${namespace}.${operation} callback missing`);
 const arrow = entry.initializer.arguments[0]; if (!ts.isArrowFunction(arrow)) throw new Error("Expected real procedure callback");
 const bindings = arrow.getText(source).replace(/await import\((["'])(.*?)\1\)/g, (_whole, _quote, path) => `__imports[${JSON.stringify(path)}]`);
 const code = ts.transpileModule(`const handler = ${bindings};`, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
 const imports = { "./db": dependencies, "../drizzle/schema": schema, "drizzle-orm": orm, "./booking-document-download-routes": { assertSharedBookingAttachmentReferences: dependencies.assertSharedBookingAttachmentReferences, sharedBookingNoteAttachments: dependencies.sharedBookingNoteAttachments }, "../shared/uploadValidation": { isAllowedMimeType: () => true } };
 return new Function(...Object.keys(dependencies), "__imports", code + "return handler;")(...Object.values(dependencies), imports);
}
const employee = { id: 20, role: "agent", name: "Synthetic Employee", email: "employee@example.invalid" };
const owner = { id: 10, role: "agent", name: "Synthetic Owner", email: "owner@example.invalid" };
const scope = { managed: true, actorUserId: 20, ownerUserId: 10, membershipId: 50 };
const booking = { id: 100, agentId: 10, isPersonalBooking: false, clientName: "Synthetic Traveller", currentStage: "Added to PTS", expectedCommission: "100.00" };
const writer = { synthetic: "same locked transaction" };
let allowed: boolean, committed: boolean, calls: any[], dependencies: Record<string, any>;
beforeEach(() => {
 allowed = true; committed = false; calls = [];
 const access = vi.fn(async (_ctx: any, record: any) => { if (!allowed || record.agentId !== 10 || record.isPersonalBooking !== false) throw new TRPCError({ code: "FORBIDDEN" }); return scope; });
 const write = vi.fn(async (ctx: any, id: number, work: any) => { expect(ctx.user.id).toBe(20); expect(id).toBe(100); if (!allowed) throw new TRPCError({ code: "FORBIDDEN" }); const result = await work(writer, scope); committed = true; return result; });
 const persist = (name: string, result: any) => vi.fn(async (input: any, connection: any) => { expect(connection).toBe(writer); calls.push({ name, input, connection }); return result; });
 dependencies = {
  TRPCError, getBookingById: vi.fn(async () => ({ ...booking })), getBooking: vi.fn(async () => ({ ...booking })), getBookingActorScope: vi.fn(async () => { if (!allowed) throw new TRPCError({ code: "FORBIDDEN" }); return scope; }), assertBookingActorAccess: access, assertFormalBookingAccess: access,
  withBookingActorWrite: write, withFormalBookingWrite: write,
  createAmendment: persist("amendment", 101), createCancellation: persist("cancellation", 102), createRefund: persist("refund", 103), createReimbursementItems: persist("reimbursements", [{ id: 104, agentId: 10, bookingId: 100 }]),
  createNote: persist("note", { id: 200 }), updateBookingStage: vi.fn(async (_id, _stage, actorId, connection) => { expect(actorId).toBe(20); expect(connection).toBe(writer); }),
  getAllUsers: vi.fn(async () => [{ id: 30, role: "admin" }]), getUserById: vi.fn(async () => null), getLastAdminNoteAuthor: vi.fn(async () => null), getNotificationTemplate: vi.fn(async () => null),
  createInAppNotification: vi.fn(async () => { expect(committed).toBe(true); }), sendDirectEmail: vi.fn(async () => { expect(committed).toBe(true); }), encryptOptional: vi.fn((value: any) => value ? `encrypted:${value}` : undefined),
  assertSharedBookingAttachmentReferences: vi.fn(async () => undefined), sharedBookingNoteAttachments: vi.fn(async (rows: any) => rows), extractMentions: () => [], getBookingNotes: vi.fn(async () => []), getNoteById: vi.fn(async () => null), getDb: vi.fn(() => { throw new Error("Unexpected global database use"); }),
 };
});
describe("actual normal business-staff formal request callbacks", () => {
 it.each([
  ["amendments", { details: "Synthetic supplier change", lineItems: [{ type: "other", notes: "Synthetic" }] }, "amendment"],
  ["cancellations", { reason: "Synthetic cancellation", confirmedSupplierCancellation: true }, "cancellation"],
  ["refunds", { refundType: "supplier", refundReason: "Synthetic refund", stepsTaken: "Synthetic supplier contact", suppliers: [], clientBankName: "Synthetic Bank" }, "refund"],
 ] as const)("keeps %s request ownership with the business and its audit with the employee", async (namespace, input, name) => {
  const handler = callback(namespace, "submit", dependencies); await handler({ ctx: { user: employee }, input: { bookingId: 100, agentId: 999, ...input } });
  const request = calls.find(call => call.name === name); expect(request.input.agentId).toBe(10); expect(request.connection).toBe(writer);
  expect(calls.find(call => call.name === "note").input).toMatchObject({ bookingId: 100, authorId: 20, isInternal: false });
  expect(calls.find(call => call.name === "note").input.content).toContain("Synthetic Employee"); expect(employee.id).toBe(20); expect(dependencies.createInAppNotification).toHaveBeenCalled();
 });
 it("encrypts refund bank fields through the existing encryption call", async () => { await callback("refunds", "submit", dependencies)({ ctx: { user: employee }, input: { bookingId: 100, refundType: "supplier", refundReason: "Synthetic", suppliers: [], clientBankName: "Synthetic Bank" } }); expect(calls.find(call => call.name === "refund").input.clientBankName).toBe("encrypted:Synthetic Bank"); });
 it("adds reimbursement items to the actual business booking rather than the staff member", async () => { await callback("reimbursements", "addLate", dependencies)({ ctx: { user: employee }, input: { bookingId: 100, items: [{ supplierName: "Synthetic Supplier", amount: 25 }] } }); expect(calls.find(call => call.name === "reimbursements").input[0]).toMatchObject({ bookingId: 100, agentId: 10, supplierName: "Synthetic Supplier" }); expect(calls.find(call => call.name === "note").input.authorId).toBe(20); });
 it.each(["amendments", "cancellations", "refunds"])("does not persist %s or notify if authority is withdrawn", async namespace => { allowed = false; await expect(callback(namespace, "submit", dependencies)({ ctx: { user: employee }, input: { bookingId: 100, details: "Synthetic", refundReason: "Synthetic", suppliers: [] } })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls).toEqual([]); expect(dependencies.createInAppNotification).not.toHaveBeenCalled(); expect(dependencies.sendDirectEmail).not.toHaveBeenCalled(); });
 it("does not notify if an actual dependent request/audit write fails", async () => { dependencies.createNote.mockRejectedValueOnce(new Error("Synthetic rollback")); await expect(callback("amendments", "submit", dependencies)({ ctx: { user: employee }, input: { bookingId: 100, details: "Synthetic" } })).rejects.toThrow("rollback"); expect(committed).toBe(false); expect(dependencies.createInAppNotification).not.toHaveBeenCalled(); });
});
describe("actual normal business-staff support message callback", () => {
 it("uses the shared support channel and actual employee author", async () => { await callback("notes", "add", dependencies)({ ctx: { user: employee }, input: { bookingId: 100, content: "Synthetic support question", isInternal: false } }); expect(calls.find(call => call.name === "note").input).toMatchObject({ bookingId: 100, authorId: 20, content: "Synthetic support question", isInternal: false }); expect(dependencies.sendDirectEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "support@thejltgroup.co.uk", subject: expect.stringContaining("Synthetic Employee") })); });
 it("rejects staff internal/admin notes and does not write or notify", async () => { await expect(callback("notes", "add", dependencies)({ ctx: { user: employee }, input: { bookingId: 100, content: "Synthetic", isInternal: true } })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(calls).toEqual([]); expect(dependencies.sendDirectEmail).not.toHaveBeenCalled(); });
});
