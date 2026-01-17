#!/usr/bin/env node
/**
 * MCP Handshake Test - Non-regression test for HydraSpecter
 *
 * Tests:
 * 1. Server starts without errors
 * 2. Responds to JSON-RPC initialize
 * 3. Returns valid tool list
 * 4. No stdout pollution
 */

const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'dist', 'index.js');

console.log('🧪 MCP Handshake Test\n');

const child = spawn('node', [serverPath, '--meta'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: path.join(__dirname, '..')
});

const results = {
  serverStarted: false,
  initResponse: false,
  toolsResponse: false,
  pollution: []
};

let stdoutBuffer = '';
child.stdout.on('data', (data) => {
  stdoutBuffer += data.toString();

  // Parse complete JSON lines
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.jsonrpc === '2.0') {
        if (parsed.id === 1 && parsed.result?.protocolVersion) {
          results.initResponse = true;
          console.log('✅ Init response received');
        }
        if (parsed.id === 2 && parsed.result?.tools) {
          results.toolsResponse = true;
          console.log(`✅ Tools response received (${parsed.result.tools.length} tools)`);
        }
      }
    } catch {
      if (line.trim()) {
        results.pollution.push(line.substring(0, 50));
      }
    }
  }
});

child.stderr.on('data', (data) => {
  if (data.toString().includes('started')) {
    results.serverStarted = true;
    console.log('✅ Server started');
  }
});

// Wait for server to start, then send all messages at once
setTimeout(() => {
  console.log('→ Sending MCP handshake...');

  const init = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' }
    }
  });

  const notif = JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  });

  const tools = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });

  // Send all at once - this works reliably
  child.stdin.write(init + '\n' + notif + '\n' + tools + '\n');
}, 2500);

// Final report
setTimeout(() => {
  child.kill();

  console.log('\n📊 Results:');
  console.log(`  Server started: ${results.serverStarted ? '✅' : '❌'}`);
  console.log(`  Init response: ${results.initResponse ? '✅' : '❌'}`);
  console.log(`  Tools response: ${results.toolsResponse ? '✅' : '❌'}`);
  console.log(`  No pollution: ${results.pollution.length === 0 ? '✅' : '❌ ' + results.pollution.length + ' lines'}`);

  const passed = results.serverStarted && results.initResponse && results.toolsResponse && results.pollution.length === 0;
  console.log(`\n${passed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  process.exit(passed ? 0 : 1);
}, 6000);
