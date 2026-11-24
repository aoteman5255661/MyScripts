const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const directory = path.resolve(__dirname, '../..');
const profiles = ['xaM', 'xaM-enhanced', 'xaM-proxypin'];
const hooks = [...profiles, 'clear', 'time-modifier'];
const scripts = new Map(hooks.map(name => {
    const filename = `lingoDuo-${name}.js`;
    const source = readFileSync(path.join(directory, filename), 'utf8');
    return [name, new vm.Script(source, { filename })];
}));

function start(name, response, args) {
    const calls = [];
    const counts = { parses: 0, serializations: 0 };
    const context = {
        $response: response,
        $done: patch => calls.push(patch),
        JSON: {
            parse(text) {
                counts.parses++;
                return JSON.parse(text);
            },
            stringify(value) {
                counts.serializations++;
                return JSON.stringify(value);
            }
        }
    };
    if (args !== undefined) context.$argument = args;
    scripts.get(name).runInNewContext(context);
    return { calls, counts, context };
}

async function run(name, body, metadata = {}, args) {
    const response = { ...metadata, body };
    const { calls, counts, context } = start(name, response, args);
    if (name === 'xaM-proxypin') {
        const output = await context.onResponse({}, {}, response);
        assert.equal(output, response);
        return { replacement: output.body === body ? undefined : output.body, ...counts };
    }
    assert.equal(calls.length, 1);
    assert.equal(response.body, body);
    return { replacement: calls[0].body, ...counts };
}

module.exports = { directory, profiles, hooks, scripts, start, run };
