/**
 * Meta-Tool for Hydraspecter MCP
 *
 * Exposes a single intelligent tool that routes to 37 internal implementations.
 * Reduces context from ~31k tokens to ~2k tokens.
 *
 * Usage: { action: "navigate", target: "https://...", options: {...} }
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BrowserTools } from './tools.js';

// Action mappings: short action name → internal tool name
const ACTION_MAP: Record<string, string> = {
  // Session management
  'create': 'browser_create',
  'close': 'browser_close_instance',
  'close_all': 'browser_close_all_instances',
  'list': 'browser_list_instances',
  'save_session': 'browser_save_session',

  // Navigation
  'navigate': 'browser_navigate',
  'goto': 'browser_navigate',
  'back': 'browser_go_back',
  'forward': 'browser_go_forward',
  'refresh': 'browser_refresh',
  'reload': 'browser_refresh',

  // Interaction
  'click': 'browser_click',
  'type': 'browser_type',
  'fill': 'browser_fill',
  'select': 'browser_select_option',
  'scroll': 'browser_scroll',

  // Content extraction
  'snapshot': 'browser_snapshot',
  'screenshot': 'browser_screenshot',
  'markdown': 'browser_get_markdown',
  'text': 'browser_get_element_text',
  'attribute': 'browser_get_element_attribute',
  'info': 'browser_get_page_info',
  'pdf': 'browser_generate_pdf',

  // Waiting
  'wait_element': 'browser_wait_for_element',
  'wait_navigation': 'browser_wait_for_navigation',
  'wait_download': 'browser_wait_for_download',
  'wait_request': 'browser_wait_for_request',

  // Advanced
  'evaluate': 'browser_evaluate',
  'eval': 'browser_evaluate',
  'batch': 'browser_batch_execute',

  // Protection & profiles
  'protection': 'browser_get_protection_level',
  'set_protection': 'browser_set_protection_level',
  'reset_protection': 'browser_reset_protection',
  'domains': 'browser_list_domains',
  'profiles': 'browser_list_profiles',
  'release_profile': 'browser_release_profile',
  'switch_auth': 'browser_switch_auth_profile',
  'use_auth': 'browser_switch_auth_profile',
  'devices': 'browser_list_devices',

  // Debugging
  'console': 'browser_get_console_logs',
  'enable_console': 'browser_enable_console_capture',
  'network': 'browser_get_network_logs',
  'enable_network': 'browser_enable_network_monitoring',
  'downloads': 'browser_get_downloads',

  // API Bookmarks (LLM memory for endpoints)
  'save_endpoint': 'browser_save_endpoint',
  'bookmark': 'browser_save_endpoint',
  'list_endpoints': 'browser_list_endpoints',
  'bookmarks': 'browser_list_endpoints',
  'get_endpoint': 'browser_get_endpoint',
  'delete_endpoint': 'browser_delete_endpoint',
  'capture_endpoint': 'browser_capture_from_network',
  'capture': 'browser_capture_from_network',
};

// Actions grouped by category for help (used in tool description)
// Session: create, close, list, save_session
// Navigate: navigate, back, forward, refresh
// Interact: click, type, fill, select, scroll
// Extract: snapshot, screenshot, markdown, text, pdf
// Wait: wait_element, wait_navigation
// Advanced: evaluate, batch, protection

export class MetaTool {
  private browserTools: BrowserTools;

  constructor(browserTools: BrowserTools) {
    this.browserTools = browserTools;
  }

  /**
   * Returns a single meta-tool definition (~2k tokens vs ~31k for all tools)
   */
  getTools(): Tool[] {
    return [{
      name: 'browser',
      description: `Unified browser automation tool. One tool for all browser actions.

**Quick Start:**
1. browser { action: "create" } → Returns pageId
2. browser { action: "navigate", pageId: "...", target: "https://example.com" }
3. browser { action: "click", pageId: "...", target: "button.submit" }
4. browser { action: "snapshot", pageId: "..." } → Get page content

**Actions by Category:**
• Session: create, close, list, save_session, switch_auth
• Navigate: navigate/goto, back, forward, refresh
• Interact: click, type, fill, select, scroll
• Extract: snapshot, screenshot, markdown, text, pdf
• Wait: wait_element, wait_navigation, wait_request
• Debug: enable_network, network, enable_console, console
• Endpoints: capture, list_endpoints, save_endpoint, get_endpoint
• Advanced: evaluate, batch, protection

**Auth-Required Sites:**
Use { action: "switch_auth" } before accessing Notion, Gmail, Google Calendar, Slack, etc.
This switches to pool-0 which has your Chrome sessions synced.

**Common Parameters:**
• action (required): What to do
• pageId/instanceId: Browser page identifier (from create)
• target: URL or CSS selector (depends on action)
• options: Action-specific options (timeout, humanize, etc.)

**Examples:**
• Create page: { action: "create" }
• Navigate: { action: "navigate", pageId: "abc", target: "https://google.com" }
• Click: { action: "click", pageId: "abc", target: "#login-btn" }
• Type: { action: "type", pageId: "abc", target: "#email", text: "user@example.com" }
• Snapshot: { action: "snapshot", pageId: "abc" }
• Screenshot: { action: "screenshot", pageId: "abc", options: { fullPage: true } }
• Scroll: { action: "scroll", pageId: "abc", options: { direction: "down" } }
• Close: { action: "close", pageId: "abc" }

**Network Capture (important options):**
• Enable: { action: "enable_network", pageId: "abc" }
• Get logs: { action: "network", pageId: "abc", options: { urlPattern: "api/save", limit: 10 } }
• Wait for request: { action: "wait_request", pageId: "abc", options: { urlPattern: "saveTransaction", timeout: 5000 } }
• Capture endpoint: { action: "capture", pageId: "abc", options: { urlPattern: "api/cart" } }`,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action to perform: create, navigate, click, type, fill, snapshot, screenshot, scroll, close, etc.',
          },
          pageId: {
            type: 'string',
            description: 'Page/instance ID from create action. Alias: instanceId',
          },
          instanceId: {
            type: 'string',
            description: 'Alias for pageId (for compatibility)',
          },
          target: {
            type: 'string',
            description: 'URL (for navigate) or CSS selector (for click/type/fill)',
          },
          text: {
            type: 'string',
            description: 'Text to type (for type/fill actions)',
          },
          options: {
            type: 'object',
            description: 'Action-specific options (timeout, humanize, fullPage, etc.)',
            additionalProperties: true,
          },
        },
        required: ['action'],
      },
    }];
  }

  /**
   * Route meta-tool calls to internal implementations
   */
  async executeTools(name: string, args: any): Promise<CallToolResult> {
    if (name !== 'browser') {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}. Use "browser" with an action.` }],
        isError: true,
      };
    }

    const { action, pageId, instanceId, target, text, options = {} } = args;

    if (!action) {
      return {
        content: [{ type: 'text', text: 'Missing required parameter: action' }],
        isError: true,
      };
    }

    // Map action to internal tool name
    const internalTool = ACTION_MAP[action.toLowerCase()];
    if (!internalTool) {
      const availableActions = Object.keys(ACTION_MAP).join(', ');
      return {
        content: [{ type: 'text', text: `Unknown action: "${action}". Available: ${availableActions}` }],
        isError: true,
      };
    }

    // Build arguments for internal tool
    const internalArgs = this.buildInternalArgs(internalTool, {
      pageId: pageId || instanceId,
      target,
      text,
      options,
    });

    // Execute internal tool
    return await this.browserTools.executeTools(internalTool, internalArgs);
  }

  /**
   * Transform meta-tool args to internal tool args format
   */
  private buildInternalArgs(toolName: string, args: {
    pageId?: string;
    target?: string;
    text?: string;
    options?: Record<string, any>;
  }): Record<string, any> {
    const { pageId, target, text, options = {} } = args;
    const result: Record<string, any> = { ...options };

    // Add instanceId if present
    if (pageId) {
      result['instanceId'] = pageId;
    }

    // Map target based on tool type
    switch (toolName) {
      case 'browser_navigate':
        if (target) result['url'] = target;
        break;

      case 'browser_click':
      case 'browser_type':
      case 'browser_fill':
      case 'browser_select_option':
      case 'browser_get_element_text':
      case 'browser_get_element_attribute':
      case 'browser_wait_for_element':
        if (target) result['selector'] = target;
        if (text) result['text'] = text;
        break;

      case 'browser_create':
        if (target) result['url'] = target;
        break;

      case 'browser_evaluate':
        if (target) result['script'] = target;
        if (text) result['script'] = text;
        break;

      case 'browser_set_protection_level':
        if (target) result['domain'] = target;
        break;

      case 'browser_screenshot':
      case 'browser_generate_pdf':
        if (target) result['filePath'] = target;
        break;

      default:
        // For other tools, pass target as-is if it makes sense
        if (target && !result['url'] && !result['selector']) {
          result['target'] = target;
        }
    }

    return result;
  }
}
