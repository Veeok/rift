import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Bridge, BridgeError } from "./bridge.js";
import { toolResult, boundedToolResult } from "./tool-result.js";

const rootRef = z.object({
  id: z.string().min(3).max(64).optional(),
  path: z.array(z.string().min(1).max(200)).min(1).max(64).optional(),
});
const ref = rootRef.refine(value => value.id !== undefined || value.path !== undefined, "reference requires id or path");

const properties = {
  properties: z.array(z.string().min(1).max(100)).max(32).optional(),
  maxProperties: z.number().int().min(1).max(32).default(8),
  maxResponseChars: z.number().int().min(2048).max(100000).default(40000),
  maxStringLength: z.number().int().min(16).max(4000).default(500),
  maxTableDepth: z.number().int().min(0).max(4).default(0),
};

export const SEARCH_PROPERTY_ALLOWLIST = ["Name", "ClassName", "Text", "Visible", "Enabled", "Value", "Transparency", "Anchored", "CanCollide", "Volume"] as const;
const scalar = z.union([z.string().max(1000), z.boolean(), z.number().finite()]);
const predicate = z.discriminatedUnion("op", [
  z.object({ name: z.string().min(1).max(100), op: z.enum(["eq", "ne"]), value: scalar }),
  z.object({ name: z.string().min(1).max(100), op: z.enum(["contains", "prefix"]), value: z.string().max(1000) }),
  z.object({ name: z.string().min(1).max(100), op: z.enum(["gt", "gte", "lt", "lte"]), value: z.number().finite() }),
  z.object({ name: z.string().min(1).max(100), op: z.literal("exists"), value: z.boolean() }),
]);
const propertyPredicate = predicate.refine(p => (SEARCH_PROPERTY_ALLOWLIST as readonly string[]).includes(p.name), "unsupported property filter");
const tagList = z.array(z.string().min(1).max(100)).max(32);

export const inspectionSchema = {
  get_subtree: {
    target: ref.optional(), ...properties,
    maxDepth: z.number().int().min(0).max(16).default(2),
    maxVisited: z.number().int().min(1).max(10000).default(1000),
    maxNodes: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).max(10000).default(0),
  },
  inspect_instances: {
    targets: z.array(ref).min(1).max(50), ...properties,
  },
  search_instances: {
    root: rootRef.optional(), name: z.string().min(1).max(200).optional(),
    nameMatch: z.enum(["contains", "exact", "prefix"]).default("contains"),
    caseSensitive: z.boolean().default(false), className: z.string().min(1).max(100).optional(),
    classMatch: z.enum(["isa", "exact"]).default("isa"),
    maxDepth: z.number().int().min(1).max(64).default(32),
    maxVisited: z.number().int().min(1).max(100000).default(20000),
    offset: z.number().int().min(0).max(10000).default(0),
    limit: z.number().int().min(1).max(200).default(50),
    maxResponseChars: z.number().int().min(2048).max(100000).default(40000),
    ancestor: ref.optional(),
    attributes: z.array(predicate).max(32).optional(),
    propertyFilters: z.array(propertyPredicate).max(32).optional().describe(`Scalar property allowlist: ${SEARCH_PROPERTY_ALLOWLIST.join(", ")}.`),
    tags: z.object({ all: tagList.optional(), any: tagList.optional(), none: tagList.optional() }).optional(),
    guiText: z.object({ value: z.string().min(1).max(1000), match: z.enum(["contains", "prefix", "exact"]).optional(), caseSensitive: z.boolean().optional() }).optional(),
    visible: z.boolean().optional().describe("Effective GUI Visible/Enabled flags; excludes occlusion and clickability."),
  },
} as const;

export function requireInspectionReader(bridge: Bridge): NonNullable<Bridge["reader"]> {
  const reader = bridge.reader;
  if (!reader) throw new BridgeError("reader_error", "No reader connected; connect a reader with inspection_v1.", true, "reader_unavailable");
  if (!reader.capabilities.includes("inspection_v1")) {
    throw new BridgeError("reader_error", "Reader lacks inspection_v1; reload the updated reader and reconnect.", false, "unsupported_reader");
  }
  return reader;
}

export function registerInspectionTools(server: McpServer, bridge: Bridge): void {
  const run = async (tool: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    try {
      const reader = requireInspectionReader(bridge);
      const data = await bridge.request(tool, args, { deadlineMs: 15000 });
      const current = bridge.reader;
      if (!current || current.session !== reader.session || current.connectionId !== reader.connectionId) {
        throw new BridgeError("reader_error", "Reader reconnected during inspection; retry with fresh references.", true, "stale_session");
      }
      const aliases = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : { result: data };
      const metadata = { ok: true, tool, session: { readerSession: reader.session, connectionId: reader.connectionId, placeId: reader.placeId, jobId: reader.jobId }, receivedAt: new Date().toISOString() };
      let payload: Record<string, unknown> = { ...metadata, ...aliases };
      const requested = typeof args.maxResponseChars === "number" ? args.maxResponseChars : 40000;
      const maxBytes = Math.min(requested, 120000);
      if (tool === "inspect_instances") {
        const omissions = payload.omissions as Record<string, unknown> | undefined;
        payload = { ...payload, offset: 0, omittedCount: typeof omissions?.items === "number" ? omissions.items : 0 };
      }
      for (;;) {
        const bounded = boundedToolResult(payload, maxBytes);
        if (tool !== "inspect_instances") return bounded;
        const data = bounded.structuredContent as Record<string, unknown>;
        const omissions = (data.omissions && typeof data.omissions === "object" ? data.omissions : {}) as Record<string, unknown>;
        const omitted = typeof data.omittedCount === "number" ? data.omittedCount : 0;
        if ((omissions.items ?? 0) === omitted) return bounded;
        payload = { ...data, metadata: undefined, omissions: { ...omissions, items: omitted } };
      }
    } catch (err) {
      const error = err instanceof BridgeError
        ? { code: (err.readerCode ?? err.code).replace(/[^\w-]/g, "_").slice(0, 40), message: err.message.slice(0, 80), retryable: err.retryable }
        : { code: "internal", message: (err instanceof Error ? err.message : String(err)).slice(0, 80), retryable: false };
      const metadata = { ok: false, tool, error };
      return toolResult(metadata, { isError: true });
    }
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  server.registerTool("get_subtree", {
    title: "Inspect subtree", description: "Bounded breadth-first re-observation of a subtree; pagination is not a snapshot.",
    inputSchema: inspectionSchema.get_subtree, annotations,
  }, args => run("get_subtree", args));
  server.registerTool("inspect_instances", {
    title: "Inspect instances", description: "Inspect up to 50 explicit references in one reader request; failures are per item.",
    inputSchema: inspectionSchema.inspect_instances, annotations,
  }, args => run("inspect_instances", args));
}
