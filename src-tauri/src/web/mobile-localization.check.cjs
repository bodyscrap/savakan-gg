const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const messages = JSON.parse(fs.readFileSync(path.join(__dirname, 'mobile-translations.json'), 'utf8'));
const helper = fs.readFileSync(path.join(__dirname, 'mobile-localization.js'), 'utf8')
    .replace('/* MOBILE_MESSAGES */', JSON.stringify(messages));
const rust = fs.readFileSync(path.join(__dirname, '..', 'lib.rs'), 'utf8');
const mobileHtml = rust.slice(rust.indexOf('fn mobile_input_html()')).match(/r#"([\s\S]*?)"#/)[1]
    .replace('/* MOBILE_LOCALIZATION */', helper);

function element(text = '') {
    return {
        textContent: text, value: '', title: '', isConnected: true, dataset: {},
        setAttribute(name, value) { this[name] = value; },
    };
}

function setup({ saved, blocked = false } = {}) {
    const labels = [];
    const selector = element();
    const listeners = {};
    const store = new Map(saved ? [['savakan.mobile.language', saved]] : []);
    const document = {
        title: '', documentElement: { lang: 'ja' },
        querySelectorAll() { return labels; },
        getElementById() { return selector; },
    };
    const context = vm.createContext({
        document, window: { addEventListener(name, listener) { listeners[name] = listener; } },
        localStorage: {
            getItem(key) { if (blocked) throw new Error('blocked'); return store.get(key); },
            setItem(key, value) { if (blocked) throw new Error('blocked'); store.set(key, value); },
        },
    });
    vm.runInContext(helper, context);
    return { context, document, labels, selector, listeners, store, run: (code) => vm.runInContext(code, context) };
}

test('embedded mobile and OBS scripts parse as JavaScript', () => {
    for (const script of mobileHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        new vm.Script(script[1]);
    }
    const overlayHtml = rust.slice(rust.indexOf('fn build_overlay_html()')).match(/r#"([\s\S]*?)"#/)[1];
    for (const script of overlayHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        new vm.Script(script[1]);
    }
});

test('every translation has both languages and matching parameters', () => {
    for (const [key, pair] of Object.entries(messages)) {
        assert.equal(pair.length, 2, key);
        for (const text of pair) assert.ok(typeof text === 'string' && text.trim(), key);
        const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
        assert.deepEqual(placeholders(pair[0]), placeholders(pair[1]), key);
    }
    for (const [, key] of mobileHtml.matchAll(/(?<![\w.$])t\('([^']+)'/g)) {
        assert.ok(messages[key], `Missing translation: ${key}`);
    }
    for (const [, key] of mobileHtml.matchAll(/data-i18n="([^"$]+)"/g)) {
        assert.ok(messages[key], `Missing static translation: ${key}`);
    }
});

test('switching updates only registered labels, preserving inputs and user content', () => {
    const env = setup();
    const label = element();
    label.dataset.i18n = 'search';
    env.labels.push(label);
    env.context.status = element();
    env.context.input = element();
    env.context.input.value = '2';
    env.context.user = element('検索 <Player> 日本語');
    env.context.header = element('大会名 / Event');
    env.run("setLocalizedText(status, 'saveFailed', { error: () => mobileErrorDetail('{\"error\":\"unauthorized\"}') }); applyMobileLanguage();");
    assert.equal(label.textContent, '検索');
    assert.equal(env.document.documentElement.lang, 'ja');
    env.run("changeMobileLanguage('en')");
    assert.equal(label.textContent, 'Search');
    assert.equal(env.document.documentElement.lang, 'en');
    assert.equal(env.document.title, 'Savakan Mobile Input');
    assert.equal(env.context.status.textContent,
        'Failed to save: Authorization failed. Open a new link from the desktop app.');
    assert.equal(env.context.input.value, '2');
    assert.equal(env.context.user.textContent, '検索 <Player> 日本語');
    assert.equal(env.context.header.textContent, '大会名 / Event');
    assert.equal(env.store.get('savakan.mobile.language'), 'en');
    env.run("setLocalizedText(status, ''); changeMobileLanguage('ja')");
    assert.equal(env.context.status.textContent, '');
    assert.equal(label.textContent, '検索');
});

test('stored language, storage changes, and blocked storage are safe', () => {
    const saved = setup({ saved: 'en' });
    saved.run('applyMobileLanguage()');
    assert.equal(saved.document.documentElement.lang, 'en');
    saved.listeners.storage({ key: 'savakan.mobile.language', newValue: 'ja' });
    assert.equal(saved.document.documentElement.lang, 'ja');
    const blocked = setup({ blocked: true });
    blocked.run("applyMobileLanguage(); changeMobileLanguage('en')");
    assert.equal(blocked.document.documentElement.lang, 'en');
    const invalid = setup({ saved: 'fr' });
    invalid.run('applyMobileLanguage()');
    assert.equal(invalid.document.documentElement.lang, 'ja');
});

test('known API errors translate exactly without altering arbitrary diagnostics', () => {
    const env = setup({ saved: 'en' });
    assert.equal(env.run("mobileErrorDetail('{\"error\":\"completed set results cannot be changed\"}')"), messages.completedResult[1]);
    assert.equal(env.run("mobileErrorDetail('{\"error\":\"このSetに未解決の呼び出しがあります。解決してから操作してください。\"}')"), messages.callsUnresolved[1]);
    assert.equal(env.run("mobileErrorDetail('unauthorized player 検索')"), 'unauthorized player 検索');
    assert.equal(env.run("mobileErrorDetail('{\"error\":\"大会名: 検索\"}')"), '大会名: 検索');
    assert.equal(env.run("mobileErrorDetail('constructor')"), 'constructor');
    assert.throws(() => env.run("t('missing-translation')"), /Unknown mobile translation/);
});
