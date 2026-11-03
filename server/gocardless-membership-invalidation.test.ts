import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../client/src/pages/crm/AgentCrm.tsx", import.meta.url),
  "utf8"
);
const parsed = ts.createSourceFile(
  "AgentCrm.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

const cases = [
  { component: "DirectDebitTabForAgent", name: "createSubMutation", route: "trpc.gocardless.adminCreateSubscription", dd: true, schedule: false, mandates: true, related: true },
  { component: "DirectDebitTabForAgent", name: "refreshMutation", route: "trpc.gocardless.adminRefreshMandateStatus", dd: true, schedule: false, mandates: false, related: true },
  { component: "DirectDebitTabForAgent", name: "requestReplacementMutation", route: "trpc.gocardless.adminRequestMandateReplacement", dd: true, schedule: false, mandates: false, related: true },
  { component: "DirectDebitTabForAgent", name: "linkReplacementMutation", route: "trpc.gocardless.adminLinkReplacementMandate", dd: true, schedule: false, mandates: true, related: true },
  { component: "DirectDebitTabForAgent", name: "linkByEmailMutation", route: "trpc.gocardless.linkByEmail", dd: true, schedule: true, mandates: true, related: true },
  { component: "DirectDebitTabForAgent", name: "updateProfileMutation", route: "trpc.crm.agentCrm.updateProfile", dd: false, schedule: false, mandates: false, related: false },
  { component: "SyncGcButton", name: "syncMutation", route: "trpc.gocardless.syncSubscriptions", dd: false, schedule: false, mandates: false, related: false },
  { component: "AdminOnboardingChecklistTab", name: "createSub", route: "trpc.gocardless.adminCreateSubscription", dd: true, schedule: false, mandates: false, related: false },
] as const;
type MutationCase = typeof cases[number];

function componentNode(name: string) {
  const component = parsed.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  if (!component?.body) throw new Error(`Missing component ${name}`);
  return component;
}

function mutationOptions(testCase: MutationCase) {
  const declaration = componentNode(testCase.component).body!.statements
    .filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(node => ts.isIdentifier(node.name) && node.name.text === testCase.name);
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer))
    throw new Error(`Missing mutation ${testCase.name}`);
  const call = declaration.initializer;
  expect(call.expression.getText(parsed)).toBe(`${testCase.route}.useMutation`);
  expect(call.arguments).toHaveLength(1);
  const options = call.arguments[0];
  if (!ts.isObjectLiteralExpression(options))
    throw new Error(`Missing literal options for ${testCase.name}`);
  // Invalidation must be success-only, not onMutate/onSettled or an error handler.
  expect(options.properties.every(property =>
    ts.isPropertyAssignment(property) &&
    ["onSuccess", "onError"].includes(property.name.getText(parsed))
  )).toBe(true);
  return options;
}

function callNodes(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) calls.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

