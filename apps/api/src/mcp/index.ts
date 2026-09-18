import type { McpTool } from './tool.js';
import { readTools } from './tools/reads.js';
import { writeTools } from './tools/writes.js';

/**
 * `apps/api/mcp` — the MCP surface, assembled.
 *
 * **This list is the tool surface.** The dispatcher answers exactly this, the
 * manifest describes exactly this, and `tools.contract.test.ts` walks it and
 * refuses a tool whose scope is missing, unknown, or a read scope on something
 * that writes. It is `routes/index.ts` for the other front door, deliberately.
 *
 * Seventeen tools: eight that read and nine that write, every one of the second
 * kind a dry run until a confirmation bound to its diff comes back
 * (docs/14-threat-model.md §4).
 */

export const mcpTools: readonly McpTool[] = [...readTools, ...writeTools];

export { MCP_PATH, mountMcp } from './mount.js';
export type { McpMountOptions } from './mount.js';
export { createMcpServer, SERVER_INFO, INSTRUCTIONS, PROTOCOL_SCOPE } from './server.js';
export type { McpServer, McpServerOptions, CallContext, Requirement } from './server.js';
export { toolManifest } from './manifest.js';
export type { ToolDescriptor } from './manifest.js';
export { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './protocol.js';
export type { McpTool } from './tool.js';
