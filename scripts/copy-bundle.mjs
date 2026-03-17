import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
} from 'fs';
import { join } from 'path';

const tauriTarget = join('packages', 'ui', 'src-tauri', 'target', 'release');
const bundleDir = join(tauriTarget, 'bundle');
const distDir = 'dist';

mkdirSync(distDir, { recursive: true });

const extensions = ['.app', '.dmg', '.msi', '.exe', '.deb', '.AppImage', '.rpm'];
let found = 0;

function copyArtifacts(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.endsWith('.app')) {
                console.log(`  ${entry.name}`);
                cpSync(full, join(distDir, entry.name), { recursive: true });
                found++;
            } else {
                copyArtifacts(full);
            }
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            console.log(`  ${entry.name}`);
            cpSync(full, join(distDir, entry.name));
            found++;
        }
    }
}

console.log('Copying bundle artifacts to dist/');

if (existsSync(bundleDir)) {
    copyArtifacts(bundleDir);
}

// Fallback: copy raw binary if no bundle artifacts found
if (found === 0) {
    const binaryName = 'bulgarian-tax-declaration';
    const binaryPath = join(tauriTarget, binaryName);
    if (existsSync(binaryPath)) {
        console.log(`  ${binaryName} (raw binary)`);
        cpSync(binaryPath, join(distDir, binaryName));
        found++;
    }
}

if (found === 0) {
    console.error('No build artifacts found!');
    process.exit(1);
}

console.log(`Done. ${found} artifact(s) copied to dist/`);
