#!/usr/bin/env node
// On the hub: add a render computer and print the three lines for its ~/.practireel-node.env (the key is shown once).
// Usage: npm run build && node scripts/add-render-computer.mjs "MacBook" [https://editor.srshti.co.in]
// (Same as owner console → Computers → Add a computer.)
import { addNode } from '../dist-server/nodes.js';
const name = process.argv[2]; const hub = process.argv[3] || process.env.PRACTIREEL_PUBLIC_URL || 'https://editor.srshti.co.in';
if (!name) { console.error('Usage: node scripts/add-render-computer.mjs "<name>" [hub url]'); process.exit(1); }
const { token } = await addNode(name);
console.log(`PRACTIREEL_HUB_URL=${hub}\nPRACTIREEL_NODE_TOKEN=${token}\nPRACTIREEL_NODE_NAME=${name}`);
