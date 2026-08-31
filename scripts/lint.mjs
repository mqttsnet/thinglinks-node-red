#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const roots = ['packages', 'scripts', 'test'];

function javascriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(entryPath));
    else if (/\.(?:c?js|mjs)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

const files = roots.flatMap((directory) => javascriptFiles(path.resolve(directory))).sort();
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
process.stdout.write(`✓ syntax checked ${files.length} JavaScript files\n`);
