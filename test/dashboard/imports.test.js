/**
 * Checks that no dashboard JS file uses absolute import paths (e.g. '/utils.js').
 * Absolute paths work in the browser but fail when files are imported directly
 * in Node.js tests, where '/' resolves to the filesystem root.
 */

import fs from 'fs';
import path from 'path';

const DASHBOARD_DIR = path.resolve('./dashboard');

function getDashboardJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getDashboardJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function testNoAbsoluteImports() {
  const files = getDashboardJsFiles(DASHBOARD_DIR);
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*import\s+.*from\s+'\//.test(line) || /^\s*import\s+.*from\s+"\//.test(line)) {
        violations.push(`${path.relative(DASHBOARD_DIR, file)}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Absolute import paths found in dashboard JS (use relative paths instead):\n` +
      violations.map(v => `  ${v}`).join('\n')
    );
  }

  console.log(`✓ testNoAbsoluteImports: all imports use relative paths (${files.length} files checked)`);
}

console.log('Running import path tests...\n');

try {
  testNoAbsoluteImports();
  console.log('\n✅ All import tests passed');
} catch (err) {
  console.error(`\n❌ Test failed: ${err.message}`);
  process.exit(1);
}
