const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { directory, profiles, hooks, scripts, start, run } = require('./support/hooks.cjs');

function unchanged(result) {
    assert.equal(result.replacement, undefined);
    assert.equal(result.serializations, 0);
}

test('response callbacks can run repeatedly in the same JavaScript context', () => {
    const calls = [];
    const context = vm.createContext({
        $response: { status: 304, body: '' }, $argument: { timer_mins: 2 }, $done: patch => calls.push(patch)
    });
    const callbacks = hooks.filter(name => name !== 'xaM-proxypin');
    for (let pass = 0; pass < 2; pass++) {
        for (const name of callbacks) scripts.get(name).runInContext(context);
    }
    assert.equal(calls.length, callbacks.length * 2);
    for (const patch of calls) assert.deepEqual(Object.keys(patch), []);
});

for (const name of hooks) {
    test(`${name} skips HTTP responses without a complete successful body before parsing`, async () => {
        for (const code of [101, 204, 205, 206, 302, 304, 403, 429, 500]) {
            for (const metadata of [{ status: code }, { statusCode: String(code) }]) {
                const result = await run(name, '{ "id": "sample" }', metadata, { timer_mins: 2 });
                unchanged(result);
                assert.equal(result.parses, 0);
            }
        }
    });

    test(`${name} passes through malformed bodies and unrelated data`, async () => {
        for (const body of ['', '<html>', 'null', '[]', '42', '{ "id": "trace-only" }\n']) {
            unchanged(await run(name, body, { status: 200 }, { timer_mins: 2 }));
        }
    });
}

for (const name of profiles) {
    test(`${name} preserves cached and failed batch entries without decoding their body`, async () => {
        for (const fields of [
            { headers: { etag: 'v1' } }, { headers: { ETag: 'v1' } }, { headers: { ETAG: 'v1' } },
            { status: 403 }, { statusCode: 429 }, { status: 304 }
        ]) {
            const envelope = { responses: [{ ...fields, body: '{ "id": "trace-only" }' }, {}] };
            const result = await run(name, JSON.stringify(envelope));
            unchanged(result);
            assert.equal(result.parses, 1);
        }
    });

    test(`${name} leaves incomplete batches, error objects and malformed profiles untouched`, async () => {
        for (const data of [
            { responses: [] }, { responses: [{}] }, { responses: [null, {}] },
            { responses: [{ body: '{bad' }, {}] }, { responses: [{ body: { id: 'trace-only' } }, {}] },
            { shopItems: 'invalid' }, { id: 'trace', trackingProperties: [] },
            { errorCode: 'sample-error', shopItems: [] },
            { responses: [{ body: { error: 'sample-error', shopItems: [] } }, {}] }
        ]) {
            unchanged(await run(name, JSON.stringify(data)));
        }
    });

    test(`${name} preserves the envelope and encoding of a sample display-name edit`, () => {
        const { context } = start(name, { body: '{}' });
        const profile = { id: 'sample', trackingProperties: {}, displayName: 'old' };
        const editName = data => { data.displayName = 'new'; };
        const edited = { ...profile, displayName: 'new' };
        const direct = context.rewriteProfileBody({ status: 200, body: JSON.stringify(profile) }, editName);
        assert.deepEqual(JSON.parse(direct), edited);
        for (const encode of [value => value, JSON.stringify]) {
            const envelope = { responses: [{ status: 200, body: encode(profile) }, { id: 'other' }], extra: 1 };
            const result = context.rewriteProfileBody({ body: JSON.stringify(envelope) }, editName);
            envelope.responses[0].body = encode(edited);
            assert.deepEqual(JSON.parse(result), envelope);
        }
    });
}

test('switches and multiplier selections accept only supported values', () => {
    const { context } = start('xaM-enhanced', { body: '{}' });
    for (const flag of [false, 'false', 0, '0', undefined, 'unexpected']) {
        const options = context.readOptions({ xp_boost: flag, multiplier: '2', unlock_all: flag });
        assert.equal(options.xpMultiplier, 0);
        assert.equal(options.unlockAll, false);
    }
    for (const multiplier of [undefined, 0, 4, '2x', '']) {
        assert.equal(context.readOptions({ xp_boost: true, multiplier }).xpMultiplier, 0);
    }
    for (const flag of [true, 'true', 1, '1']) {
        for (const multiplier of [2, '2', 3, '3']) {
            const options = context.readOptions({ xp_boost: flag, multiplier, unlock_all: flag });
            assert.equal(options.xpMultiplier, Number(multiplier));
            assert.equal(options.unlockAll, true);
        }
    }
});

