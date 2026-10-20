const mobileMessages = /* MOBILE_MESSAGES */;
const mobileLanguageStorageKey = 'savakan.mobile.language';
let mobileLanguage = 'ja';
try {
    if (localStorage.getItem(mobileLanguageStorageKey) === 'en') mobileLanguage = 'en';
} catch (_) { /* Storage may be disabled in private browsers. */ }

function t(key, values = {}) {
    const message = mobileMessages[key];
    if (!message) throw new Error(`Unknown mobile translation: ${key}`);
    return message[mobileLanguage === 'en' ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => {
        const value = values[name];
        return String(typeof value === 'function' ? value() : value ?? '');
    });
}

// Only explicitly registered UI labels are refreshed; user content is never translated.
const localizedMobileText = new Map();
function setLocalizedText(element, key, values = {}, attribute = 'textContent') {
    if (!element) return;
    let bindings = localizedMobileText.get(element);
    if (!bindings) {
        bindings = new Map();
        localizedMobileText.set(element, bindings);
    }
    if (!key) {
        bindings.delete(attribute);
        element[attribute] = '';
        return;
    }
    bindings.set(attribute, { key, values });
    element[attribute] = t(key, values);
}

function applyMobileLanguage() {
    document.documentElement.lang = mobileLanguage;
    document.title = t('documentTitle');
    for (const element of document.querySelectorAll('[data-i18n]')) {
        element.textContent = t(element.dataset.i18n);
    }
    for (const [element, bindings] of localizedMobileText) {
        if (!element.isConnected) {
            localizedMobileText.delete(element);
            continue;
        }
        for (const [attribute, { key, values }] of bindings) {
            element[attribute] = t(key, values);
        }
    }
    const selector = document.getElementById('mobileLanguage');
    if (selector) {
        selector.value = mobileLanguage;
        selector.setAttribute('aria-label', t('language'));
    }
}

function changeMobileLanguage(language) {
    mobileLanguage = language === 'en' ? 'en' : 'ja';
    try { localStorage.setItem(mobileLanguageStorageKey, mobileLanguage); } catch (_) {}
    applyMobileLanguage();
}

function mobileErrorDetail(raw) {
    let message = String(raw ?? '');
    try {
        const payload = JSON.parse(message);
        if (typeof payload.error === 'string') message = payload.error;
    } catch (_) {}
    // Match whole, known protocol errors only. Unknown diagnostics remain intact.
    const known = {
        unauthorized: 'unauthorized',
        'invalid token': 'unauthorized',
        'slug and eventId are required': 'missingScope',
        'slug, eventId and setId are required': 'missingSetScope',
        'slug, eventId and token are required': 'missingTokenScope',
        'set not found': 'setNotFound',
        'target set does not exist': 'setNotFound',
        'path/query and payload scope mismatch': 'scopeMismatch',
        'completed set results cannot be changed': 'completedResult',
        'slotScores contains unknown entrantId': 'unknownScoreEntrant',
        'sideAssignments contains unknown entrantId': 'unknownSideEntrant',
        'winnerId is not in target set': 'unknownWinner',
        'winnerId cannot be resolved for confirmed save': 'winnerRequired',
        'saved but failed to reload set detail': 'savedReloadFailed',
        '確定済みSetの呼び出しは呼び出しリストから解決してください。': 'completedCalls',
        '他端末が発行した未解決の呼び出しがあります。発行端末で解決してください。': 'otherCalls',
        'このSetに未解決の呼び出しがあります。解決してから操作してください。': 'callsUnresolved',
        'このプールは編集ロック中のため、スマートフォンからスコアを変更できません。': 'poolLockedMobile',
        'このプールは編集ロック中のため、スマートフォンから結果を送信できません。': 'poolLockedSubmit',
        'Failed to fetch': 'networkError',
        'NetworkError when attempting to fetch resource.': 'networkError',
        'Load failed': 'networkError',
    };
    if (Object.prototype.hasOwnProperty.call(known, message)) return t(known[message]);
    return message;
}

window.addEventListener('storage', (event) => {
    if (event.key === mobileLanguageStorageKey) {
        mobileLanguage = event.newValue === 'en' ? 'en' : 'ja';
        applyMobileLanguage();
    }
});