function loadCallbacks(testCase: MutationCase, userId = 42) {
  const membership = vi.fn().mockResolvedValue(undefined);
  const overview = vi.fn().mockResolvedValue(undefined);
  const issues = vi.fn().mockResolvedValue(undefined);
  const mandates = vi.fn().mockResolvedValue(undefined);
  const dd = vi.fn();
  const schedule = vi.fn();
  const onSynced = vi.fn();
  const handleToggle = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn() };
  const setters = Object.fromEntries([
    "setShowCreateSub", "setShowReplaceMandate", "setReplacementConfirmed",
    "setReplacementMandateId", "setGcOverrideEmail", "setShowGcEmailOverride",
    "setShowSubForm",
  ].map(name => [name, vi.fn()]));
  const symbols = {
    userId,
    utils: {
      membershipPayments: { invalidate: membership },
      crm: { agentCrm: { getOverview: { invalidate: overview } } },
      gocardless: {
        adminGetCurrentPaymentIssues: { invalidate: issues },
        adminListMandates: { invalidate: mandates },
      },
    },
    toast,
    refetchDdStatus: dd,
    refetchDd: dd,
    refetchPaymentSchedule: schedule,
    onSynced,
    handleToggle,
    ...setters,
  };
  // Execute the actual source options/callbacks, selected via the TS AST. Do not
  // import the page, server router, database, provider, or mutation implementations.
  const compiled = ts.transpileModule(
    `const options = ${mutationOptions(testCase).getText(parsed)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const options = new Function(
    ...Object.keys(symbols),
    `${compiled}\nreturn options;`
  )(...Object.values(symbols)) as {
    onSuccess: (data: typeof successData) => unknown;
    onError?: (error: Error) => unknown;
  };
  return { options, membership, overview, issues, mandates, dd, schedule, onSynced, handleToggle, toast, setters };
}

const successData = {
  status: "active",
  message: "Linked existing subscription",
  activeSubscriptions: 4,
  subscriptionsCreated: 1,
  subscriptionsUpdated: 2,
  mandatesUpdated: 3,
};

const existingSuccessCalls: Record<MutationCase["name"], string[]> = {
  createSubMutation: ["setShowCreateSub", "refetchDdStatus", "utils.gocardless.adminListMandates.invalidate"],
  refreshMutation: ["refetchDdStatus", "toast.success"],
  requestReplacementMutation: ["toast.success", "setShowReplaceMandate", "setReplacementConfirmed", "refetchDdStatus"],
  linkReplacementMutation: ["toast.success", "setShowReplaceMandate", "setReplacementMandateId", "setReplacementConfirmed", "refetchDdStatus", "utils.gocardless.adminListMandates.invalidate"],
  linkByEmailMutation: ["toast.success", "setGcOverrideEmail", "setShowGcEmailOverride", "refetchDdStatus", "refetchPaymentSchedule", "utils.gocardless.adminListMandates.invalidate"],
  updateProfileMutation: ["toast.success"],
  syncMutation: ["toast.success", "onSynced"],
  createSub: ["toast.success", "refetchDd", "handleToggle", "setShowSubForm"],
};

// These are the existing UI mutation payloads, not new API calls. Lock them down
// separately from callback cache effects so a cache refresh cannot trigger payment
// creation/replacement/sync, and the action route/input stays unchanged.
const existingPayloads: Record<MutationCase["name"], string[]> = {
  createSubMutation: ["{ userId, dayOfMonth: createSubDay, mandateId: mandate ? undefined : (manualMandateId || undefined) }"],
  refreshMutation: ["{ userId }"],
  requestReplacementMutation: ["{ userId, preferredPaymentDay: replacementPaymentDay }"],
  linkReplacementMutation: ["{ userId, mandateId: replacementMandateId.trim(), preferredPaymentDay: replacementPaymentDay }"],
  linkByEmailMutation: ["{ userId, overrideEmail: gcOverrideEmail.trim() || undefined }"],
  updateProfileMutation: ["{ userId, paymentExempt: exempt, paymentExemptReason: reason || null }"],
  syncMutation: [],
  createSub: ["{ userId, dayOfMonth: parseInt(subPaymentDay) }"],
};

const compact = (text: string) => text.replace(/\s+/g, "").replace(/;$/, "");

describe("GoCardless CRM membership cache invalidation (offline callbacks)", () => {
  it.each(cases)("$component: $name invalidates all membership queries only after success", async testCase => {
    const harness = loadCallbacks(testCase);
    expect(harness.membership).not.toHaveBeenCalled();
    expect(harness.overview).not.toHaveBeenCalled();
    expect(harness.issues).not.toHaveBeenCalled();

    await harness.options.onSuccess(successData);
    expect(harness.membership.mock.calls).toEqual([[]]);
    if (testCase.related) {
      expect(harness.overview.mock.calls).toEqual([[{ userId: 42 }]]);
      expect(harness.issues.mock.calls).toEqual([[]]);
    } else {
      expect(harness.overview).not.toHaveBeenCalled();
      expect(harness.issues).not.toHaveBeenCalled();
    }
    expect(harness.dd).toHaveBeenCalledTimes(testCase.dd ? 1 : 0);
    expect(harness.schedule).toHaveBeenCalledTimes(testCase.schedule ? 1 : 0);
    expect(harness.mandates).toHaveBeenCalledTimes(testCase.mandates ? 1 : 0);
    if (testCase.name === "syncMutation") expect(harness.onSynced.mock.calls).toEqual([[]]);
    if (testCase.name === "createSub")
      expect(harness.handleToggle.mock.calls).toEqual([["ddSubscriptionCreated", true]]);
  });

  it.each(cases)("$component: $name does not invalidate or refresh on error", async testCase => {
    const harness = loadCallbacks(testCase);
    const error = new Error("Offline failure");
    await harness.options.onError?.(error);
    for (const mock of [harness.membership, harness.overview, harness.issues, harness.mandates,
      harness.dd, harness.schedule, harness.onSynced, harness.handleToggle, ...Object.values(harness.setters)])
      expect(mock).not.toHaveBeenCalled();
    expect(harness.toast.success).not.toHaveBeenCalled();
    if (harness.options.onError) expect(harness.toast.error).toHaveBeenCalledOnce();
  });

  it.each(cases.filter(testCase => testCase.related))(
    "$name scopes overview invalidation to the selected agent",
    async testCase => {
      const harness = loadCallbacks(testCase, 77);
      await harness.options.onSuccess(successData);
      expect(harness.overview.mock.calls).toEqual([[{ userId: 77 }]]);
      expect(harness.membership.mock.calls).toEqual([[]]);
    }
  );

  it.each(cases)("$component: $name preserves its route, payload, and local success actions", testCase => {
    const options = mutationOptions(testCase);
    const success = options.properties.find(property =>
      ts.isPropertyAssignment(property) && property.name.getText(parsed) === "onSuccess"
    ) as ts.PropertyAssignment;
    const expectedCalls = [
      ...existingSuccessCalls[testCase.name],
      "utils.membershipPayments.invalidate",
      ...(testCase.related ? [
        "utils.crm.agentCrm.getOverview.invalidate",
        "utils.gocardless.adminGetCurrentPaymentIssues.invalidate",
      ] : []),
    ];
    expect(callNodes(success.initializer).map(call => call.expression.getText(parsed)))
      .toEqual(expectedCalls);

    const actionCalls = callNodes(componentNode(testCase.component)).filter(call =>
      call.expression.getText(parsed) === `${testCase.name}.mutate`
    );
    expect(actionCalls).toHaveLength(1);
    expect(actionCalls[0].arguments.map(argument => compact(argument.getText(parsed))))
      .toEqual(existingPayloads[testCase.name].map(compact));
  });

  it("keeps read refreshes separate from mutation execution", () => {
    for (const component of ["DirectDebitTabForAgent", "SyncGcButton", "AdminOnboardingChecklistTab"]) {
      const calls = callNodes(componentNode(component));
      for (const call of calls.filter(node => /^(?:refetchDdStatus|refetchDd|refetchPaymentSchedule)$/.test(node.expression.getText(parsed))))
        expect(call.arguments).toHaveLength(0);
      const nestedMutationCalls = calls.filter(node =>
        /\.(?:refetch|invalidate)$/.test(node.expression.getText(parsed)) &&
        callNodes(node).some(child => /\.(?:mutate|mutateAsync)$/.test(child.expression.getText(parsed)))
      );
      expect(nestedMutationCalls).toEqual([]);
    }
  });
});
