const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const configPath = path.join(__dirname, '../config/node.json');

// Parse arguments
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 ? args[index + 1] : null;
};

const panelUrl = getArg('panel');
const panelKey = getArg('key');
const nodeName = getArg('name');
const location = getArg('location');

if (!panelUrl || !panelKey) {
  console.error('❌ Usage: npm run configure -- --panel "URL" --key "KEY" [--name "NAME"] [--location "LOC"]');
  console.error('');
  console.error('Example:');
  console.error('  npm run configure -- --panel "http://localhost:3000" --key "577861ca-49c7-4bc0-8df0-f5059822cf13"');
  process.exit(1);
}

// Load or create config
let config = {};

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.warn('⚠️  Could not read existing config, creating new one');
  }
}

// Generate node ID if not exists
if (!config.nodeId) {
  config.nodeId = require('crypto').randomUUID();
}

if (!config.nodeKey) {
  config.nodeKey = require('crypto').randomBytes(32).toString('hex');
}

// Update config
config.panelUrl = panelUrl;
config.panelKey = panelKey;
config.nodeName = nodeName || config.nodeName || `codesandbox-${Date.now()}`;
config.location = location || config.location || 'CodeSandbox';
config.port = 8080;
config.configured = true;
config.configuredAt = new Date().toISOString();

// Ensure config directory exists
const configDir = path.dirname(configPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Save config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log('✅ Configuration saved successfully!');
console.log('');
console.log('📡 Panel URL:', config.panelUrl);
console.log('🏷️  Node Name:', config.nodeName);
console.log('📍 Location:', config.location);
console.log('🆔 Node ID:', config.nodeId);
console.log('🔐 Node Key:', config.nodeKey);
console.log('');
console.log('🚀 Start the daemon:');
console.log('   npm start');
console.log('');
console.log('📋 Add this node to your panel:');
console.log('   - Node ID:', config.nodeId);
console.log('   - Node Key:', config.nodeKey);
console.log('   - Host: your-codesandbox-url.csb.app');
console.log('   - Port: 8080');