test('both excluded practice types preserve all content, including elements', async () => {
    for (const type of ['MATCH_PRACTICE', 'SIDE_QUEST_RAMP_UP_PRACTICE']) {
        unchanged(await run('clear', JSON.stringify({ type, challenges: ['sample'], elements: ['sample'] })));
    }
});

test('empty, non-array and error fields are preserved', async () => {
    for (const data of [
        { type: 'sample', challenges: [], elements: [] },
        { type: 'sample', challenges: 'text', elements: { length: 1 } },
        { type: 'sample', challenges: {}, elements: ['sample'] }, { type: 1, elements: ['sample'] },
        { challenges: ['sample'] }, { error: 'sample-error', elements: ['sample'] }
    ]) {
        unchanged(await run('clear', JSON.stringify(data)));
    }
});

test('invalid minute settings are rejected before reading JSON', async () => {
    for (const minutes of [undefined, null, '', ' ', '2min', '2.5', -1, 0, true, [2], Number.MAX_SAFE_INTEGER]) {
        const args = minutes === undefined ? undefined : { timer_mins: minutes };
        const result = await run('time-modifier', '{"liveOpsChallenges":[]}', {}, args);
        unchanged(result);
        assert.equal(result.parses, 0);
    }
});

test('timers change once and a repeated pass skips serialization', async () => {
    const args = { timer_mins: ' 2 ' };
    const challenge = { initialTime: 30, initialLevelTimes: [10, 120], initialSessionTimes: [30], label: 'sample' };
    const original = { liveOpsChallenges: [challenge, { initialTime: 0, extra: 'kept' }] };
    const first = await run('time-modifier', JSON.stringify(original), { status: 201 }, args);
    assert.deepEqual(JSON.parse(first.replacement), {
        liveOpsChallenges: [
            { initialTime: 120, initialLevelTimes: [120, 120], initialSessionTimes: [120], label: 'sample' },
            { initialTime: 0, extra: 'kept' }
        ]
    });
    assert.equal(first.serializations, 1);
    unchanged(await run('time-modifier', first.replacement, { status: 200 }, { timer_mins: 2 }));
});

test('a malformed timer near the end discards the entire edit', async () => {
    for (const invalid of [null, { initialTime: -1 }, { initialLevelTimes: {} }, { initialSessionTimes: [15, 'bad'] }]) {
        const body = JSON.stringify({ liveOpsChallenges: [{ initialTime: 15 }, invalid] });
        unchanged(await run('time-modifier', body, {}, { timer_mins: 2 }));
    }
});

test('both Loon plugin files match endpoint segments and ignore lookalikes and query values', () => {
    const read = name => readFileSync(path.join(directory, name), 'utf8');
    const plugin = read('lingoDuo.plugin');
    assert.equal(read('lingoDuo-enchanced.plugin'), plugin);
    function patternFor(name) {
        const line = plugin.split(/\r?\n/).find(line => line.includes(`/lingoDuo-${name}.js"`));
        const [, source, flags] = line.match(/ ~= \/(.+)\/([a-z]*) then script\(/);
        return new RegExp(source, flags);
    }
    const session = patternFor('clear');
    const timer = patternFor('time-modifier');
    const host = 'https://api1.duolingo.com';
    for (const suffix of ['/v1/sessions', '/v1/sessions/abc', '/api2/stories?q=1']) assert.ok(session.test(host + suffix));
    for (const suffix of ['/v1/sessions-history', '/api2/stories-feed', '/other?to=/sessions', '/other#/sessions']) {
        assert.equal(session.test(host + suffix), false);
    }
    assert.ok(timer.test(host + '/v1/live-ops-challenges?locale=en'));
    for (const suffix of ['/v1/live-ops-challenges-old', '/other?to=/live-ops-challenges']) {
        assert.equal(timer.test(host + suffix), false);
    }
});
