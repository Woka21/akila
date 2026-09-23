#!/usr/bin/env node
/**
 * AKILA Test Runner
 * =================================
 * Runs every automated check in one command:
 *   1. Python regression suite (pytest, offline)
 *   2. JavaScript suite (node:test, offline)
 *   3. Release verification (static + build + live + corpus)
 *
 * Usage:
 *   node run-tests.js            # all of the above
 *   node run-tests.js python     # pytest only
 *   node run-tests.js js         # JS suite only
 *   node run-tests.js release    # verify_release --all only
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname);

// The pytest suite and the release verification both want :5001 to
// themselves, and a stale server from a previous run (or a crashed test)
// makes the live checks refuse to start. Kill whatever is on :5001 first so
// the suite is repeatable from a clean state.
function killStaleServer() {
    try {
        const pid = execSync(
            "lsof -ti :5001 -sTCP:LISTEN 2>/dev/null || true",
            { stdio: 'pipe', timeout: 10000 }
        ).toString().trim();
        if (pid) {
            console.log(`  (killing stale server on :5001: pid ${pid.split('\n').join(',')})`);
            execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'ignore' });
        }
    } catch (e) {
        // lsof not available or port free — fine either way
    }
}

function runPythonTests() {
    console.log('\n' + '='.repeat(60));
    console.log('Python Tests (server)');
    console.log('='.repeat(60) + '\n');

    const venvPython = path.join(ROOT, 'server', 'venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';

    const result = spawnSync(python, ['-m', 'pytest', 'test_api.py', '-q', '-p', 'no:cacheprovider'], {
        cwd: path.join(ROOT, 'server'),
        stdio: 'inherit',
    });

    // pytest leaves the Flask test client, not a real server, but any
    // backgrounded server from a prior run must be gone before LIVE checks.
    killStaleServer();

    return result.status === 0;
}

function runJsTests() {
    console.log('\n' + '='.repeat(60));
    console.log('JavaScript Tests (extension)');
    console.log('='.repeat(60) + '\n');

    const result = spawnSync('node', ['test_js.mjs'], {
        cwd: path.join(ROOT, 'extension'),
        stdio: 'inherit',
    });

    return result.status === 0;
}

function runReleaseVerification() {
    console.log('\n' + '='.repeat(60));
    console.log('Release Verification (static + build + live + corpus)');
    console.log('='.repeat(60) + '\n');

    killStaleServer();

    const venvPython = path.join(ROOT, 'server', 'venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';

    const result = spawnSync(python, ['packaging/verify_release.py', '--all'], {
        cwd: ROOT,
        stdio: 'inherit',
    });

    return result.status === 0;
}

function main() {
    const which = process.argv[2] || 'all';
    let pyOk = true;
    let jsOk = true;
    let relOk = true;

    if (which === 'python' || which === 'all') {
        pyOk = runPythonTests();
    }

    if (which === 'js' || which === 'all') {
        jsOk = runJsTests();
    }

    if (which === 'release' || which === 'all') {
        relOk = runReleaseVerification();
    }

    console.log('\n' + '='.repeat(60));
    console.log('Summary');
    console.log('='.repeat(60));
    if (which === 'all' || which === 'python') {
        console.log(`  Python:  ${pyOk ? 'PASS' : 'FAIL'}`);
    }
    if (which === 'all' || which === 'js') {
        console.log(`  JS:      ${jsOk ? 'PASS' : 'FAIL'}`);
    }
    if (which === 'all' || which === 'release') {
        console.log(`  Release: ${relOk ? 'PASS' : 'FAIL'}`);
    }
    console.log('='.repeat(60));

    if (!pyOk || !jsOk || !relOk) {
        console.log('\nOne or more suites failed.\n');
        process.exit(1);
    }
    console.log('\nAll suites passed.\n');
    process.exit(0);
}

main();