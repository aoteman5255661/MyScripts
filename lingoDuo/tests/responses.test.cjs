const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
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

    test(`${name} keeps subscription records stable across repeated passes`, async () => {
        const existing = { id: 'gold_subscription', subscriptionInfo: { expectedExpiration: 123 }, extra: 'kept' };
        const other = { id: 'sample-item', extra: 'kept' };
        for (const shopItems of [[other], [other, existing], [existing, { ...existing, extra: 'second' }]]) {
            const first = await run(name, JSON.stringify({ shopItems, trackingProperties: { sample: true } }));
            const edited = JSON.parse(first.replacement);
            assert.deepEqual(edited.shopItems.slice(0, shopItems.length), shopItems);
            assert.equal(edited.shopItems.filter(item => item.id === 'gold_subscription').length,
                Math.max(1, shopItems.filter(item => item.id === 'gold_subscription').length));
            assert.equal(edited.trackingProperties.sample, true);

            const second = await run(name, first.replacement);
            assert.deepEqual(JSON.parse(second.replacement ?? first.replacement), edited);
        }
    });

    test(`${name} processes nullable shop entries while preserving their order`, async () => {
        const shopItems = [null, false, 7, 'sample', { id: 'sample-item' }];
        const result = await run(name, JSON.stringify({ shopItems }));
        const edited = JSON.parse(result.replacement);
        assert.deepEqual(edited.shopItems.slice(0, shopItems.length), shopItems);
        assert.equal(edited.shopItems.length, shopItems.length + 1);
        assert.equal(edited.shopItems[shopItems.length].id, 'gold_subscription');
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

test('enhanced options find existing boosts among nullable shop entries', async () => {
    const args = { xp_boost: 'true', multiplier: '3' };
    for (const existing of [[], [{ id: 'xp_boost_stackable', xpBoostMultiplier: 2, extra: 'kept' }]]) {
        const shopItems = [null, false, ...existing];
        const first = await run('xaM-enhanced', JSON.stringify({ shopItems }), {}, args);
        const edited = JSON.parse(first.replacement);
        assert.deepEqual(edited.shopItems.slice(0, 2), [null, false]);
        const boosts = edited.shopItems.filter(item => item?.id === 'xp_boost_stackable');
        assert.equal(boosts.length, 1);
        assert.equal(boosts[0].xpBoostMultiplier, 3);
        assert.equal(boosts[0].expectedExpirationDate - boosts[0].purchaseDate, 3600);
        assert.equal(boosts[0].extra, existing[0]?.extra);

        const second = await run('xaM-enhanced', first.replacement, {}, args);
        const repeated = JSON.parse(second.replacement ?? first.replacement);
        assert.equal(repeated.shopItems.filter(item => item?.id === 'xp_boost_stackable').length, 1);
        assert.equal(repeated.shopItems.filter(item => item?.id === 'gold_subscription').length, 1);
    }
});

test('enhanced course traversal tolerates empty section, unit and level entries', async () => {
    const lockedLevel = { id: 'sample-level', state: 'locked' };
    const currentCourse = {
        id: 'sample-course',
        pathSectioned: [null, false, {}, {
            units: [null, 7, {}, {
                levels: [null, 'sample', {}, lockedLevel, { state: 'completed' }]
            }]
        }]
    };
    const result = await run('xaM-enhanced', JSON.stringify({ shopItems: [], currentCourse }), {}, { unlock_all: true });
    lockedLevel.state = 'active';
    assert.deepEqual(JSON.parse(result.replacement).currentCourse, currentCourse);
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

test('practice edits clear populated pools and preserve session metadata', async () => {
    const session = {
        type: 'sample', id: 'sample-session', language: 'en',
        elements: ['sample'], challenges: ['sample'], adaptiveChallenges: ['sample'],
        adaptiveInterleavedChallenges: ['sample'], mistakesReplacementChallenges: ['sample']
    };
    const first = await run('clear', JSON.stringify(session));
    assert.deepEqual(JSON.parse(first.replacement), {
        type: 'sample', id: 'sample-session', language: 'en',
        elements: [], challenges: [], adaptiveChallenges: [],
        adaptiveInterleavedChallenges: [], mistakesReplacementChallenges: []
    });
    assert.equal(first.serializations, 1);
    unchanged(await run('clear', first.replacement));
});

test('story edits preserve challenge fields when the practice type is absent', async () => {
    const story = { id: 'sample-story', elements: ['sample'], challenges: ['kept'], extra: { language: 'en' } };
    const result = await run('clear', JSON.stringify(story));
    assert.deepEqual(JSON.parse(result.replacement), { ...story, elements: [] });
});

test('a malformed practice pool near the end discards the entire edit', async () => {
    const body = JSON.stringify({ type: 'sample', elements: ['sample'], mistakesReplacementChallenges: {} });
    unchanged(await run('clear', body));
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

test('configuration URLs use this repository and resolve to exact local asset names', () => {
    const filenames = ['lingoDuo.plugin', 'lingoDuo-enchanced.plugin', 'lingoDuo-xaM.module', 'lingoDuo-xaM.conf'];
    const assets = new Set(readdirSync(directory));
    const rawPrefix = 'https://raw.githubusercontent.com/aoteman5255661/MyScripts/main/lingoDuo/';
    const homepage = 'https://github.com/aoteman5255661/MyScripts/tree/main/lingoDuo';
    for (const filename of filenames) {
        const content = readFileSync(path.join(directory, filename), 'utf8');
        const urls = content.match(/https:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^\s"',)]+/g) || [];
        assert.ok(urls.length > 0, filename);
        for (const url of urls) {
            if (url === homepage) continue;
            assert.ok(url.startsWith(rawPrefix), `${filename} references ${url}`);
            assert.ok(assets.has(url.slice(rawPrefix.length)), `${filename} references a missing asset ${url}`);
        }
    }
});

test('profile rules match the same endpoints across Loon, Surge and Quantumult X', () => {
    const read = name => readFileSync(path.join(directory, name), 'utf8');
    const pluginLine = read('lingoDuo.plugin').split(/\r?\n/).find(line => line.includes('/lingoDuo-xaM-enhanced.js"'));
    const [, pluginSource, pluginFlags] = pluginLine.match(/ ~= \/(.+)\/([a-z]*) then script\(/);
    const [, moduleSource] = read('lingoDuo-xaM.module').match(/,pattern=(.+?),script-path=/);
    const quantumultLine = read('lingoDuo-xaM.conf').split(/\r?\n/).find(line => line.includes(' url script-response-body '));
    const [quantumultSource] = quantumultLine.split(' url script-response-body ');
    const patterns = [new RegExp(pluginSource, pluginFlags), new RegExp(moduleSource), new RegExp(quantumultSource)];
    const valid = [
        'https://ios-api-v2.duolingo.com/2023-05-23/batch',
        'https://ios-api-ab12.duolingo.cn/2023-05-23/batch?locale=zh',
        'https://api1.duolingo.com/2023-05-23/users/42',
        'https://api23.duolingo.cn/2023-05-23/users/me#section'
    ];
    const invalid = [
        'https://api1.duolingo.com/2023-05-23/batch-other',
        'https://api1.duolingo.com/2023-05-23/users/',
        'https://api1.duolingo.com/2023-05-23/users/42/progress',
        'https://api1.duolingo.com/other?to=/2023-05-23/users/42',
        'https://api1.duolingo.com.example/2023-05-23/users/42'
    ];
    for (const pattern of patterns) {
        for (const url of valid) assert.ok(pattern.test(url), url);
        for (const url of invalid) assert.equal(pattern.test(url), false, url);
    }
});
