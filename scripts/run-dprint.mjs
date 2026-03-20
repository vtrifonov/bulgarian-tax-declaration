import { spawnSync } from 'node:child_process';
import {
    join,
    resolve,
} from 'node:path';
import {
    cpSync,
    existsSync,
    mkdirSync,
} from 'node:fs';
import { platform } from 'node:os';
import process from 'node:process';
import { argv } from 'node:process';

const cacheDir = resolve('.dprint-cache');

function getGlobalCacheCandidates() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return [];

    return [
        join(home, 'Library', 'Caches', 'dprint', 'cache'),
        join(home, '.cache', 'dprint', 'cache'),
    ].filter(Boolean);
}

function ensureDprintCache() {
    if (existsSync(cacheDir)) {
        return;
    }

    for (const candidate of getGlobalCacheCandidates()) {
        if (existsSync(candidate)) {
            try {
                cpSync(candidate, cacheDir, { recursive: true });
            } catch {
                continue;
            }
            return;
        }
    }

    mkdirSync(cacheDir, { recursive: true });
}

ensureDprintCache();

const command = platform() === 'win32' ? 'dprint.exe' : 'dprint';
const args = argv.slice(2);

if (!args.length) {
    console.error('Usage: node scripts/run-dprint.mjs <fmt|check>');
    process.exitCode = 1;
    process.exit(process.exitCode);
}

const [commandArg] = args;
if (commandArg !== 'fmt' && commandArg !== 'check') {
    console.error('Usage: node scripts/run-dprint.mjs <fmt|check>');
    process.exit(1);
}

const result = spawnSync(command, args, {
    env: { ...process.env, DPRINT_CACHE_DIR: cacheDir },
    stdio: 'inherit',
});

process.exit(result.status ?? 1);
