/**
 * Tool Groups for Hydraspecter MCP
 *
 * Allows dynamic loading of tool subsets via --groups= argument.
 * Default: core only (~8k tokens instead of ~31k)
 *
 * Usage in .mcp.json:
 *   { "args": ["dist/index.js", "--groups=core,protection,batch"] }
 */

export const TOOL_GROUPS = {
  // Core tools - always recommended, covers 90% of use cases
  core: [
    'browser_create',
    'browser_navigate',
    'browser_click',
    'browser_type',
    'browser_fill',
    'browser_snapshot',
    'browser_evaluate',
    'browser_close_instance',
    'browser_list_instances',
    'browser_close_all_instances'
  ],

  // Navigation - back, forward, refresh
  navigation: [
    'browser_go_back',
    'browser_go_forward',
    'browser_refresh'
  ],

  // Scrolling with humanization
  scroll: [
    'browser_scroll'
  ],

  // Anti-detection / protection levels
  protection: [
    'browser_get_protection_level',
    'browser_set_protection_level',
    'browser_reset_protection',
    'browser_list_domains'
  ],

  // Session & profile management
  sessions: [
    'browser_save_session',
    'browser_list_profiles',
    'browser_release_profile'
  ],

  // Console & network debugging
  debugging: [
    'browser_enable_console_capture',
    'browser_get_console_logs',
    'browser_enable_network_monitoring',
    'browser_get_network_logs'
  ],

  // Screenshots & PDF export
  export: [
    'browser_screenshot',
    'browser_generate_pdf'
  ],

  // File downloads
  downloads: [
    'browser_wait_for_download',
    'browser_get_downloads'
  ],

  // Batch execution
  batch: [
    'browser_batch_execute'
  ],

  // Device emulation & isolated instances
  devices: [
    'browser_list_devices',
    'browser_create'
  ],

  // Element inspection
  elements: [
    'browser_get_element_text',
    'browser_get_element_attribute',
    'browser_wait_for_element',
    'browser_wait_for_navigation',
    'browser_select_option'
  ],

  // Content extraction (markdown, full page)
  content: [
    'browser_get_markdown',
    'browser_get_page_info'
  ]
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

// All group names for validation
export const ALL_GROUPS = Object.keys(TOOL_GROUPS) as ToolGroup[];

// Special 'all' keyword expands to all groups
export function resolveGroups(groupNames: string[]): string[] {
  if (groupNames.includes('all')) {
    return Object.values(TOOL_GROUPS).flat();
  }

  const tools: string[] = [];
  for (const name of groupNames) {
    const group = TOOL_GROUPS[name as ToolGroup];
    if (group) {
      tools.push(...group);
    } else {
      console.warn(`[ToolGroups] Unknown group: ${name}`);
    }
  }

  // Deduplicate
  return [...new Set(tools)];
}

// Parse --groups=core,protection,batch from args
export function parseGroupsArg(args: string[]): string[] {
  const groupsArg = args.find(a => a.startsWith('--groups='));
  if (!groupsArg) {
    return resolveGroups(['core']); // Default: core group only
  }

  const parts = groupsArg.split('=');
  const groupNames = (parts[1] || 'core').split(',').map(s => s.trim());
  return resolveGroups(groupNames);
}
