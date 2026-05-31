// ========================================
// MLM PARENT ID TRACKING - START
// ========================================
//
// Goal: capture the affiliate referral ID (?via= or ?parent_id=) once and
// keep it attached to the user across:
//   - browser refreshes
//   - new tabs / windows
//   - link clicks that strip the query string
//   - multi-day signup completion (30-day attribution window)
//
// Fallback chain at every read: URL > localStorage > empty.
// Last-touch wins (a fresh ?via= overrides a stored one), matching the
// industry default for affiliate programs.

const PARENT_ID_STORAGE_KEY = 'stasher_partner_referral_v1';
const PARENT_ID_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Extract URL parameter by name. Returns null on any error.
 */
function getURLParameter(name) {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const value = urlParams.get(name);
        return value && value.trim() !== '' ? value.trim() : null;
    } catch (error) {
        return null;
    }
}

/**
 * Read a previously stored parent_id from localStorage, respecting TTL.
 */
function readStoredParentId() {
    try {
        const raw = localStorage.getItem(PARENT_ID_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.parentId) return null;
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
            localStorage.removeItem(PARENT_ID_STORAGE_KEY);
            return null;
        }
        return String(parsed.parentId);
    } catch (error) {
        return null;
    }
}

/**
 * Persist parent_id to localStorage so it survives tab closes and refreshes.
 * Safe to call repeatedly; last touch wins.
 */
function storeParentId(parentId) {
    if (!parentId) return;
    const value = String(parentId).trim();
    if (!value || value === 'null' || value === 'undefined') return;
    try {
        localStorage.setItem(PARENT_ID_STORAGE_KEY, JSON.stringify({
            parentId: value,
            capturedAt: Date.now(),
            expiresAt: Date.now() + PARENT_ID_TTL_MS,
            source: window.location.href
        }));
    } catch (error) {
        console.warn('[Tracking] Could not persist parent ID:', error);
    }
}

/**
 * Write the parent_id into the hidden form input so submit handlers pick it up.
 * Returns true if a value was written.
 */
function applyParentIdToField(parentId) {
    const parentIdField = document.getElementById('parent_id');
    if (!parentIdField || !parentId) return false;
    const value = String(parentId).trim();
    if (!value) return false;
    if (parentIdField.value !== value) {
        parentIdField.value = value;
    }
    return true;
}

/**
 * Resolve the best available parent_id RIGHT NOW. Called both on page load
 * and at every form submit so we can never miss it. Order:
 *   1. ?via= in current URL
 *   2. ?parent_id= in current URL
 *   3. localStorage (within 30-day window)
 * If found, writes it to the hidden field AND refreshes the storage TTL.
 */
function resolveParentId() {
    const urlParentId = getURLParameter('via') || getURLParameter('parent_id');
    if (urlParentId) {
        storeParentId(urlParentId);
        applyParentIdToField(urlParentId);
        return urlParentId;
    }
    const stored = readStoredParentId();
    if (stored) {
        applyParentIdToField(stored);
        return stored;
    }
    return null;
}

/**
 * Called on initial page load to capture and log the parent_id.
 */
function captureParentId() {
    const urlParentId = getURLParameter('via') || getURLParameter('parent_id');
    if (urlParentId) {
        storeParentId(urlParentId);
        applyParentIdToField(urlParentId);
        console.log('[Tracking] Parent ID captured from URL:', urlParentId);
        return;
    }
    const stored = readStoredParentId();
    if (stored) {
        applyParentIdToField(stored);
        console.log('[Tracking] Parent ID restored from storage:', stored);
        return;
    }
    console.log('[Tracking] No parent ID in URL or storage - direct signup');
}

// Eagerly store the URL value to localStorage BEFORE DOMContentLoaded, so even
// if the user bounces immediately we still have the attribution for next visit.
(function eagerStoreParentIdOnLoad() {
    try {
        const urlParentId = getURLParameter('via') || getURLParameter('parent_id');
        if (urlParentId) {
            storeParentId(urlParentId);
        }
    } catch (error) {
        // swallow — eager pass must never break the page
    }
})();

// Apply to the hidden field as soon as the DOM is ready.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', captureParentId);
} else {
    captureParentId();
}

// ========================================
// MLM PARENT ID TRACKING - END
// ========================================

// ========================================
// WHITELABEL BRANDING - START
// ========================================
//
// When a visitor lands with ?via=CODE and CODE matches a saved partner in
// /whitelabel/partners.json, apply exactly three cosmetic changes:
//   1. Replace the "Perfect for [rotating word]" pill with the partner's logo.
//   2. Recolor only the top header strip and the "Get started now" CTA(s).
//   3. Replace the "Built for" company-types section with the partner's
//      description, styled to look like a clean benefits panel.
// If there is no ?via=, or the code is unknown, the page is left untouched.

const WHITELABEL_PARTNERS_URL = '/whitelabel/partners.json';

function getViaCodeFromURL() {
    try {
        const params = new URLSearchParams(window.location.search);
        const value = params.get('via') || params.get('parent_id');
        return value ? value.trim() : '';
    } catch (error) {
        return '';
    }
}

function fetchWhitelabelPartners() {
    return fetch(WHITELABEL_PARTNERS_URL, { cache: 'no-store' })
        .then(function (response) {
            if (!response.ok) return null;
            return response.json();
        })
        .catch(function () { return null; });
}

function applyWhitelabelBranding(partner) {
    if (!partner) return;
    try {
        document.body.classList.add('wl-branded');
        if (partner.brandColor && /^#[0-9a-fA-F]{6}$/.test(partner.brandColor)) {
            injectWhitelabelBrandStyles(partner.brandColor);
        }
        if (partner.logoPath) {
            replacePerfectForWithLogo(partner.logoPath, partner.code || 'Partner');
        }
        if (partner.heroHeadline) {
            overrideHeroText('#landingHeroTitle', partner.heroHeadline);
        }
        if (partner.heroSubtitle) {
            overrideHeroText('.landing-subtitle', partner.heroSubtitle);
        }
        if (partner.description) {
            replaceBuiltForWithDescription(partner);
        }
    } catch (error) {
        console.warn('[Whitelabel] Could not apply branding:', error);
    }
}

/**
 * Replace the text of a hero element and remove it from the i18n registry
 * so a later language change does not undo the whitelabel override.
 */
function overrideHeroText(selector, text) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.textContent = text;
    el.dataset.wlOverride = '1';
    detachFromI18n(el);
}

/**
 * Pull an element out of every translation cache so applyTranslations()
 * stops touching it. Safe no-op if i18n hasn't initialised yet.
 */
function detachFromI18n(element) {
    if (!element) return;
    try {
        if (typeof textTranslationRegistry !== 'undefined' && textTranslationRegistry) {
            Object.keys(textTranslationRegistry).forEach(function (key) {
                const list = textTranslationRegistry[key];
                if (!Array.isArray(list)) return;
                const idx = list.indexOf(element);
                if (idx >= 0) list.splice(idx, 1);
            });
        }
        if (typeof htmlTranslationRegistry !== 'undefined' && Array.isArray(htmlTranslationRegistry)) {
            htmlTranslationRegistry.forEach(function (entry) {
                if (!entry || !Array.isArray(entry.elements)) return;
                const idx = entry.elements.indexOf(element);
                if (idx >= 0) entry.elements.splice(idx, 1);
            });
        }
    } catch (error) {
        // best effort
    }
}

function injectWhitelabelBrandStyles(brandColor) {
    if (document.getElementById('wlBrandStyles')) return;
    const ctaText = getReadableTextColor(brandColor);
    const style = document.createElement('style');
    style.id = 'wlBrandStyles';
    style.textContent =
        'body.wl-branded .header{background-color:' + brandColor + ' !important;}' +
        'body.wl-branded .btn-landing-cta{background:' + brandColor + ' !important;background-color:' + brandColor + ' !important;color:' + ctaText + ' !important;box-shadow:0 6px 25px ' + hexToRgba(brandColor, 0.45) + ' !important;}' +
        'body.wl-branded .btn-landing-cta:hover{background:' + darkenHex(brandColor, 0.12) + ' !important;background-color:' + darkenHex(brandColor, 0.12) + ' !important;color:' + ctaText + ' !important;box-shadow:0 12px 40px ' + hexToRgba(brandColor, 0.55) + ' !important;}' +
        'body.wl-branded .btn-landing-cta:active{box-shadow:0 2px 8px ' + hexToRgba(brandColor, 0.25) + ' !important;}' +
        '.wl-partner-logo{display:flex;align-items:center;justify-content:flex-start;margin:0 0 12px;}' +
        '.wl-partner-logo img{height:32px;width:auto;max-width:100%;object-fit:contain;}' +
        '@media (max-width:600px){.wl-partner-logo{justify-content:center;}.wl-partner-logo img{height:28px;}}' +
        '.wl-benefits{margin:32px 0;padding:28px;border-radius:18px;background:#fff;border:1px solid rgba(20,46,89,0.08);box-shadow:0 6px 28px rgba(20,46,89,0.06);}' +
        '.wl-benefits-title{margin:0 0 18px;font-size:20px;font-weight:700;color:#142e59;line-height:1.35;}' +
        '.wl-benefits-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;}' +
        '.wl-benefits-item{display:flex;align-items:flex-start;gap:12px;}' +
        '.wl-benefits-icon{flex:0 0 22px;width:22px;height:22px;color:#142e59;margin-top:2px;display:inline-flex;align-items:center;justify-content:center;}' +
        '.wl-benefits-icon svg{width:100%;height:100%;display:block;}' +
        '.wl-benefits-text{flex:1;font-size:16px;line-height:1.55;color:#142e59;}' +
        '.wl-benefits-paragraph{margin:8px 0 0;font-size:16px;line-height:1.6;color:#142e59;white-space:pre-line;}' +
        '.wl-benefits-cta{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(20,46,89,0.08);color:#142e59;font-size:14px;font-weight:600;text-decoration:none;line-height:1.4;}' +
        '.wl-benefits-cta:hover{color:#0f2347;}' +
        '.wl-benefits-cta:hover .wl-benefits-cta-arrow{transform:translateX(3px);}' +
        '.wl-benefits-cta-icon{flex:0 0 18px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:#142e59;}' +
        '.wl-benefits-cta-icon svg{width:100%;height:100%;display:block;}' +
        '.wl-benefits-cta-arrow{display:inline-flex;width:14px;height:14px;color:#142e59;transition:transform 0.18s ease;}' +
        '.wl-benefits-cta-arrow svg{width:100%;height:100%;display:block;}' +
        '@media (max-width:600px){.wl-benefits{padding:22px;border-radius:14px;}.wl-benefits-title{font-size:18px;}.wl-benefits-text,.wl-benefits-paragraph{font-size:15px;}.wl-benefits-cta{font-size:13px;}}';
    document.head.appendChild(style);
}

/**
 * Returns either '#ffffff' or '#142e59' depending on which gives readable
 * contrast on the supplied brand colour. Uses WCAG relative luminance.
 * Keeps CTA labels legible if a partner picks a very light brand colour.
 */
function getReadableTextColor(hex) {
    try {
        const clean = hex.replace('#', '');
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;
        const toLinear = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
        return luminance > 0.55 ? '#142e59' : '#ffffff';
    } catch (error) {
        return '#ffffff';
    }
}

function replacePerfectForWithLogo(logoSrc, altText) {
    const pfRow = document.querySelector('.pf-row');
    if (!pfRow) return;
    if (document.querySelector('.wl-partner-logo')) return;
    pfRow.style.display = 'none';
    pfRow.setAttribute('aria-hidden', 'true');
    const wrapper = document.createElement('div');
    wrapper.className = 'wl-partner-logo';
    const img = document.createElement('img');
    img.src = logoSrc;
    img.alt = altText + ' logo';
    img.loading = 'eager';
    wrapper.appendChild(img);
    pfRow.parentNode.insertBefore(wrapper, pfRow);
}

function replaceBuiltForWithDescription(partner) {
    const section = document.querySelector('.company-types-section');
    if (!section) return;
    if (document.querySelector('.wl-benefits')) return;
    section.style.display = 'none';
    section.setAttribute('aria-hidden', 'true');

    const description = (partner && partner.description) || '';
    const explicitTitle = (partner && partner.title) ? String(partner.title).trim() : '';
    const parsed = parseBenefits(description, !!explicitTitle);

    const benefits = document.createElement('div');
    benefits.className = 'wl-benefits';

    const finalTitle = explicitTitle || parsed.title;
    if (finalTitle) {
        const h3 = document.createElement('h3');
        h3.className = 'wl-benefits-title';
        h3.textContent = finalTitle;
        benefits.appendChild(h3);
    }

    if (parsed.items.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'wl-benefits-list';
        parsed.items.forEach(function (text) {
            ul.appendChild(buildBenefitItem(text));
        });
        benefits.appendChild(ul);
    }

    if (parsed.paragraph) {
        const p = document.createElement('p');
        p.className = 'wl-benefits-paragraph';
        p.textContent = parsed.paragraph;
        benefits.appendChild(p);
    }

    if (partner && partner.ctaUrl && /^https?:\/\//i.test(partner.ctaUrl)) {
        benefits.appendChild(buildBenefitsCta(partner.ctaUrl, partner.ctaLabel));
    }

    section.parentNode.insertBefore(benefits, section);
}

function buildBenefitsCta(url, label) {
    const a = document.createElement('a');
    a.className = 'wl-benefits-cta';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'wl-benefits-cta-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M4 6.5C4 5.12 5.12 4 6.5 4H18a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.78.41L17 18.5H6.5A2.5 2.5 0 0 1 4 16V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
            '<path d="M8 9h8M8 12h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
        '</svg>';

    const textSpan = document.createElement('span');
    const safeLabel = (label && String(label).trim()) || 'Click here to see how to integrate Stasher in a few minutes';
    textSpan.textContent = safeLabel;

    const arrowWrap = document.createElement('span');
    arrowWrap.className = 'wl-benefits-cta-arrow';
    arrowWrap.setAttribute('aria-hidden', 'true');
    arrowWrap.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';

    a.appendChild(iconWrap);
    a.appendChild(textSpan);
    a.appendChild(arrowWrap);
    return a;
}

/**
 * Parse the admin-supplied description into a title + checklist items.
 * Rules:
 *   - Lines starting with •, -, * or + are treated as bullet items.
 *   - If any bullets exist, lines before the first bullet form the title;
 *     non-bullet lines after a bullet are appended to the previous item.
 *   - If no bullets exist, the first line is the title and the rest is a
 *     plain paragraph (preserving line breaks).
 *
 * When `titleAlreadyProvided` is true, no title is extracted from the
 * description — every non-bullet line is treated as either a paragraph
 * (no bullets present) or appended to the most recent item (bullets present).
 */
function parseBenefits(description, titleAlreadyProvided) {
    const result = { title: '', items: [], paragraph: '' };
    if (!description) return result;

    const lines = String(description).split(/\r?\n/).map(function (l) {
        return l.trim();
    }).filter(Boolean);
    if (lines.length === 0) return result;

    const bulletRegex = /^[•\-*+]\s+/;
    const isBullet = function (line) { return bulletRegex.test(line); };
    const stripBullet = function (line) { return line.replace(bulletRegex, '').trim(); };

    const hasBullets = lines.some(isBullet);

    if (!hasBullets) {
        if (titleAlreadyProvided) {
            result.paragraph = lines.join('\n');
        } else if (lines.length === 1) {
            result.title = lines[0];
        } else {
            result.title = lines[0];
            result.paragraph = lines.slice(1).join('\n');
        }
        return result;
    }

    let collectingTitle = !titleAlreadyProvided;
    const titleLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isBullet(line)) {
            collectingTitle = false;
            const cleaned = stripBullet(line);
            if (cleaned) result.items.push(cleaned);
        } else if (collectingTitle) {
            titleLines.push(line);
        } else if (result.items.length > 0) {
            result.items[result.items.length - 1] += ' ' + line;
        }
    }
    if (!titleAlreadyProvided) {
        result.title = titleLines.join(' ');
    }
    return result;
}

function buildBenefitItem(text) {
    const li = document.createElement('li');
    li.className = 'wl-benefits-item';

    const icon = document.createElement('span');
    icon.className = 'wl-benefits-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';

    const t = document.createElement('span');
    t.className = 'wl-benefits-text';
    t.textContent = text;

    li.appendChild(icon);
    li.appendChild(t);
    return li;
}

function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function darkenHex(hex, amount) {
    const clean = hex.replace('#', '');
    const r = Math.max(0, Math.floor(parseInt(clean.slice(0, 2), 16) * (1 - amount)));
    const g = Math.max(0, Math.floor(parseInt(clean.slice(2, 4), 16) * (1 - amount)));
    const b = Math.max(0, Math.floor(parseInt(clean.slice(4, 6), 16) * (1 - amount)));
    return '#' + [r, g, b].map(function (n) {
        const h = n.toString(16);
        return h.length === 1 ? '0' + h : h;
    }).join('');
}

function initWhitelabelBranding() {
    const code = getViaCodeFromURL();
    if (!code) return;
    fetchWhitelabelPartners().then(function (data) {
        if (!data || !data.partners) return;
        const partner = data.partners[code];
        if (!partner) return;
        if (!partner.code) partner.code = code;
        applyWhitelabelBranding(partner);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhitelabelBranding);
} else {
    initWhitelabelBranding();
}

// ========================================
// WHITELABEL BRANDING - END
// ========================================

// ========================================
// LANGUAGE URL PARAMETER - START
// ========================================

const SUPPORTED_LANGUAGES = ['en', 'de', 'fr', 'es', 'it'];
const DEFAULT_LANGUAGE = 'en';

/**
 * Read the language acronym from the URL.
 * Supports both path-based URLs (e.g. /it/) and the legacy ?lang=xx query param.
 * Returns a supported language code or null if not present/invalid.
 */
function getLanguageFromURL() {
    try {
        const pathSegment = (window.location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
        if (SUPPORTED_LANGUAGES.includes(pathSegment)) {
            return pathSegment;
        }
        const urlParams = new URLSearchParams(window.location.search);
        const queryLang = (urlParams.get('lang') || '').toLowerCase();
        if (SUPPORTED_LANGUAGES.includes(queryLang)) {
            return queryLang;
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Update the current URL so it reflects the selected language as a path prefix
 * (e.g. /it/). Default language uses the bare root (/). Uses replaceState so
 * it does not pollute history and preserves any other params (e.g. via/parent_id).
 */
function updateLanguageInURL(language) {
    try {
        const url = new URL(window.location.href);

        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length && SUPPORTED_LANGUAGES.includes(segments[0].toLowerCase())) {
            segments.shift();
        }
        if (language && language !== DEFAULT_LANGUAGE && SUPPORTED_LANGUAGES.includes(language)) {
            segments.unshift(language);
        }
        url.pathname = segments.length ? '/' + segments.join('/') + '/' : '/';

        url.searchParams.delete('lang');

        window.history.replaceState({}, '', url.toString());
    } catch (error) {
        console.warn('Could not update language in URL:', error);
    }
}

// ========================================
// LANGUAGE URL PARAMETER - END
// ========================================

// Form State Management
const formState = {
    currentPage: 1,
    program: null,
    language: 'en',
    acceptTerms: false,
    companyType: null,
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    commissionType: '',
    city: '',
    country: '',
    companyName: '',
    companyWebsite: '',
    numberOfProperties: '',
    companyDescription: '',
    wantsDemoCall: false
};

const SIGNUP_FLOW_STORAGE_KEY = 'stasher_signup_flow_state_v1';

function persistSignupFlowState() {
    try {
        sessionStorage.setItem(SIGNUP_FLOW_STORAGE_KEY, JSON.stringify({
            ...formState,
            isInFlow: true
        }));
    } catch (error) {
        console.warn('Could not persist signup flow state:', error);
    }
}

function loadSignupFlowState() {
    try {
        const raw = sessionStorage.getItem(SIGNUP_FLOW_STORAGE_KEY);
        if (!raw) return null;
        const savedState = JSON.parse(raw);
        if (!savedState || !savedState.isInFlow) return null;
        const currentPage = Number(savedState.currentPage);
        if (!Number.isInteger(currentPage) || currentPage < 1 || currentPage > 5) {
            return null;
        }
        return savedState;
    } catch (error) {
        console.warn('Could not load signup flow state:', error);
        return null;
    }
}

function clearSignupFlowState() {
    try {
        sessionStorage.removeItem(SIGNUP_FLOW_STORAGE_KEY);
    } catch (error) {
        console.warn('Could not clear signup flow state:', error);
    }
}

function syncFormUiFromState() {
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect && formState.language) {
        languageSelect.value = formState.language;
    }

    document.querySelectorAll('.company-type-box').forEach(box => {
        box.classList.toggle('selected', box.dataset.type === formState.companyType);
    });

    document.querySelectorAll('.currency-box').forEach(box => {
        box.classList.toggle('selected', box.dataset.currency === formState.program);
    });

    ['firstName', 'lastName', 'email', 'password'].forEach(field => {
        const input = document.getElementById(field);
        if (input) {
            input.value = formState[field] || '';
        }
    });

    const acceptTerms = document.getElementById('acceptTerms');
    if (acceptTerms) {
        acceptTerms.checked = !!formState.acceptTerms;
    }

    const fieldValues = {
        city: formState.city,
        country: formState.country,
        companyName: formState.companyName,
        companyWebsite: formState.companyWebsite,
        numberOfProperties: formState.numberOfProperties,
        city2: formState.city,
        country2: formState.country,
        companyName2: formState.companyName,
        companyWebsite2: formState.companyWebsite,
        companyDescription: formState.companyDescription
    };

    Object.entries(fieldValues).forEach(([fieldId, value]) => {
        const input = document.getElementById(fieldId);
        if (input) {
            input.value = value || '';
        }
    });

    ['commissionType', 'commissionType2'].forEach(fieldId => {
        const select = document.getElementById(fieldId);
        if (select) {
            select.value = formState.commissionType || '';
        }
    });
}

function restoreSignupFlow() {
    const savedState = loadSignupFlowState();
    if (!savedState) return false;

    Object.assign(formState, savedState);
    syncFormUiFromState();

    const landingPage = document.getElementById('landingPage');
    const progressContainer = document.getElementById('progressContainer');
    const formContainer = document.getElementById('formContainer');

    if (landingPage) {
        landingPage.style.display = 'none';
    }
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
    if (formContainer) {
        formContainer.style.display = 'block';
    }

    showPage(formState.currentPage);
    updateProgressBar(formState.currentPage);
    updateContinueButton(formState.currentPage);
    return true;
}

// Affiliate ID created after Page 3 (Stage A)
let createdAffiliateId = null;
// Promise for Stage A — allows Stage B to await it if the user submits quickly
let stageAPromise = null;

// Backend API Endpoint
// This points to your AWS API Gateway endpoint
const BACKEND_API_URL = 'https://wpnp6ab1ge.execute-api.eu-north-1.amazonaws.com/prod/create-affiliate';

// Map program currency to Tapfiliate Program ID
// These are the actual program IDs from your Tapfiliate dashboard
const PROGRAM_ID_MAP = {
    'USD': 'stasher-affiliates-usd',
    'EUR': 'stasher-affiliate-program-sp',
    'GBP': 'stasher-affiliate-program',
    'AUD': 'jg-affiliate-program'
};

// Country name to ISO 3166-1 alpha-2 code mapping
const COUNTRY_ISO_MAP = {
    'United States': 'US',
    'United Kingdom': 'GB',
    'Canada': 'CA',
    'Australia': 'AU',
    'Germany': 'DE',
    'France': 'FR',
    'Spain': 'ES',
    'Italy': 'IT',
    'Netherlands': 'NL',
    'Belgium': 'BE',
    'Switzerland': 'CH',
    'Austria': 'AT',
    'Sweden': 'SE',
    'Norway': 'NO',
    'Denmark': 'DK',
    'Finland': 'FI',
    'Poland': 'PL',
    'Portugal': 'PT',
    'Greece': 'GR',
    'Ireland': 'IE',
    'Czech Republic': 'CZ',
    'Hungary': 'HU',
    'Romania': 'RO',
    'Bulgaria': 'BG',
    'Croatia': 'HR',
    'Slovakia': 'SK',
    'Slovenia': 'SI',
    'Estonia': 'EE',
    'Latvia': 'LV',
    'Lithuania': 'LT',
    'Luxembourg': 'LU',
    'Malta': 'MT',
    'Cyprus': 'CY',
    'Japan': 'JP',
    'South Korea': 'KR',
    'China': 'CN',
    'India': 'IN',
    'Singapore': 'SG',
    'Hong Kong': 'HK',
    'Taiwan': 'TW',
    'Thailand': 'TH',
    'Malaysia': 'MY',
    'Indonesia': 'ID',
    'Philippines': 'PH',
    'Vietnam': 'VN',
    'New Zealand': 'NZ',
    'South Africa': 'ZA',
    'Brazil': 'BR',
    'Mexico': 'MX',
    'Argentina': 'AR',
    'Chile': 'CL',
    'Colombia': 'CO',
    'Peru': 'PE',
    'Uruguay': 'UY',
    'Paraguay': 'PY',
    'Ecuador': 'EC',
    'Venezuela': 'VE',
    'Costa Rica': 'CR',
    'Panama': 'PA',
    'Guatemala': 'GT',
    'Honduras': 'HN',
    'El Salvador': 'SV',
    'Nicaragua': 'NI',
    'Dominican Republic': 'DO',
    'Jamaica': 'JM',
    'Trinidad and Tobago': 'TT',
    'Barbados': 'BB',
    'Bahamas': 'BS',
    'Belize': 'BZ',
    'Guyana': 'GY',
    'Suriname': 'SR',
    'Bolivia': 'BO',
    'Russia': 'RU',
    'Ukraine': 'UA',
    'Turkey': 'TR',
    'Israel': 'IL',
    'United Arab Emirates': 'AE',
    'Saudi Arabia': 'SA',
    'Qatar': 'QA',
    'Kuwait': 'KW',
    'Oman': 'OM',
    'Bahrain': 'BH',
    'Jordan': 'JO',
    'Lebanon': 'LB',
    'Egypt': 'EG',
    'Morocco': 'MA',
    'Tunisia': 'TN',
    'Algeria': 'DZ',
    'Kenya': 'KE',
    'Nigeria': 'NG',
    'Ghana': 'GH',
    'Senegal': 'SN',
    'Ivory Coast': 'CI',
    'Tanzania': 'TZ',
    'Uganda': 'UG',
    'Ethiopia': 'ET',
    'Rwanda': 'RW',
    'Mauritius': 'MU'
};

// Helper function to get ISO country code
function getCountryISOCode(countryName) {
    return COUNTRY_ISO_MAP[countryName] || countryName.substring(0, 2).toUpperCase();
}

// Country List
const countries = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'Spain', 'Italy',
    'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Sweden', 'Norway', 'Denmark', 'Finland',
    'Poland', 'Portugal', 'Greece', 'Ireland', 'Czech Republic', 'Hungary', 'Romania', 'Bulgaria',
    'Croatia', 'Slovakia', 'Slovenia', 'Estonia', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta',
    'Cyprus', 'Japan', 'South Korea', 'China', 'India', 'Singapore', 'Hong Kong', 'Taiwan',
    'Thailand', 'Malaysia', 'Indonesia', 'Philippines', 'Vietnam', 'New Zealand', 'South Africa',
    'Brazil', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Uruguay', 'Paraguay',
    'Ecuador', 'Venezuela', 'Costa Rica', 'Panama', 'Guatemala', 'Honduras', 'El Salvador',
    'Nicaragua', 'Dominican Republic', 'Jamaica', 'Trinidad and Tobago', 'Barbados', 'Bahamas',
    'Belize', 'Guyana', 'Suriname', 'Bolivia', 'Russia', 'Ukraine', 'Turkey', 'Israel',
    'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Oman', 'Bahrain', 'Jordan',
    'Lebanon', 'Egypt', 'Morocco', 'Tunisia', 'Algeria', 'Kenya', 'Nigeria', 'Ghana',
    'Senegal', 'Ivory Coast', 'Tanzania', 'Uganda', 'Ethiopia', 'Rwanda', 'Mauritius'
];

// Translation dictionaries
const TEXT_TRANSLATIONS_DE = {
    "Join Stasher's Affiliate Program": "Treten Sie dem Stasher-Affiliate-Programm bei",
    "Help your guests or clients store their bags and receive extra revenue, higher customer satisfaction, and better reviews.": "Helfen Sie Ihren Gästen oder Kunden, ihr Gepäck aufzubewahren und erhalten Sie zusätzliche Einnahmen, höhere Kundenzufriedenheit und bessere Bewertungen.",
    "Totally Free to Join": "Kostenlose Anmeldung",
    "Takes Less Than 1 Minute": "Dauert weniger als 1 Minute",
    "Get Started Now": "Jetzt loslegen",
    "Get started now": "Jetzt beginnen",
    "Already have an account?": "Sie haben bereits ein Konto?",
    "Login": "Anmelden",
    "Built for": "Entwickelt für",
    "Airbnb hosts": "Airbnb-Gastgeber",
    "Travel blogs": "Reiseblogs",
    "Venues": "Veranstaltungsorte",
    "Transportation": "Transportunternehmen",
    "STRs": "Kurzzeitvermieter",
    "Travel apps": "Reise-Apps",
    "City guides": "Stadtführer",
    "Events": "Veranstaltungen",
    "Why should you join the program?": "Warum sollten Sie dem Programm beitreten?",
    "Extra Revenue Stream": "Zusätzliche Einnahmequelle",
    "Receive 10% commission for every booking you generate via your referral link.": "Erhalten Sie 10 % Provision für jede Buchung, die über Ihren Empfehlungslink erfolgt.",
    "Customer Satisfaction": "Kundenzufriedenheit",
    "Provide your guests or clients with a helpful service and make them happy.": "Bieten Sie Ihren Gästen oder Kunden einen hilfreichen Service und machen Sie sie glücklich.",
    "Global Coverage": "Globale Abdeckung",
    "Stasher is live with thousands of locations in more than 1,190 cities globally.": "Stasher ist mit Tausenden Standorten in über 1.190 Städten weltweit verfügbar.",
    "How does it work?": "Wie funktioniert das?",
    "Sign up for free": "Kostenlos anmelden",
    "Create your account in under a minute. Fill out the form and you're ready to go.": "Erstellen Sie Ihr Konto in weniger als einer Minute. Füllen Sie das Formular aus und schon kann es losgehen.",
    "Receive your link": "Erhalten Sie Ihren Link",
    "Get your referral link, discount code, and dashboard access. Everything is stored in your dashboard.": "Erhalten Sie Ihren Empfehlungslink, Rabattcode und Dashboard-Zugang. Alles befindet sich in Ihrem Dashboard.",
    "Share Stasher": "Stasher teilen",
    "Share your link with customers through messages, guides, emails, or FAQs.": "Teilen Sie Ihren Link mit Kunden über Nachrichten, Guides, E-Mails oder FAQs.",
    "Partnerships": "Partnerschaften",
    "Trusted by top brands": "Vertrauenswürdig für führende Marken",
    "Leading hospitality and travel companies trust Stasher to provide seamless luggage storage solutions for their customers.": "Führende Hospitality- und Reiseunternehmen vertrauen Stasher, um ihren Kunden nahtlose Gepäckaufbewahrung zu bieten.",
    "Stasher in the Media": "Stasher in den Medien",
    "Trusted by the travel industry's leading voices": "Von den führenden Stimmen der Reisebranche empfohlen",
    "Leading outlets highlight how Stasher helps hosts, property managers, and venues offer seamless baggage storage.": "Renommierte Medien zeigen, wie Stasher Gastgebern, Property-Managern und Veranstaltungsorten hilft, eine nahtlose Gepäckaufbewahrung bereitzustellen.",
    "“A simple way for hospitality brands to add a valuable guest benefit.”": "„Eine einfache Möglichkeit für Hospitality-Marken, einen wertvollen Gästeservice anzubieten.“",
    "— Forbes": "— Forbes",
    "“Stasher bridges the gap between travelers and local businesses in minutes.”": "„Stasher überbrückt die Lücke zwischen Reisenden und lokalen Unternehmen in wenigen Minuten.“",
    "— TechCrunch": "— TechCrunch",
    "“Hosts boost revenue while keeping their guests delighted and stress-free.”": "„Hosts steigern ihre Einnahmen und halten ihre Gäste zufrieden und stressfrei.“",
    "— BBC Travel": "— BBC Travel",
    "Check our locations": "Unsere Standorte ansehen",
    "Find secure luggage storage near you in just a few clicks.": "Finden Sie mit wenigen Klicks eine sichere Gepäckaufbewahrung in Ihrer Nähe.",
    "View locations": "Standorte ansehen",
    "Secure & convenient locations": "Sichere und praktische Standorte",
    "Millions of bags stored safely": "Millionen sicher aufbewahrter Gepäckstücke",
    "Excellent reviews": "Ausgezeichnete Bewertungen",
    "Available 24/7": "Rund um die Uhr verfügbar",
    "Frequently Asked Questions": "Häufig gestellte Fragen",
    "Is it free to open an affiliate account?": "Ist die Eröffnung eines Affiliate-Kontos kostenlos?",
    "Yes, it totally free.": "Ja, sie ist völlig kostenlos.",
    "Can I track bookings and performance?": "Kann ich Buchungen und Performance verfolgen?",
    "Yes, once you sign up, you will receive an email with the login page to access your personal dashboard, where you can track clicks, conversions, CVR, and much more!": "Ja, nach der Anmeldung erhalten Sie eine E-Mail mit dem Login-Link zu Ihrem persönlichen Dashboard, in dem Sie Klicks, Conversions, CVR und vieles mehr verfolgen können.",
    "Where can I find my referral link or coupon code?": "Wo finde ich meinen Empfehlungslink oder Rabattcode?",
    "You can find your referral link or coupon code in the email you received once your account is approved (it takes a few hours to 1 day since you signed up) or via your personal dashboard.": "Sie finden Ihren Empfehlungslink oder Rabattcode in der E-Mail, die Sie nach der Freischaltung Ihres Kontos erhalten (dies dauert nur wenige Stunden bis zu einem Tag nach der Anmeldung), oder in Ihrem persönlichen Dashboard.",
    "How and when do I get paid my commission?": "Wie und wann erhalte ich meine Provision?",
    "In order to receive your commission, you have to enter your bank details by logging in to your dashboard (see instructions here). The commission is paid every month (the minimum threshold is 10 EUR / GBP / USD for the payout; if it is not met, you will receive the payment on the next payment until you reach the threshold).": "Um Ihre Provision zu erhalten, geben Sie Ihre Bankdaten in Ihrem Dashboard ein (siehe Anleitung dort). Die Provision wird monatlich ausgezahlt (Mindestbetrag 10 EUR / GBP / USD; wenn dieser nicht erreicht wird, erfolgt die Auszahlung, sobald der Betrag erreicht ist).",
    "Can I appear on your website as a partner?": "Kann ich auf Ihrer Website als Partner erscheinen?",
    "Will I need to do a lot of administrative work?": "Muss ich viel Verwaltungsarbeit leisten?",
    "Certainly Not! The process is quite straightforward and efficient. It only takes a few minutes to set up. You simply need to add your referral link and coupon code to your guest communications. This can be done through various channels such as emails, your website, or any other relevant platform. Once this is done, you're all set and ready to go. There's minimal administrative work involved, making it a hassle-free addition to your communication strategy.": "Ganz und gar nicht! Der Prozess ist sehr einfach und effizient und dauert nur wenige Minuten. Sie müssen lediglich Ihren Empfehlungslink und Rabattcode in Ihre Gästekommunikation einfügen – z. B. per E-Mail, auf Ihrer Website oder über andere Kanäle. Danach ist alles eingerichtet und es fällt kaum Verwaltungsaufwand an.",
    "What criteria does Stasher consider for potential partners?": "Welche Kriterien berücksichtigt Stasher für potenzielle Partner?",
    "There are no specific criteria to consider for potential partners, if you have customers who need luggage storage or want to promote our service and gain commission, you are welcome. Sign up today and receive a 10% commission on every booking you generate.": "Es gibt keine speziellen Kriterien. Wenn Sie Kunden haben, die eine Gepäckaufbewahrung benötigen oder unseren Service bewerben und Provision verdienen möchten, sind Sie herzlich willkommen. Melden Sie sich noch heute an und erhalten Sie 10 % Provision auf jede generierte Buchung.",
    "Can I customize the service to fit my business needs?": "Kann ich den Service an mein Unternehmen anpassen?",
    "Yes, there are various customisation features depending on the type of collaboration, such as white-label options.": "Ja, je nach Art der Zusammenarbeit gibt es verschiedene Anpassungsmöglichkeiten, zum Beispiel White-Label-Optionen.",
    "Are there marketing and promotional opportunities for partners?": "Gibt es Marketing- und Promotionsmöglichkeiten für Partner?",
    "How can I stay informed about updates and changes in the partnership program?": "Wie bleibe ich über Aktualisierungen und Änderungen des Partnerprogramms informiert?",
    "Usually, we don't make any changes once you set up your account, but for any small changes or updates we will keep you posted via email.": "Normalerweise nehmen wir nach der Einrichtung Ihres Kontos keine Änderungen vor. Sollte es kleinere Anpassungen oder Updates geben, informieren wir Sie per E-Mail.",
    "Do the affiliates/partners need to sign any contract/collaboration agreement?": "Müssen Affiliates/Partner einen Vertrag oder eine Vereinbarung unterschreiben?",
    "The only thing you have to do is accept the T&Cs once you sign up as an affiliate. If you need a contract, we can create one depending on your needs.": "Sie müssen lediglich die AGB akzeptieren, sobald Sie sich als Affiliate registrieren. Falls Sie einen Vertrag benötigen, können wir diesen nach Ihren Anforderungen erstellen.",
    "How does customer support work?": "Wie funktioniert der Kundensupport?",
    "Could the booking be made for a few days and not only hours?": "Kann eine Buchung auch für mehrere Tage und nicht nur Stunden erfolgen?",
    "Yes, you can leave your bags for a few minutes up to a whole year.": "Ja, Sie können Ihr Gepäck von wenigen Minuten bis zu einem ganzen Jahr abgeben.",
    "How do the Stashpoints know that they have received a booking?": "Woher wissen die Stashpoints, dass sie eine Buchung erhalten haben?",
    "All of our partners get a confirmation email and an update instantly once you place your booking. So you can rest assured that the location will be waiting for you.": "Alle unsere Partner erhalten unmittelbar nach Ihrer Buchung eine Bestätigungs-E-Mail und eine Aktualisierung. Sie können sich also darauf verlassen, dass der Standort auf Sie wartet.",
    "Program": "Programm",
    "Company Type": "Unternehmensart",
    "Personal Info": "Persönliche Daten",
    "Company Details": "Unternehmensdetails",
    "Final Step": "Letzter Schritt",
    "Choose your preferred currency": "Wählen Sie Ihre bevorzugte Währung",
    "US Dollar": "US-Dollar",
    "Euro": "Euro",
    "British Pound": "Britisches Pfund",
    "Australian Dollar": "Australischer Dollar",
    "Back to Home": "Zurück zur Startseite",
    "Continue": "Weiter",
    "What Type of Company Are You?": "Welche Art von Unternehmen sind Sie?",
    "Select the option that best describes your business": "Wählen Sie die Option, die Ihr Unternehmen am besten beschreibt.",
    "I want to store bags (Supply)": "Ich möchte Gepäck lagern (Supply)",
    "Store bags and earn money for every bag you store.": "Lagern Sie Gepäck und verdienen Sie an jeder Aufbewahrung.",
    "Vacation Rental / Airbnb Host": "Ferienvermietung / Airbnb-Gastgeber",
    "Short-term rental property management and Airbnb Hosts.": "Kurzzeitvermietungen und Airbnb-Gastgeber.",
    "PMS": "PMS",
    "Property Management System provider": "Anbieter eines Property-Management-Systems",
    "Venue": "Veranstaltungsort",
    "Museums, Stadiums, Theatres, Musical Events, etc.": "Museen, Stadien, Theater, Konzerte usw.",
    "Blog": "Blog",
    "Travel blog or content creator": "Reiseblog oder Content Creator",
    "Other": "Andere",
    "Other business type": "Andere Unternehmensart",
    "Tour Operator": "Reiseveranstalter",
    "Transportations": "Transportdienste",
    "Back": "Zurück",
    "Personal Information": "Persönliche Angaben",
    "Tell us about yourself": "Erzählen Sie uns von sich.",
    "First Name *": "Vorname *",
    "Last Name *": "Nachname *",
    "Email *": "E-Mail *",
    "Password *": "Passwort *",
    "Minimum 8 characters": "Mindestens 8 Zeichen",
    "Company Details": "Unternehmensdetails",
    "Tell us about your company": "Erzählen Sie uns von Ihrem Unternehmen.",
    "City *": "Stadt *",
    "Country *": "Land *",
    "Company Name *": "Firmenname *",
    "Company Name *": "Firmenname *",
    "Commission type *": "Provisionstyp *",
    "Select commission type": "Provisionstyp auswählen",
    "10% commission": "10% Provision",
    "10% discount code": "10% Rabattcode",
    "Custom": "Individuell",
    "Company Website": "Firmenwebsite",
    "Number of Properties": "Anzahl der Immobilien",
    "Company Description": "Firmenbeschreibung",
    "Name": "Name",
    "Email": "E-Mail",
    "Company Name": "Firmenname",
    "Location": "Standort",
    "Website": "Website",
    "Description": "Beschreibung",
    "Final Step – Almost There!": "Letzter Schritt – fast geschafft!",
    "Book a free demo call to get personalized onboarding.": "Buchen Sie ein kostenloses Demo-Gespräch für ein persönliches Onboarding.",
    "Book a Demo Call": "Demo-Termin buchen",
    "Get a free personalized onboarding and learn how to maximize your earnings with Stasher.": "Erhalten Sie ein kostenloses persönliches Onboarding und erfahren Sie, wie Sie Ihre Einnahmen mit Stasher maximieren.",
    "Summary": "Zusammenfassung",
    "I don't want a demo call — I'll set up Stasher by myself": "Ich möchte kein Demo-Gespräch – ich richte Stasher selbst ein",
    "Welcome to Stasher Partners!": "Willkommen bei Stasher Partners!",
    "Your account has been successfully created.": "Ihr Konto wurde erfolgreich erstellt.",
    "We've sent a confirmation email to:": "Wir haben eine Bestätigungs-E-Mail gesendet an:",
    "This email contains your unique referral link and instructions for adding it to your guest communications.": "Diese E-Mail enthält Ihren individuellen Empfehlungslink und Anweisungen für Ihre Gästekommunikation.",
    "Go to dashboard": "Zum Dashboard",
    "Return home": "Zurück zur Startseite",
    "Helping hospitality partners create effortless luggage storage experiences for their guests.": "Wir helfen Hospitality-Partnern, ihren Gästen mühelose Gepäckaufbewahrung zu bieten.",
    "How it works": "So funktioniert es",
    "Get started": "Jetzt starten",
    "Book a demo": "Demo buchen",
    "Company": "Unternehmen",
    "About Stasher": "Über Stasher",
    "I want to store bags": "Ich möchte Gepäck lagern",
    "Support": "Support",
    "Help center": "Hilfe-Center",
    "Contact": "Kontakt",
    "Terms & Conditions": "Allgemeine Geschäftsbedingungen",
    "© Stasher Ltd. All rights reserved.": "© Stasher Ltd. Alle Rechte vorbehalten."
};

const PLACEHOLDER_TRANSLATIONS_DE = {
    "Enter your first name": "Geben Sie Ihren Vornamen ein",
    "Enter your last name": "Geben Sie Ihren Nachnamen ein",
    "your.email@example.com": "ihre.email@beispiel.com",
    "Enter a secure password": "Geben Sie ein sicheres Passwort ein",
    "e.g. London, New York, Paris": "z. B. London, New York, Paris",
    "Start typing to find your country": "Beginnen Sie zu tippen, um Ihr Land zu finden",
    "Enter your company name": "Geben Sie Ihren Firmennamen ein",
    "https://www.example.com": "https://www.beispiel.com",
    "e.g. 5, 10, 20": "z. B. 5, 10, 20",
    "Tell us about your company, what you do, and how you help your clients...": "Beschreiben Sie Ihr Unternehmen, was Sie tun und wie Sie Ihren Kunden helfen..."
};

const TEXT_TRANSLATIONS_FR = {
    "Join Stasher's Affiliate Program": "Rejoignez le programme d'affiliation Stasher",
    "Help your guests or clients store their bags and receive extra revenue, higher customer satisfaction, and better reviews.": "Aidez vos invités ou clients à stocker leurs bagages et recevez des revenus supplémentaires, une meilleure satisfaction client et de meilleures évaluations.",
    "Totally Free to Join": "Entièrement gratuit",
    "Takes Less Than 1 Minute": "Moins d'une minute",
    "Get Started Now": "Commencer maintenant",
    "Get started now": "Commencer maintenant",
    "Already have an account?": "Vous avez déjà un compte ?",
    "Login": "Connexion",
    "Built for": "Conçu pour",
    "Airbnb hosts": "Hôtes Airbnb",
    "Travel blogs": "Blogs de voyage",
    "Venues": "Lieux",
    "Transportation": "Transport",
    "STRs": "Locations courtes durées",
    "Travel apps": "Applications de voyage",
    "City guides": "Guides de ville",
    "Events": "Événements",
    "Why should you join the program?": "Pourquoi rejoindre le programme ?",
    "Extra Revenue Stream": "Source de revenus supplémentaire",
    "Receive 10% commission for every booking you generate via your referral link.": "Recevez 10 % de commission pour chaque réservation générée via votre lien de parrainage.",
    "Customer Satisfaction": "Satisfaction client",
    "Provide your guests or clients with a helpful service and make them happy.": "Offrez à vos invités ou clients un service utile et rendez-les heureux.",
    "Global Coverage": "Couverture mondiale",
    "Stasher is live with thousands of locations in more than 1,190 cities globally.": "Stasher est disponible dans des milliers d'emplacements dans plus de 1 190 villes dans le monde.",
    "How does it work?": "Comment ça marche ?",
    "Sign up for free": "Inscription gratuite",
    "Create your account in under a minute. Fill out the form and you're ready to go.": "Créez votre compte en moins d'une minute. Remplissez le formulaire et c'est parti.",
    "Receive your link": "Recevez votre lien",
    "Get your referral link, discount code, and dashboard access. Everything is stored in your dashboard.": "Obtenez votre lien de parrainage, code de réduction et accès au tableau de bord. Tout est stocké dans votre tableau de bord.",
    "Share Stasher": "Partagez Stasher",
    "Share your link with customers through messages, guides, emails, or FAQs.": "Partagez votre lien avec vos clients via des messages, guides, e-mails ou FAQ.",
    "Partnerships": "Partenariats",
    "Trusted by top brands": "Approuvé par les grandes marques",
    "Leading hospitality and travel companies trust Stasher to provide seamless luggage storage solutions for their customers.": "Les principales entreprises d'hôtellerie et de voyage font confiance à Stasher pour offrir des solutions de stockage de bagages sans faille à leurs clients.",
    "Stasher in the Media": "Stasher dans les médias",
    "Trusted by the travel industry's leading voices": "Approuvé par les voix de référence de l'industrie du voyage",
    "Leading outlets highlight how Stasher helps hosts, property managers, and venues offer seamless baggage storage.": "Les principaux médias mettent en évidence comment Stasher aide les hôtes, gestionnaires de biens et lieux à offrir un stockage de bagages sans faille.",
    "“A simple way for hospitality brands to add a valuable guest benefit.”": "“Une façon simple pour les marques hôtelières d'ajouter un avantage précieux pour les invités.”",
    "— Forbes": "— Forbes",
    "“Stasher bridges the gap between travelers and local businesses in minutes.”": "“Stasher comble le fossé entre les voyageurs et les entreprises locales en quelques minutes.”",
    "— TechCrunch": "— TechCrunch",
    "“Hosts boost revenue while keeping their guests delighted and stress-free.”": "“Les hôtes augmentent leurs revenus tout en gardant leurs invités ravis et sans stress.”",
    "— BBC Travel": "— BBC Travel",
    "Check our locations": "Consultez nos emplacements",
    "Find secure luggage storage near you in just a few clicks.": "Trouvez un stockage de bagages sécurisé près de chez vous en quelques clics.",
    "View locations": "Voir les emplacements",
    "Secure & convenient locations": "Emplacements sécurisés et pratiques",
    "Millions of bags stored safely": "Des millions de bagages stockés en toute sécurité",
    "Excellent reviews": "Excellentes évaluations",
    "Available 24/7": "Disponible 24h/24 et 7j/7",
    "Frequently Asked Questions": "Questions fréquemment posées",
    "Is it free to open an affiliate account?": "Est-ce gratuit d'ouvrir un compte d'affilié ?",
    "Yes, it totally free.": "Oui, c'est entièrement gratuit.",
    "Can I track bookings and performance?": "Puis-je suivre les réservations et les performances ?",
    "Yes, once you sign up, you will receive an email with the login page to access your personal dashboard, where you can track clicks, conversions, CVR, and much more!": "Oui, une fois inscrit, vous recevrez un e-mail avec la page de connexion pour accéder à votre tableau de bord personnel, où vous pouvez suivre les clics, conversions, CVR et bien plus encore !",
    "Where can I find my referral link or coupon code?": "Où puis-je trouver mon lien de parrainage ou code promo ?",
    "You can find your referral link or coupon code in the email you received once your account is approved (it takes a few hours to 1 day since you signed up) or via your personal dashboard.": "Vous pouvez trouver votre lien de parrainage ou code promo dans l'e-mail reçu une fois votre compte approuvé (cela prend quelques heures à 1 jour depuis votre inscription) ou via votre tableau de bord personnel.",
    "How and when do I get paid my commission?": "Comment et quand suis-je payé ma commission ?",
    "In order to receive your commission, you have to enter your bank details by logging in to your dashboard (see instructions here). The commission is paid every month (the minimum threshold is 10 EUR / GBP / USD for the payout; if it is not met, you will receive the payment on the next payment until you reach the threshold).": "Pour recevoir votre commission, vous devez saisir vos coordonnées bancaires en vous connectant à votre tableau de bord (voir les instructions ici). La commission est payée chaque mois (le seuil minimum est de 10 EUR / GBP / USD pour le paiement ; s'il n'est pas atteint, vous recevrez le paiement au prochain versement jusqu'à atteindre le seuil).",
    "Can I appear on your website as a partner?": "Puis-je apparaître sur votre site Web en tant que partenaire ?",
    "Will I need to do a lot of administrative work?": "Devrai-je faire beaucoup de travail administratif ?",
    "Certainly Not! The process is quite straightforward and efficient. It only takes a few minutes to set up. You simply need to add your referral link and coupon code to your guest communications. This can be done through various channels such as emails, your website, or any other relevant platform. Once this is done, you're all set and ready to go. There's minimal administrative work involved, making it a hassle-free addition to your communication strategy.": "Absolument pas ! Le processus est simple et efficace. Il ne faut que quelques minutes pour le configurer. Il vous suffit d'ajouter votre lien de parrainage et votre code promo à vos communications avec les invités. Cela peut être fait via divers canaux tels que les e-mails, votre site Web ou toute autre plateforme pertinente. Une fois cela fait, tout est prêt. Il y a un minimum de travail administratif, ce qui en fait un ajout sans tracas à votre stratégie de communication.",
    "What criteria does Stasher consider for potential partners?": "Quels critères Stasher considère-t-il pour les partenaires potentiels ?",
    "There are no specific criteria to consider for potential partners, if you have customers who need luggage storage or want to promote our service and gain commission, you are welcome. Sign up today and receive a 10% commission on every booking you generate.": "Il n'y a pas de critères spécifiques pour les partenaires potentiels. Si vous avez des clients qui ont besoin de stockage de bagages ou souhaitent promouvoir notre service et gagner une commission, vous êtes les bienvenus. Inscrivez-vous dès aujourd'hui et recevez 10 % de commission sur chaque réservation que vous générez.",
    "Can I customize the service to fit my business needs?": "Puis-je personnaliser le service pour répondre aux besoins de mon entreprise ?",
    "Yes, there are various customisation features depending on the type of collaboration, such as white-label options.": "Oui, il existe diverses fonctionnalités de personnalisation selon le type de collaboration, telles que les options white-label.",
    "Are there marketing and promotional opportunities for partners?": "Y a-t-il des opportunités marketing et promotionnelles pour les partenaires ?",
    "How can I stay informed about updates and changes in the partnership program?": "Comment puis-je rester informé des mises à jour et changements du programme de partenariat ?",
    "Usually, we don't make any changes once you set up your account, but for any small changes or updates we will keep you posted via email.": "Généralement, nous n'apportons aucune modification une fois votre compte configuré, mais pour tout petit changement ou mise à jour, nous vous tiendrons informé par e-mail.",
    "Do the affiliates/partners need to sign any contract/collaboration agreement?": "Les affiliés/partenaires doivent-ils signer un contrat/accord de collaboration ?",
    "The only thing you have to do is accept the T&Cs once you sign up as an affiliate. If you need a contract, we can create one depending on your needs.": "La seule chose à faire est d'accepter les CGU une fois inscrit en tant qu'affilié. Si vous avez besoin d'un contrat, nous pouvons en créer un selon vos besoins.",
    "How does customer support work?": "Comment fonctionne le support client ?",
    "Could the booking be made for a few days and not only hours?": "La réservation peut-elle être faite pour plusieurs jours et pas seulement des heures ?",
    "Yes, you can leave your bags for a few minutes up to a whole year.": "Oui, vous pouvez laisser vos bagages de quelques minutes à une année entière.",
    "How do the Stashpoints know that they have received a booking?": "Comment les Stashpoints savent-ils qu'ils ont reçu une réservation ?",
    "All of our partners get a confirmation email and an update instantly once you place your booking. So you can rest assured that the location will be waiting for you.": "Tous nos partenaires reçoivent un e-mail de confirmation et une mise à jour instantanément une fois votre réservation effectuée. Vous pouvez donc être sûr que l'emplacement vous attendra.",
    "Program": "Programme",
    "Company Type": "Type d'entreprise",
    "Personal Info": "Informations personnelles",
    "Company Details": "Détails de l'entreprise",
    "Final Step": "Étape finale",
    "Choose your preferred currency": "Choisissez votre devise préférée",
    "US Dollar": "Dollar américain",
    "Euro": "Euro",
    "British Pound": "Livre sterling",
    "Australian Dollar": "Dollar australien",
    "Back to Home": "Retour à l'accueil",
    "Continue": "Continuer",
    "What Type of Company Are You?": "Quel type d'entreprise êtes-vous ?",
    "Select the option that best describes your business": "Sélectionnez l'option qui décrit le mieux votre entreprise",
    "I want to store bags (Supply)": "Je veux stocker des bagages (Supply)",
    "Store bags and earn money for every bag you store.": "Stockez des bagages et gagnez de l'argent pour chaque bagage stocké.",
    "Vacation Rental / Airbnb Host": "Location de vacances / Hôte Airbnb",
    "Short-term rental property management and Airbnb Hosts.": "Gestion de locations de courte durée et hôtes Airbnb.",
    "PMS": "PMS",
    "Property Management System provider": "Fournisseur de système de gestion de propriétés",
    "Venue": "Lieu",
    "Museums, Stadiums, Theatres, Musical Events, etc.": "Musées, stades, théâtres, événements musicaux, etc.",
    "Blog": "Blog",
    "Travel blog or content creator": "Blog de voyage ou créateur de contenu",
    "Other": "Autre",
    "Other business type": "Autre type d'entreprise",
    "Tour Operator": "Tour-opérateur",
    "Transportations": "Transports",
    "Back": "Retour",
    "Personal Information": "Informations personnelles",
    "Tell us about yourself": "Parlez-nous de vous",
    "First Name *": "Prénom *",
    "Last Name *": "Nom *",
    "Email *": "E-mail *",
    "Password *": "Mot de passe *",
    "Minimum 8 characters": "Minimum 8 caractères",
    "Company Details": "Détails de l'entreprise",
    "Tell us about your company": "Parlez-nous de votre entreprise",
    "City *": "Ville *",
    "Country *": "Pays *",
    "Company Name *": "Nom de l'entreprise *",
    "Commission type *": "Type de commission *",
    "Select commission type": "Sélectionner le type de commission",
    "10% commission": "10 % de commission",
    "10% discount code": "10 % de code de réduction",
    "Custom": "Personnalisé",
    "Company Website": "Site Web de l'entreprise",
    "Number of Properties": "Nombre de propriétés",
    "Company Description": "Description de l'entreprise",
    "Name": "Nom",
    "Email": "E-mail",
    "Company Name": "Nom de l'entreprise",
    "Location": "Emplacement",
    "Website": "Site Web",
    "Description": "Description",
    "Final Step – Almost There!": "Étape finale – presque terminé !",
    "Book a free demo call to get personalized onboarding.": "Réservez un appel de démonstration gratuit pour un onboarding personnalisé.",
    "Book a Demo Call": "Réserver un appel de démonstration",
    "Get a free personalized onboarding and learn how to maximize your earnings with Stasher.": "Obtenez un onboarding personnalisé gratuit et apprenez à maximiser vos revenus avec Stasher.",
    "Summary": "Résumé",
    "I don't want a demo call — I'll set up Stasher by myself": "Je ne veux pas d'appel de démonstration — je configurerai Stasher moi-même",
    "Welcome to Stasher Partners!": "Bienvenue chez Stasher Partners !",
    "Your account has been successfully created.": "Votre compte a été créé avec succès.",
    "We've sent a confirmation email to:": "Nous avons envoyé un e-mail de confirmation à :",
    "This email contains your unique referral link and instructions for adding it to your guest communications.": "Cet e-mail contient votre lien de parrainage unique et les instructions pour l'ajouter à vos communications avec les invités.",
    "Go to dashboard": "Aller au tableau de bord",
    "Return home": "Retour à l'accueil",
    "Helping hospitality partners create effortless luggage storage experiences for their guests.": "Aider les partenaires hôteliers à créer des expériences de stockage de bagages sans effort pour leurs invités.",
    "How it works": "Comment ça marche",
    "Get started": "Commencer",
    "Book a demo": "Réserver une démo",
    "Company": "Entreprise",
    "About Stasher": "À propos de Stasher",
    "I want to store bags": "Je veux stocker des bagages",
    "Support": "Support",
    "Help center": "Centre d'aide",
    "Contact": "Contact",
    "Terms & Conditions": "Conditions générales",
    "© Stasher Ltd. All rights reserved.": "© Stasher Ltd. Tous droits réservés."
};

const PLACEHOLDER_TRANSLATIONS_FR = {
    "Enter your first name": "Entrez votre prénom",
    "Enter your last name": "Entrez votre nom",
    "your.email@example.com": "votre.email@exemple.com",
    "Enter a secure password": "Entrez un mot de passe sécurisé",
    "e.g. London, New York, Paris": "ex. Londres, New York, Paris",
    "Start typing to find your country": "Commencez à taper pour trouver votre pays",
    "Enter your company name": "Entrez le nom de votre entreprise",
    "https://www.example.com": "https://www.exemple.com",
    "e.g. 5, 10, 20": "ex. 5, 10, 20",
    "Tell us about your company, what you do, and how you help your clients...": "Parlez-nous de votre entreprise, ce que vous faites et comment vous aidez vos clients..."
};

const TEXT_TRANSLATIONS_ES = {
    "Join Stasher's Affiliate Program": "Únete al programa de afiliados de Stasher",
    "Help your guests or clients store their bags and receive extra revenue, higher customer satisfaction, and better reviews.": "Ayuda a tus huéspedes o clientes a guardar sus maletas y recibe ingresos adicionales, mayor satisfacción del cliente y mejores reseñas.",
    "Totally Free to Join": "Totalmente gratis",
    "Takes Less Than 1 Minute": "Menos de 1 minuto",
    "Get Started Now": "Comenzar ahora",
    "Get started now": "Comenzar ahora",
    "Already have an account?": "¿Ya tienes una cuenta?",
    "Login": "Iniciar sesión",
    "Built for": "Creado para",
    "Airbnb hosts": "Anfitriones de Airbnb",
    "Travel blogs": "Blogs de viajes",
    "Venues": "Lugares",
    "Transportation": "Transporte",
    "STRs": "Alquileres de corta duración",
    "Travel apps": "Aplicaciones de viajes",
    "City guides": "Guías de ciudades",
    "Events": "Eventos",
    "Why should you join the program?": "¿Por qué deberías unirte al programa?",
    "Extra Revenue Stream": "Fuente de ingresos adicional",
    "Receive 10% commission for every booking you generate via your referral link.": "Recibe un 10% de comisión por cada reserva que generes a través de tu enlace de referencia.",
    "Customer Satisfaction": "Satisfacción del cliente",
    "Provide your guests or clients with a helpful service and make them happy.": "Proporciona a tus huéspedes o clientes un servicio útil y hazlos felices.",
    "Global Coverage": "Cobertura global",
    "Stasher is live with thousands of locations in more than 1,190 cities globally.": "Stasher está activo con miles de ubicaciones en más de 1.190 ciudades en todo el mundo.",
    "How does it work?": "¿Cómo funciona?",
    "Sign up for free": "Regístrate gratis",
    "Create your account in under a minute. Fill out the form and you're ready to go.": "Crea tu cuenta en menos de un minuto. Completa el formulario y estarás listo.",
    "Receive your link": "Recibe tu enlace",
    "Get your referral link, discount code, and dashboard access. Everything is stored in your dashboard.": "Obtén tu enlace de referencia, código de descuento y acceso al panel. Todo se almacena en tu panel.",
    "Share Stasher": "Comparte Stasher",
    "Share your link with customers through messages, guides, emails, or FAQs.": "Comparte tu enlace con los clientes a través de mensajes, guías, correos electrónicos o preguntas frecuentes.",
    "Partnerships": "Asociaciones",
    "Trusted by top brands": "Con la confianza de las principales marcas",
    "Leading hospitality and travel companies trust Stasher to provide seamless luggage storage solutions for their customers.": "Las principales empresas de hostelería y viajes confían en Stasher para ofrecer soluciones de almacenamiento de equipaje sin problemas a sus clientes.",
    "Stasher in the Media": "Stasher en los medios",
    "Trusted by the travel industry's leading voices": "Con la confianza de las voces líderes de la industria de viajes",
    "Leading outlets highlight how Stasher helps hosts, property managers, and venues offer seamless baggage storage.": "Los principales medios destacan cómo Stasher ayuda a anfitriones, administradores de propiedades y lugares a ofrecer almacenamiento de equipaje sin problemas.",
    "“A simple way for hospitality brands to add a valuable guest benefit.”": "“Una forma sencilla para que las marcas de hostelería agreguen un beneficio valioso para los huéspedes.”",
    "— Forbes": "— Forbes",
    "“Stasher bridges the gap between travelers and local businesses in minutes.”": "“Stasher cierra la brecha entre viajeros y empresas locales en minutos.”",
    "— TechCrunch": "— TechCrunch",
    "“Hosts boost revenue while keeping their guests delighted and stress-free.”": "“Los anfitriones aumentan los ingresos mientras mantienen a sus huéspedes encantados y sin estrés.”",
    "— BBC Travel": "— BBC Travel",
    "Check our locations": "Consulta nuestras ubicaciones",
    "Find secure luggage storage near you in just a few clicks.": "Encuentra almacenamiento seguro de equipaje cerca de ti con solo unos clics.",
    "View locations": "Ver ubicaciones",
    "Secure & convenient locations": "Ubicaciones seguras y convenientes",
    "Millions of bags stored safely": "Millones de maletas almacenadas de forma segura",
    "Excellent reviews": "Reseñas excelentes",
    "Available 24/7": "Disponible 24/7",
    "Frequently Asked Questions": "Preguntas frecuentes",
    "Is it free to open an affiliate account?": "¿Es gratis abrir una cuenta de afiliado?",
    "Yes, it totally free.": "Sí, es totalmente gratis.",
    "Can I track bookings and performance?": "¿Puedo rastrear reservas y rendimiento?",
    "Yes, once you sign up, you will receive an email with the login page to access your personal dashboard, where you can track clicks, conversions, CVR, and much more!": "¡Sí, una vez que te registres, recibirás un correo electrónico con la página de inicio de sesión para acceder a tu panel personal, donde puedes rastrear clics, conversiones, CVR y mucho más!",
    "Where can I find my referral link or coupon code?": "¿Dónde puedo encontrar mi enlace de referencia o código de cupón?",
    "You can find your referral link or coupon code in the email you received once your account is approved (it takes a few hours to 1 day since you signed up) or via your personal dashboard.": "Puedes encontrar tu enlace de referencia o código de cupón en el correo electrónico que recibiste una vez que tu cuenta sea aprobada (tarda unas horas a 1 día desde que te registraste) o a través de tu panel personal.",
    "How and when do I get paid my commission?": "¿Cómo y cuándo recibo el pago de mi comisión?",
    "In order to receive your commission, you have to enter your bank details by logging in to your dashboard (see instructions here). The commission is paid every month (the minimum threshold is 10 EUR / GBP / USD for the payout; if it is not met, you will receive the payment on the next payment until you reach the threshold).": "Para recibir tu comisión, debes ingresar los datos de tu banco iniciando sesión en tu panel (ver instrucciones aquí). La comisión se paga cada mes (el umbral mínimo es de 10 EUR / GBP / USD para el pago; si no se alcanza, recibirás el pago en el próximo pago hasta alcanzar el umbral).",
    "Can I appear on your website as a partner?": "¿Puedo aparecer en su sitio web como socio?",
    "Will I need to do a lot of administrative work?": "¿Necesitaré hacer mucho trabajo administrativo?",
    "Certainly Not! The process is quite straightforward and efficient. It only takes a few minutes to set up. You simply need to add your referral link and coupon code to your guest communications. This can be done through various channels such as emails, your website, or any other relevant platform. Once this is done, you're all set and ready to go. There's minimal administrative work involved, making it a hassle-free addition to your communication strategy.": "¡Por supuesto que no! El proceso es bastante sencillo y eficiente. Solo toma unos minutos configurarlo. Simplemente necesitas agregar tu enlace de referencia y código de cupón a tus comunicaciones con los huéspedes. Esto se puede hacer a través de varios canales como correos electrónicos, tu sitio web o cualquier otra plataforma relevante. Una vez hecho esto, todo está listo. Hay un trabajo administrativo mínimo involucrado, lo que lo convierte en una adición sin complicaciones a tu estrategia de comunicación.",
    "What criteria does Stasher consider for potential partners?": "¿Qué criterios considera Stasher para los socios potenciales?",
    "There are no specific criteria to consider for potential partners, if you have customers who need luggage storage or want to promote our service and gain commission, you are welcome. Sign up today and receive a 10% commission on every booking you generate.": "No hay criterios específicos para considerar para los socios potenciales. Si tienes clientes que necesitan almacenamiento de equipaje o quieres promocionar nuestro servicio y ganar comisión, eres bienvenido. Regístrate hoy y recibe un 10% de comisión por cada reserva que generes.",
    "Can I customize the service to fit my business needs?": "¿Puedo personalizar el servicio para adaptarlo a las necesidades de mi negocio?",
    "Yes, there are various customisation features depending on the type of collaboration, such as white-label options.": "Sí, hay varias funciones de personalización según el tipo de colaboración, como opciones de marca blanca.",
    "Are there marketing and promotional opportunities for partners?": "¿Hay oportunidades de marketing y promoción para los socios?",
    "How can I stay informed about updates and changes in the partnership program?": "¿Cómo puedo mantenerme informado sobre actualizaciones y cambios en el programa de asociación?",
    "Usually, we don't make any changes once you set up your account, but for any small changes or updates we will keep you posted via email.": "Por lo general, no hacemos ningún cambio una vez que configuras tu cuenta, pero para cualquier cambio pequeño o actualización te mantendremos informado por correo electrónico.",
    "Do the affiliates/partners need to sign any contract/collaboration agreement?": "¿Los afiliados/socios necesitan firmar algún contrato/acuerdo de colaboración?",
    "The only thing you have to do is accept the T&Cs once you sign up as an affiliate. If you need a contract, we can create one depending on your needs.": "Lo único que tienes que hacer es aceptar los Términos y Condiciones una vez que te registres como afiliado. Si necesitas un contrato, podemos crear uno según tus necesidades.",
    "How does customer support work?": "¿Cómo funciona el soporte al cliente?",
    "Could the booking be made for a few days and not only hours?": "¿Se puede hacer la reserva por varios días y no solo por horas?",
    "Yes, you can leave your bags for a few minutes up to a whole year.": "Sí, puedes dejar tus maletas desde unos minutos hasta un año completo.",
    "How do the Stashpoints know that they have received a booking?": "¿Cómo saben los Stashpoints que han recibido una reserva?",
    "All of our partners get a confirmation email and an update instantly once you place your booking. So you can rest assured that the location will be waiting for you.": "Todos nuestros socios reciben un correo electrónico de confirmación y una actualización instantáneamente una vez que realizas tu reserva. Así que puedes estar seguro de que la ubicación te estará esperando.",
    "Program": "Programa",
    "Company Type": "Tipo de empresa",
    "Personal Info": "Información personal",
    "Company Details": "Detalles de la empresa",
    "Final Step": "Paso final",
    "Choose your preferred currency": "Elige tu moneda preferida",
    "US Dollar": "Dólar estadounidense",
    "Euro": "Euro",
    "British Pound": "Libra esterlina",
    "Australian Dollar": "Dólar australiano",
    "Back to Home": "Volver al inicio",
    "Continue": "Continuar",
    "What Type of Company Are You?": "¿Qué tipo de empresa eres?",
    "Select the option that best describes your business": "Selecciona la opción que mejor describa tu negocio",
    "I want to store bags (Supply)": "Quiero almacenar maletas (Oferta)",
    "Store bags and earn money for every bag you store.": "Almacena maletas y gana dinero por cada maleta que almacenes.",
    "Vacation Rental / Airbnb Host": "Alquiler vacacional / Anfitrión de Airbnb",
    "Short-term rental property management and Airbnb Hosts.": "Gestión de propiedades de alquiler de corta duración y anfitriones de Airbnb.",
    "PMS": "PMS",
    "Property Management System provider": "Proveedor de sistema de gestión de propiedades",
    "Venue": "Lugar",
    "Museums, Stadiums, Theatres, Musical Events, etc.": "Museos, estadios, teatros, eventos musicales, etc.",
    "Blog": "Blog",
    "Travel blog or content creator": "Blog de viajes o creador de contenido",
    "Other": "Otro",
    "Other business type": "Otro tipo de negocio",
    "Tour Operator": "Operador turístico",
    "Transportations": "Transportes",
    "Back": "Atrás",
    "Personal Information": "Información personal",
    "Tell us about yourself": "Cuéntanos sobre ti",
    "First Name *": "Nombre *",
    "Last Name *": "Apellido *",
    "Email *": "Correo electrónico *",
    "Password *": "Contraseña *",
    "Minimum 8 characters": "Mínimo 8 caracteres",
    "Company Details": "Detalles de la empresa",
    "Tell us about your company": "Cuéntanos sobre tu empresa",
    "City *": "Ciudad *",
    "Country *": "País *",
    "Company Name *": "Nombre de la empresa *",
    "Commission type *": "Tipo de comisión *",
    "Select commission type": "Seleccionar tipo de comisión",
    "10% commission": "10% de comisión",
    "10% discount code": "10% de código de descuento",
    "Custom": "Personalizado",
    "Company Website": "Sitio web de la empresa",
    "Number of Properties": "Número de propiedades",
    "Company Description": "Descripción de la empresa",
    "Name": "Nombre",
    "Email": "Correo electrónico",
    "Company Name": "Nombre de la empresa",
    "Location": "Ubicación",
    "Website": "Sitio web",
    "Description": "Descripción",
    "Final Step – Almost There!": "¡Paso final - casi terminado!",
    "Book a free demo call to get personalized onboarding.": "Reserva una llamada de demostración gratuita para obtener una incorporación personalizada.",
    "Book a Demo Call": "Reservar una llamada de demostración",
    "Get a free personalized onboarding and learn how to maximize your earnings with Stasher.": "Obtén una incorporación personalizada gratuita y aprende cómo maximizar tus ganancias con Stasher.",
    "Summary": "Resumen",
    "I don't want a demo call — I'll set up Stasher by myself": "No quiero una llamada de demostración — configuraré Stasher yo mismo",
    "Welcome to Stasher Partners!": "¡Bienvenido a Stasher Partners!",
    "Your account has been successfully created.": "Tu cuenta ha sido creada exitosamente.",
    "We've sent a confirmation email to:": "Hemos enviado un correo electrónico de confirmación a:",
    "This email contains your unique referral link and instructions for adding it to your guest communications.": "Este correo electrónico contiene tu enlace de referencia único e instrucciones para agregarlo a tus comunicaciones con los huéspedes.",
    "Go to dashboard": "Ir al panel",
    "Return home": "Volver al inicio",
    "Helping hospitality partners create effortless luggage storage experiences for their guests.": "Ayudando a los socios de hostelería a crear experiencias de almacenamiento de equipaje sin esfuerzo para sus huéspedes.",
    "How it works": "Cómo funciona",
    "Get started": "Comenzar",
    "Book a demo": "Reservar una demostración",
    "Company": "Empresa",
    "About Stasher": "Acerca de Stasher",
    "I want to store bags": "Quiero almacenar maletas",
    "Support": "Soporte",
    "Help center": "Centro de ayuda",
    "Contact": "Contacto",
    "Terms & Conditions": "Términos y condiciones",
    "© Stasher Ltd. All rights reserved.": "© Stasher Ltd. Todos los derechos reservados."
};

const TEXT_TRANSLATIONS_IT = {
    "Join Stasher's Affiliate Program": "Unisciti al programma di affiliazione Stasher",
    "Help your guests or clients store their bags and receive extra revenue, higher customer satisfaction, and better reviews.": "Aiuta i tuoi ospiti o clienti a conservare i bagagli e ricevi entrate extra, maggiore soddisfazione del cliente e recensioni migliori.",
    "Totally Free to Join": "Completamente gratuito",
    "Takes Less Than 1 Minute": "Meno di 1 minuto",
    "Get Started Now": "Inizia ora",
    "Get started now": "Inizia ora",
    "Already have an account?": "Hai già un account?",
    "Login": "Accedi",
    "Built for": "Creato per",
    "Airbnb hosts": "Host Airbnb",
    "Travel blogs": "Blog di viaggio",
    "Venues": "Luoghi",
    "Transportation": "Trasporti",
    "STRs": "Affitti a breve termine",
    "Travel apps": "App di viaggio",
    "City guides": "Guide della città",
    "Events": "Eventi",
    "Why should you join the program?": "Perché dovresti unirti al programma?",
    "Extra Revenue Stream": "Fonte di entrate aggiuntiva",
    "Receive 10% commission for every booking you generate via your referral link.": "Ricevi una commissione del 10% per ogni prenotazione che generi tramite il tuo link di riferimento.",
    "Customer Satisfaction": "Soddisfazione del cliente",
    "Provide your guests or clients with a helpful service and make them happy.": "Fornisci ai tuoi ospiti o clienti un servizio utile e rendili felici.",
    "Global Coverage": "Copertura globale",
    "Stasher is live with thousands of locations in more than 1,190 cities globally.": "Stasher è attivo con migliaia di ubicazioni in più di 1.190 città in tutto il mondo.",
    "How does it work?": "Come funziona?",
    "Sign up for free": "Registrati gratuitamente",
    "Create your account in under a minute. Fill out the form and you're ready to go.": "Crea il tuo account in meno di un minuto. Compila il modulo e sei pronto.",
    "Receive your link": "Ricevi il tuo link",
    "Get your referral link, discount code, and dashboard access. Everything is stored in your dashboard.": "Ottieni il tuo link di riferimento, codice sconto e accesso alla dashboard. Tutto è memorizzato nella tua dashboard.",
    "Share Stasher": "Condividi Stasher",
    "Share your link with customers through messages, guides, emails, or FAQs.": "Condividi il tuo link con i clienti tramite messaggi, guide, email o FAQ.",
    "Partnerships": "Partnership",
    "Trusted by top brands": "Fidato dai principali brand",
    "Leading hospitality and travel companies trust Stasher to provide seamless luggage storage solutions for their customers.": "Le principali aziende di ospitalità e viaggi si fidano di Stasher per fornire soluzioni di deposito bagagli senza problemi ai loro clienti.",
    "Stasher in the Media": "Stasher nei media",
    "Trusted by the travel industry's leading voices": "Fidato dalle voci leader dell'industria dei viaggi",
    "Leading outlets highlight how Stasher helps hosts, property managers, and venues offer seamless baggage storage.": "I principali media evidenziano come Stasher aiuta host, gestori di proprietà e luoghi a offrire deposito bagagli senza problemi.",
    "“A simple way for hospitality brands to add a valuable guest benefit.”": "“Un modo semplice per i brand dell'ospitalità di aggiungere un vantaggio prezioso per gli ospiti.”",
    "— Forbes": "— Forbes",
    "“Stasher bridges the gap between travelers and local businesses in minutes.”": "“Stasher colma il divario tra viaggiatori e aziende locali in pochi minuti.”",
    "— TechCrunch": "— TechCrunch",
    "“Hosts boost revenue while keeping their guests delighted and stress-free.”": "“Gli host aumentano i ricavi mantenendo i loro ospiti felici e senza stress.”",
    "— BBC Travel": "— BBC Travel",
    "Check our locations": "Controlla le nostre ubicazioni",
    "Find secure luggage storage near you in just a few clicks.": "Trova deposito bagagli sicuro vicino a te con pochi clic.",
    "View locations": "Visualizza ubicazioni",
    "Secure & convenient locations": "Ubicazioni sicure e convenienti",
    "Millions of bags stored safely": "Milioni di bagagli conservati in sicurezza",
    "Excellent reviews": "Recensioni eccellenti",
    "Available 24/7": "Disponibile 24/7",
    "Frequently Asked Questions": "Domande frequenti",
    "Is it free to open an affiliate account?": "È gratuito aprire un account affiliato?",
    "Yes, it totally free.": "Sì, è completamente gratuito.",
    "Can I track bookings and performance?": "Posso tracciare prenotazioni e prestazioni?",
    "Yes, once you sign up, you will receive an email with the login page to access your personal dashboard, where you can track clicks, conversions, CVR, and much more!": "Sì, una volta registrato, riceverai un'email con la pagina di accesso per accedere alla tua dashboard personale, dove puoi tracciare clic, conversioni, CVR e molto altro!",
    "Where can I find my referral link or coupon code?": "Dove posso trovare il mio link di riferimento o codice coupon?",
    "You can find your referral link or coupon code in the email you received once your account is approved (it takes a few hours to 1 day since you signed up) or via your personal dashboard.": "Puoi trovare il tuo link di riferimento o codice coupon nell'email che hai ricevuto una volta che il tuo account è stato approvato (ci vogliono poche ore a 1 giorno da quando ti sei registrato) o tramite la tua dashboard personale.",
    "How and when do I get paid my commission?": "Come e quando ricevo il pagamento della mia commissione?",
    "In order to receive your commission, you have to enter your bank details by logging in to your dashboard (see instructions here). The commission is paid every month (the minimum threshold is 10 EUR / GBP / USD for the payout; if it is not met, you will receive the payment on the next payment until you reach the threshold).": "Per ricevere la tua commissione, devi inserire i dettagli bancari accedendo alla tua dashboard (vedi istruzioni qui). La commissione viene pagata ogni mese (la soglia minima è di 10 EUR / GBP / USD per il pagamento; se non viene raggiunta, riceverai il pagamento al prossimo pagamento fino a raggiungere la soglia).",
    "Can I appear on your website as a partner?": "Posso apparire sul tuo sito web come partner?",
    "Will I need to do a lot of administrative work?": "Dovrò fare molto lavoro amministrativo?",
    "Certainly Not! The process is quite straightforward and efficient. It only takes a few minutes to set up. You simply need to add your referral link and coupon code to your guest communications. This can be done through various channels such as emails, your website, or any other relevant platform. Once this is done, you're all set and ready to go. There's minimal administrative work involved, making it a hassle-free addition to your communication strategy.": "Assolutamente no! Il processo è abbastanza semplice ed efficiente. Ci vogliono solo pochi minuti per configurarlo. Devi semplicemente aggiungere il tuo link di riferimento e codice coupon alle tue comunicazioni con gli ospiti. Questo può essere fatto tramite vari canali come email, il tuo sito web o qualsiasi altra piattaforma rilevante. Una volta fatto, sei pronto. C'è un lavoro amministrativo minimo coinvolto, rendendolo un'aggiunta senza problemi alla tua strategia di comunicazione.",
    "What criteria does Stasher consider for potential partners?": "Quali criteri considera Stasher per i potenziali partner?",
    "There are no specific criteria to consider for potential partners, if you have customers who need luggage storage or want to promote our service and gain commission, you are welcome. Sign up today and receive a 10% commission on every booking you generate.": "Non ci sono criteri specifici da considerare per i potenziali partner. Se hai clienti che necessitano di deposito bagagli o vuoi promuovere il nostro servizio e guadagnare commissioni, sei il benvenuto. Registrati oggi e ricevi una commissione del 10% su ogni prenotazione che generi.",
    "Can I customize the service to fit my business needs?": "Posso personalizzare il servizio per adattarlo alle esigenze della mia attività?",
    "Yes, there are various customisation features depending on the type of collaboration, such as white-label options.": "Sì, ci sono varie funzionalità di personalizzazione a seconda del tipo di collaborazione, come opzioni white-label.",
    "Are there marketing and promotional opportunities for partners?": "Ci sono opportunità di marketing e promozione per i partner?",
    "How can I stay informed about updates and changes in the partnership program?": "Come posso rimanere informato su aggiornamenti e modifiche al programma di partnership?",
    "Usually, we don't make any changes once you set up your account, but for any small changes or updates we will keep you posted via email.": "Di solito, non apportiamo modifiche una volta configurato il tuo account, ma per eventuali piccole modifiche o aggiornamenti ti terremo informato via email.",
    "Do the affiliates/partners need to sign any contract/collaboration agreement?": "Gli affiliati/partner devono firmare qualche contratto/accordo di collaborazione?",
    "The only thing you have to do is accept the T&Cs once you sign up as an affiliate. If you need a contract, we can create one depending on your needs.": "L'unica cosa che devi fare è accettare i Termini e Condizioni una volta registrato come affiliato. Se hai bisogno di un contratto, possiamo crearne uno in base alle tue esigenze.",
    "How does customer support work?": "Come funziona il supporto clienti?",
    "Could the booking be made for a few days and not only hours?": "La prenotazione può essere fatta per alcuni giorni e non solo per ore?",
    "Yes, you can leave your bags for a few minutes up to a whole year.": "Sì, puoi lasciare i tuoi bagagli da pochi minuti fino a un anno intero.",
    "How do the Stashpoints know that they have received a booking?": "Come fanno i Stashpoints a sapere che hanno ricevuto una prenotazione?",
    "All of our partners get a confirmation email and an update instantly once you place your booking. So you can rest assured that the location will be waiting for you.": "Tutti i nostri partner ricevono un'email di conferma e un aggiornamento istantaneamente una volta effettuata la prenotazione. Quindi puoi stare certo che la ubicazione ti aspetterà.",
    "Program": "Programma",
    "Company Type": "Tipo di azienda",
    "Personal Info": "Informazioni personali",
    "Company Details": "Dettagli dell'azienda",
    "Final Step": "Passo finale",
    "Choose your preferred currency": "Scegli la tua valuta preferita",
    "US Dollar": "Dollaro statunitense",
    "Euro": "Euro",
    "British Pound": "Sterlina britannica",
    "Australian Dollar": "Dollaro australiano",
    "Back to Home": "Torna alla home",
    "Continue": "Continua",
    "What Type of Company Are You?": "Che tipo di azienda sei?",
    "Select the option that best describes your business": "Seleziona l'opzione che meglio descrive la tua attività",
    "I want to store bags (Supply)": "Voglio conservare bagagli (Fornitura)",
    "Store bags and earn money for every bag you store.": "Conserva bagagli e guadagna denaro per ogni bagaglio che conservi.",
    "Vacation Rental / Airbnb Host": "Affitto vacanze / Host Airbnb",
    "Short-term rental property management and Airbnb Hosts.": "Gestione di proprietà in affitto a breve termine e Host Airbnb.",
    "PMS": "PMS",
    "Property Management System provider": "Fornitore di sistema di gestione proprietà",
    "Venue": "Luogo",
    "Museums, Stadiums, Theatres, Musical Events, etc.": "Musei, stadi, teatri, eventi musicali, ecc.",
    "Blog": "Blog",
    "Travel blog or content creator": "Blog di viaggio o creatore di contenuti",
    "Other": "Altro",
    "Other business type": "Altro tipo di attività",
    "Tour Operator": "Tour operator",
    "Transportations": "Trasporti",
    "Back": "Indietro",
    "Personal Information": "Informazioni personali",
    "Tell us about yourself": "Raccontaci di te",
    "First Name *": "Nome *",
    "Last Name *": "Cognome *",
    "Email *": "Email *",
    "Password *": "Password *",
    "Minimum 8 characters": "Minimo 8 caratteri",
    "Company Details": "Dettagli dell'azienda",
    "Tell us about your company": "Raccontaci della tua azienda",
    "City *": "Città *",
    "Country *": "Paese *",
    "Company Name *": "Nome dell'azienda *",
    "Commission type *": "Tipo di commissione *",
    "Select commission type": "Seleziona tipo di commissione",
    "10% commission": "10% di commissione",
    "10% discount code": "10% di codice sconto",
    "Custom": "Personalizzato",
    "Company Website": "Sito web dell'azienda",
    "Number of Properties": "Numero di proprietà",
    "Company Description": "Descrizione dell'azienda",
    "Name": "Nome",
    "Email": "Email",
    "Company Name": "Nome dell'azienda",
    "Location": "Ubicazione",
    "Website": "Sito web",
    "Description": "Descrizione",
    "Final Step – Almost There!": "Passo finale – quasi fatto!",
    "Book a free demo call to get personalized onboarding.": "Prenota una chiamata demo gratuita per ottenere un onboarding personalizzato.",
    "Book a Demo Call": "Prenota una chiamata demo",
    "Get a free personalized onboarding and learn how to maximize your earnings with Stasher.": "Ottieni un onboarding personalizzato gratuito e impara come massimizzare i tuoi guadagni con Stasher.",
    "Summary": "Riepilogo",
    "I don't want a demo call — I'll set up Stasher by myself": "Non voglio una chiamata demo — configurerò Stasher da solo",
    "Welcome to Stasher Partners!": "Benvenuto in Stasher Partners!",
    "Your account has been successfully created.": "Il tuo account è stato creato con successo.",
    "We've sent a confirmation email to:": "Abbiamo inviato un'email di conferma a:",
    "This email contains your unique referral link and instructions for adding it to your guest communications.": "Questa email contiene il tuo link di riferimento unico e le istruzioni per aggiungerlo alle tue comunicazioni con gli ospiti.",
    "Go to dashboard": "Vai alla dashboard",
    "Return home": "Torna alla home",
    "Helping hospitality partners create effortless luggage storage experiences for their guests.": "Aiutare i partner dell'ospitalità a creare esperienze di deposito bagagli senza sforzo per i loro ospiti.",
    "How it works": "Come funziona",
    "Get started": "Inizia",
    "Book a demo": "Prenota una demo",
    "Company": "Azienda",
    "About Stasher": "Informazioni su Stasher",
    "I want to store bags": "Voglio conservare bagagli",
    "Support": "Supporto",
    "Help center": "Centro assistenza",
    "Contact": "Contatto",
    "Terms & Conditions": "Termini e condizioni",
    "© Stasher Ltd. All rights reserved.": "© Stasher Ltd. Tutti i diritti riservati."
};

const PLACEHOLDER_TRANSLATIONS_ES = {
    "Enter your first name": "Ingresa tu nombre",
    "Enter your last name": "Ingresa tu apellido",
    "your.email@example.com": "tu.email@ejemplo.com",
    "Enter a secure password": "Ingresa una contraseña segura",
    "e.g. London, New York, Paris": "ej. Londres, Nueva York, París",
    "Start typing to find your country": "Comienza a escribir para encontrar tu país",
    "Enter your company name": "Ingresa el nombre de tu empresa",
    "https://www.example.com": "https://www.ejemplo.com",
    "e.g. 5, 10, 20": "ej. 5, 10, 20",
    "Tell us about your company, what you do, and how you help your clients...": "Cuéntanos sobre tu empresa, qué haces y cómo ayudas a tus clientes..."
};

const PLACEHOLDER_TRANSLATIONS_IT = {
    "Enter your first name": "Inserisci il tuo nome",
    "Enter your last name": "Inserisci il tuo cognome",
    "your.email@example.com": "tua.email@esempio.com",
    "Enter a secure password": "Inserisci una password sicura",
    "e.g. London, New York, Paris": "es. Londra, New York, Parigi",
    "Start typing to find your country": "Inizia a digitare per trovare il tuo paese",
    "Enter your company name": "Inserisci il nome della tua azienda",
    "https://www.example.com": "https://www.esempio.com",
    "e.g. 5, 10, 20": "es. 5, 10, 20",
    "Tell us about your company, what you do, and how you help your clients...": "Raccontaci della tua azienda, cosa fai e come aiuti i tuoi clienti..."
};

const HTML_TRANSLATIONS = [
    {
        selector: '.faq-item:nth-child(5) .faq-answer p',
        de: 'Das hängt von der Art Ihres Unternehmens ab, aber Sie können jederzeit unter <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a> nach verfügbaren Möglichkeiten fragen.',
        fr: 'Cela dépend du type d\'entreprise, mais vous pouvez toujours contacter <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a> pour voir quelles opportunités sont disponibles.',
        es: 'Depende del tipo de empresa, pero siempre puedes contactar <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a> para ver qué oportunidades están disponibles.',
        it: 'Dipende dal tipo di azienda, ma puoi sempre contattare <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a> per vedere quali opportunità sono disponibili.'
    },
    {
        selector: '.faq-item:nth-child(9) .faq-answer p',
        de: 'Ja, wir bieten Marketing- und Promotion-Möglichkeiten für unsere Partner an. Weitere Informationen erhalten Sie unter <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>.',
        fr: 'Oui, nous offrons des opportunités marketing et promotionnelles à nos partenaires. Pour plus d\'informations, veuillez contacter <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>.',
        es: 'Sí, ofrecemos oportunidades de marketing y promoción para nuestros socios. Para más información, contacta <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>.',
        it: 'Sì, offriamo opportunità di marketing e promozione per i nostri partner. Per maggiori informazioni, contatta <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>.'
    },
    {
        selector: '.faq-item:nth-child(12) .faq-answer p',
        de: 'Der Kundensupport ist rund um die Uhr per Telefon, Chat oder E-Mail erreichbar. Sie können den Support <a href="https://stasher.com/support" target="_blank">hier</a> kontaktieren.',
        fr: 'Le support client fonctionne 24h/24 et 7j/7 par téléphone, chat ou e-mail. Vous pouvez contacter le support <a href="https://stasher.com/support" target="_blank">ici</a>.',
        es: 'El soporte al cliente está disponible las 24 horas del día, los 7 días de la semana por teléfono, chat o correo electrónico. Puedes contactar al soporte <a href="https://stasher.com/support" target="_blank">aquí</a>.',
        it: 'Il supporto clienti è disponibile 24 ore su 24, 7 giorni su 7 tramite telefono, chat o email. Puoi contattare il supporto <a href="https://stasher.com/support" target="_blank">qui</a>.'
    },
    {
        selector: '.confirmation-support',
        de: 'Brauchen Sie Hilfe? Schreiben Sie an <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>',
        fr: 'Besoin d\'aide ? Envoyez un e-mail à <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>',
        es: '¿Necesitas ayuda? Envía un correo electrónico a <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>',
        it: 'Hai bisogno di aiuto? Invia un\'email a <a href="mailto:partnerships@stasher.com">partnerships@stasher.com</a>'
    },
    {
        selector: 'label[for="companyWebsite"]',
        de: 'Firmenwebsite <span class="optional">(optional)</span>',
        fr: 'Site Web de l\'entreprise <span class="optional">(optionnel)</span>',
        es: 'Sitio web de la empresa <span class="optional">(opcional)</span>',
        it: 'Sito web dell\'azienda <span class="optional">(opzionale)</span>'
    },
    {
        selector: 'label[for="numberOfProperties"]',
        de: 'Anzahl der Immobilien <span class="optional">(optional, nur für STRs)</span>',
        fr: 'Nombre de propriétés <span class="optional">(optionnel, uniquement pour les STR)</span>',
        es: 'Número de propiedades <span class="optional">(opcional, solo para STR)</span>',
        it: 'Numero di proprietà <span class="optional">(opzionale, solo per STR)</span>'
    },
    {
        selector: 'label[for="companyWebsite2"]',
        de: 'Firmenwebsite <span class="optional">(optional)</span>',
        fr: 'Site Web de l\'entreprise <span class="optional">(optionnel)</span>',
        es: 'Sitio web de la empresa <span class="optional">(opcional)</span>',
        it: 'Sito web dell\'azienda <span class="optional">(opzionale)</span>'
    },
    {
        selector: 'label[for="companyDescription"]',
        de: 'Firmenbeschreibung <span class="optional">(optional)</span>',
        fr: 'Description de l\'entreprise <span class="optional">(optionnel)</span>',
        es: 'Descripción de la empresa <span class="optional">(opcional)</span>',
        it: 'Descrizione dell\'azienda <span class="optional">(opzionale)</span>'
    }
];

const VALIDATION_TRANSLATIONS = {
    selectCountry: {
        en: 'Please select a country from the list',
        de: 'Bitte wählen Sie ein Land aus der Liste aus',
        fr: 'Veuillez sélectionner un pays dans la liste',
        es: 'Por favor selecciona un país de la lista',
        it: 'Si prega di selezionare un paese dall\'elenco'
    }
};

const textTranslationRegistry = {};
const placeholderTranslationRegistry = {};
const htmlTranslationRegistry = [];

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    const urlLanguage = getLanguageFromURL();
    if (urlLanguage) {
        formState.language = urlLanguage;
    }
    initializeLandingPage();
    initializeForm();
    populateCountries();
    setupEventListeners();
    setupProgressBarNavigation();
    initI18n();
    setupInPageAnchorLinks();
});

/**
 * Handle in-page #anchor links via JS scroll. Required because we set
 * <base href="/"> in index.html so relative asset URLs work from /<lang>/
 * paths, which would otherwise turn href="#section" into "/#section".
 */
function setupInPageAnchorLinks() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        const rawHref = link.getAttribute('href');
        if (!rawHref || rawHref === '#') return;
        const targetId = rawHref.slice(1);
        if (!targetId) return;
        link.addEventListener('click', function(e) {
            const target = document.getElementById(targetId);
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// Initialize Landing Page
function initializeLandingPage() {
    const startSignupBtn = document.getElementById('startSignupBtn');
    if (startSignupBtn) {
        startSignupBtn.addEventListener('click', function() {
            showSignupForm();
        });
    }

    const startSignupBtnSecondary = document.getElementById('startSignupBtnSecondary');
    if (startSignupBtnSecondary) {
        startSignupBtnSecondary.addEventListener('click', function() {
            showSignupForm();
        });
    }

    // Get started button in "How does it work?" section
    const getStartedHowItWorks = document.getElementById('getStartedHowItWorks');
    if (getStartedHowItWorks) {
        getStartedHowItWorks.addEventListener('click', function() {
            showSignupForm();
        });
    }

    // Final "Get started now" button after FAQs
    const finalGetStartedBtn = document.getElementById('finalGetStartedBtn');
    if (finalGetStartedBtn) {
        finalGetStartedBtn.addEventListener('click', function() {
            showSignupForm();
        });
    }

    const footerStartSignup = document.getElementById('footerStartSignup');
    if (footerStartSignup) {
        footerStartSignup.addEventListener('click', function(e) {
            e.preventDefault();
            showSignupForm();
        });
    }

    const footerYear = document.getElementById('footerYear');
    if (footerYear) {
        footerYear.textContent = new Date().getFullYear();
    }

    // Logo click - redirect to stasher.com
const logoLink = document.getElementById('logoLink');
if (logoLink) {
    logoLink.addEventListener('click', function () {
        window.location.href = 'https://stasher.com/';
    });
}

    // Initialize FAQs toggle functionality
    initializeFAQs();

    // Initialize "Built For" section redirects
    initializeBuiltForRedirects();
}

// Initialize FAQs Toggle Functionality
function initializeFAQs() {
    const faqQuestions = document.querySelectorAll('.faq-question');
    
    faqQuestions.forEach(question => {
        question.addEventListener('click', function() {
            const faqItem = this.closest('.faq-item');
            const isActive = faqItem.classList.contains('active');
            
            // Close all other FAQ items (optional - remove if you want multiple open)
            document.querySelectorAll('.faq-item').forEach(item => {
                if (item !== faqItem) {
                    item.classList.remove('active');
                    item.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
                }
            });
            
            // Toggle current FAQ item
            if (isActive) {
                faqItem.classList.remove('active');
                this.setAttribute('aria-expanded', 'false');
            } else {
                faqItem.classList.add('active');
                this.setAttribute('aria-expanded', 'true');
            }
        });
    });
}

// Show Signup Form (hide landing page)
function showSignupForm() {
    const landingPage = document.getElementById('landingPage');
    const progressContainer = document.getElementById('progressContainer');
    const formContainer = document.getElementById('formContainer');
    
    if (landingPage) {
        landingPage.style.display = 'none';
    }
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
    if (formContainer) {
        formContainer.style.display = 'block';
    }
    
    // Start on Page 1 (Company Type)
    formState.currentPage = 1;
    showPage(1);
    updateProgressBar(1);
    updateContinueButton(1);
    persistSignupFlowState();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Redirect to Page 2 with preselected company type
function redirectToPage2WithCompanyType(companyType) {
    // Set the company type in form state
    formState.companyType = companyType;
    
    // Show the signup form
    const landingPage = document.getElementById('landingPage');
    const progressContainer = document.getElementById('progressContainer');
    const formContainer = document.getElementById('formContainer');
    
    if (landingPage) {
        landingPage.style.display = 'none';
    }
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
    if (formContainer) {
        formContainer.style.display = 'block';
    }
    
    // Visually select the company type box on Page 1
    document.querySelectorAll('.company-type-box').forEach(box => {
        box.classList.remove('selected');
        if (box.dataset.type === companyType) {
            box.classList.add('selected');
        }
    });
    
    // Skip to Page 2 (Program Selection)
    formState.currentPage = 2;
    showPage(2);
    updateProgressBar(2);
    updateContinueButton(2);
    persistSignupFlowState();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize "Built For" section redirects
function initializeBuiltForRedirects() {
    document.querySelectorAll('.company-type-item[data-redirect-type]').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', function() {
            const companyType = this.dataset.redirectType;
            redirectToPage2WithCompanyType(companyType);
        });
    });
}

// Go back to landing page (from signup form)
function goBackToLandingPage() {
    const landingPage = document.getElementById('landingPage');
    const progressContainer = document.getElementById('progressContainer');
    const formContainer = document.getElementById('formContainer');
    
    if (landingPage) {
        landingPage.style.display = 'block';
    }
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    if (formContainer) {
        formContainer.style.display = 'none';
    }
    
    // Reset form to page 1
    formState.currentPage = 1;
    showPage(1);
    updateProgressBar(1);
    updateContinueButton(1);
    clearSignupFlowState();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize Form
function initializeForm() {
    if (restoreSignupFlow()) {
        return;
    }

    // Start on Page 1 (now Company Type)
    showPage(1);
    updateProgressBar(1);
    updateContinueButton(1);
}

// Populate Country Lists
function populateCountries() {
    const datalist = document.getElementById('countryOptions');
    if (!datalist) return;
    datalist.innerHTML = '';
    countries.forEach(country => {
        const option = document.createElement('option');
        option.value = country;
        datalist.appendChild(option);
    });
}

function setupCountryInputs() {
    const countryInputs = [document.getElementById('country'), document.getElementById('country2')];
    countryInputs.forEach(input => {
        setupCountryInput(input);
    });
}

function setupCountryInput(input) {
    if (!input) return;
    ['input', 'change', 'blur'].forEach(eventType => {
        input.addEventListener(eventType, function() {
            validateCountryInput(input);
            updateContinueButton(4);
        });
    });
    validateCountryInput(input);
}

function validateCountryInput(input) {
    if (!input) return false;
    const value = input.value.trim();
    if (value === '') {
        input.setCustomValidity(getValidationMessage('selectCountry'));
        // Update formState based on which input this is
        if (input.id === 'country') {
            formState.country = '';
        } else if (input.id === 'country2') {
            formState.country = '';
        }
        updateContinueButton(4);
        return false;
    }
    if (countries.includes(value)) {
        input.setCustomValidity('');
        // Update formState based on which input this is
        if (input.id === 'country' || input.id === 'country2') {
            formState.country = value;
        }
        updateContinueButton(4);
        return true;
    } else {
        input.setCustomValidity(getValidationMessage('selectCountry'));
        // Update formState based on which input this is
        if (input.id === 'country') {
            formState.country = '';
        } else if (input.id === 'country2') {
            formState.country = '';
        }
        updateContinueButton(4);
        return false;
    }
}

// Setup Event Listeners
function setupEventListeners() {
    // Language Select
    const languageSelect = document.getElementById('languageSelect');
    const currentLanguageFlag = document.getElementById('currentLanguageFlag');

    // Sync the dropdown to the current language (e.g. when coming from ?lang=fr)
    if (formState.language && languageSelect.value !== formState.language) {
        languageSelect.value = formState.language;
    }

    // Update flag when language changes
    languageSelect.addEventListener('change', function(e) {
        formState.language = e.target.value;
        const selectedOption = e.target.options[e.target.selectedIndex];
        const flag = selectedOption.getAttribute('data-flag');
        if (flag && currentLanguageFlag) {
            currentLanguageFlag.textContent = flag;
        }
        applyTranslations(formState.language);
        updateLanguageInURL(formState.language);
    });

    // Initialize flag on page load
    const initialOption = languageSelect.options[languageSelect.selectedIndex];
    const initialFlag = initialOption.getAttribute('data-flag');
    if (initialFlag && currentLanguageFlag) {
        currentLanguageFlag.textContent = initialFlag;
    }

    // Page 2: Program Selection (now second step)
    document.querySelectorAll('.currency-box').forEach(box => {
        box.addEventListener('click', function() {
            document.querySelectorAll('.currency-box').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
            formState.program = this.dataset.currency;
            updateContinueButton(2);
            
            // Auto-advance to next page
            setTimeout(() => {
                if (validatePage2()) {
                    nextPage();
                }
            }, 300);
        });
    });

    // Terms Checkbox (moved to page 3)
    document.getElementById('acceptTerms').addEventListener('change', function(e) {
        formState.acceptTerms = e.target.checked;
        updateContinueButton(3);
    });

    // Terms & Conditions Modal
    const termsLink = document.getElementById('termsLink');
    const termsModal = document.getElementById('termsModal');
    const termsModalClose = document.getElementById('termsModalClose');
    const termsModalOverlay = document.getElementById('termsModalOverlay');

    if (termsLink) {
        termsLink.addEventListener('click', function(e) {
            e.preventDefault();
            openTermsModal();
        });
    }

    if (termsModalClose) {
        termsModalClose.addEventListener('click', function() {
            closeTermsModal();
        });
    }

    if (termsModalOverlay) {
        termsModalOverlay.addEventListener('click', function() {
            closeTermsModal();
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && termsModal && termsModal.classList.contains('active')) {
            closeTermsModal();
        }
    });

    // Page 1: Company Type (now first step)
    document.querySelectorAll('.company-type-box').forEach(box => {
        box.addEventListener('click', function() {
            document.querySelectorAll('.company-type-box').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
            formState.companyType = this.dataset.type;
            updateContinueButton(1);
            
            // Auto-advance to next page
            setTimeout(() => {
                if (validatePage1()) {
                    // Check if Supply was selected - redirect immediately
                    if (formState.companyType === 'supply') {
                        window.location.href = 'https://hosts.stasher.com/signup';
                        return;
                    }
                    nextPage();
                }
            }, 300);
        });
    });

    // Continue Button 1 (Company Type)
    document.getElementById('continueBtn1').addEventListener('click', function() {
        if (validatePage1()) {
            // Check if Supply was selected - redirect immediately
            if (formState.companyType === 'supply') {
                window.location.href = 'https://hosts.stasher.com/signup';
                return;
            }
            nextPage();
        }
    });

    // Back Button 1 - Go back to landing page
    const backBtn1 = document.getElementById('backBtn1');
    if (backBtn1) {
        backBtn1.addEventListener('click', function() {
            goBackToLandingPage();
        });
    }

    // Continue Button 2 (Program)
    document.getElementById('continueBtn2').addEventListener('click', function() {
        if (validatePage2()) {
            nextPage();
        }
    });

    // Back Button 2
    document.getElementById('backBtn2').addEventListener('click', function() {
        previousPage();
    });

    // Page 3: Personal Info
    const page3Inputs = ['firstName', 'lastName', 'email', 'password'];
    page3Inputs.forEach(field => {
        const input = document.getElementById(field);
        input.addEventListener('input', function() {
            formState[field] = this.value;
            updateContinueButton(3);
        });
    });

    // Continue Button 3
    document.getElementById('continueBtn3').addEventListener('click', function() {
        if (validatePage3()) {
            // Stage A: fire in background — don't block the user moving to page 4
            stageAPromise = createAffiliateAfterPage3().catch(error => {
                console.error('Error creating affiliate after Page 3:', error);
                // Final submission will fall back to legacy behavior
            });
            nextPage();
        }
    });

    // Back Button 3
    document.getElementById('backBtn3').addEventListener('click', function() {
        previousPage();
    });

    // Page 4: Company Details
    setupPage4Listeners();
    setupCountryInputs();

    // Continue Button 4
    document.getElementById('continueBtn4').addEventListener('click', function() {
        if (validatePage4()) {
            // commission_type is already sent in Stage B (finalize_affiliate), no extra call needed
            nextPage();
        }
    });

    // Back Button 4
    document.getElementById('backBtn4').addEventListener('click', function() {
        previousPage();
    });

    // Page 5: Final Step
    const bookDemoBtn = document.getElementById('bookDemoBtn');
    if (bookDemoBtn) {
        bookDemoBtn.addEventListener('click', function() {
            formState.wantsDemoCall = true;  // Track that user wants demo call
            window.location.href = 'https://cal.com/periklis/15min';
        });
    }

    // Use event delegation for skip demo link to ensure it works
    document.addEventListener('click', function(e) {
        const skipDemoLink = e.target.closest('#skipDemoLink');
        if (skipDemoLink) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Skip demo link clicked');
            formState.wantsDemoCall = false;  // Track that user doesn't want demo call
            handleSkipDemo();
        }
    });

    // Back Button 5
    const backBtn5 = document.getElementById('backBtn5');
    if (backBtn5) {
        backBtn5.addEventListener('click', function() {
            previousPage();
        });
    }

    const returnHomeBtn = document.getElementById('returnHomeBtn');
    if (returnHomeBtn) {
        returnHomeBtn.addEventListener('click', function() {
            goBackToLandingPage();
        });
    }

    document.addEventListener('input', function() {
        if (loadSignupFlowState()) {
            persistSignupFlowState();
        }
    });

    document.addEventListener('change', function() {
        if (loadSignupFlowState()) {
            persistSignupFlowState();
        }
    });
}

function initI18n() {
    cacheTextNodes();
    cachePlaceholderNodes();
    cacheHtmlBlocks();
    applyTranslations(formState.language);
}

function cacheTextNodes() {
    const englishKeys = Object.keys(TEXT_TRANSLATIONS_DE);
    const keySet = new Set(englishKeys);
    englishKeys.forEach(key => {
        textTranslationRegistry[key] = [];
    });
    const elements = document.querySelectorAll('body *');
    elements.forEach(el => {
        if (el.children.length === 0) {
            const textValue = el.textContent.trim();
            if (keySet.has(textValue)) {
                textTranslationRegistry[textValue].push(el);
                if (!el.dataset.i18nEn) {
                    el.dataset.i18nEn = textValue;
                }
            }
        }
    });
}

function cachePlaceholderNodes() {
    Object.keys(PLACEHOLDER_TRANSLATIONS_DE).forEach(english => {
        const selector = `[placeholder="${english.replace(/"/g, '\\"')}"]`;
        const elements = Array.from(document.querySelectorAll(selector));
        placeholderTranslationRegistry[english] = elements;
        elements.forEach(el => {
            if (!el.dataset.i18nPlaceholderEn) {
                el.dataset.i18nPlaceholderEn = english;
            }
        });
    });
}

function cacheHtmlBlocks() {
    HTML_TRANSLATIONS.forEach(entry => {
        const elements = Array.from(document.querySelectorAll(entry.selector));
        htmlTranslationRegistry.push({
            selector: entry.selector,
            elements,
            de: entry.de,
            fr: entry.fr,
            es: entry.es,
            it: entry.it
        });
        elements.forEach(el => {
            if (!el.dataset.i18nHtmlEn) {
                el.dataset.i18nHtmlEn = el.innerHTML;
            }
        });
    });
}

function applyTranslations(language) {
    const useGerman = language === 'de';
    const useFrench = language === 'fr';
    const useSpanish = language === 'es';
    const useItalian = language === 'it';
    Object.entries(textTranslationRegistry).forEach(([english, elements]) => {
        const translationDE = TEXT_TRANSLATIONS_DE[english];
        const translationFR = TEXT_TRANSLATIONS_FR[english];
        const translationES = TEXT_TRANSLATIONS_ES[english];
        const translationIT = TEXT_TRANSLATIONS_IT[english];
        elements.forEach(el => {
            const original = el.dataset.i18nEn || english;
            if (useGerman && translationDE) {
                el.textContent = translationDE;
            } else if (useFrench && translationFR) {
                el.textContent = translationFR;
            } else if (useSpanish && translationES) {
                el.textContent = translationES;
            } else if (useItalian && translationIT) {
                el.textContent = translationIT;
            } else {
                el.textContent = original;
            }
        });
    });

    Object.entries(placeholderTranslationRegistry).forEach(([english, elements]) => {
        const translationDE = PLACEHOLDER_TRANSLATIONS_DE[english];
        const translationFR = PLACEHOLDER_TRANSLATIONS_FR[english];
        const translationES = PLACEHOLDER_TRANSLATIONS_ES[english];
        const translationIT = PLACEHOLDER_TRANSLATIONS_IT[english];
        elements.forEach(el => {
            const original = el.dataset.i18nPlaceholderEn || english;
            if (useGerman && translationDE) {
                el.setAttribute('placeholder', translationDE);
            } else if (useFrench && translationFR) {
                el.setAttribute('placeholder', translationFR);
            } else if (useSpanish && translationES) {
                el.setAttribute('placeholder', translationES);
            } else if (useItalian && translationIT) {
                el.setAttribute('placeholder', translationIT);
            } else {
                el.setAttribute('placeholder', original);
            }
        });
    });

    htmlTranslationRegistry.forEach(entry => {
        entry.elements.forEach(el => {
            const original = el.dataset.i18nHtmlEn || el.innerHTML;
            if (useGerman && entry.de) {
                el.innerHTML = entry.de;
            } else if (useFrench && entry.fr) {
                el.innerHTML = entry.fr;
            } else if (useSpanish && entry.es) {
                el.innerHTML = entry.es;
            } else if (useItalian && entry.it) {
                el.innerHTML = entry.it;
            } else {
                el.innerHTML = original;
            }
        });
    });

    translateCheckboxText(language);
    translateFooterText(language);
    generateSummary();
}

function translateCheckboxText(language) {
    const checkboxText = document.querySelector('.checkbox-text');
    if (!checkboxText) return;
    const textNodes = Array.from(checkboxText.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
    if (textNodes.length > 0) {
        if (language === 'de') {
            textNodes[0].textContent = 'Ich akzeptiere die ';
        } else if (language === 'fr') {
            textNodes[0].textContent = 'J\'accepte les ';
        } else if (language === 'es') {
            textNodes[0].textContent = 'Acepto los ';
        } else if (language === 'it') {
            textNodes[0].textContent = 'Accetto i ';
        } else {
            textNodes[0].textContent = 'I accept the ';
        }
    }
    if (textNodes.length > 1) {
        textNodes[textNodes.length - 1].textContent = ' *';
    }
    const termsLink = checkboxText.querySelector('#termsLink');
    if (termsLink) {
        if (language === 'de') {
            termsLink.textContent = 'Allgemeine Geschäftsbedingungen';
        } else if (language === 'fr') {
            termsLink.textContent = 'Conditions générales';
        } else if (language === 'es') {
            termsLink.textContent = 'Términos y condiciones';
        } else if (language === 'it') {
            termsLink.textContent = 'Termini e condizioni';
        } else {
            termsLink.textContent = 'Terms & Conditions';
        }
    }
}

function translateFooterText(language) {
    const footerText = document.querySelector('.footer-bottom span');
    if (!footerText) return;
    const currentYear = new Date().getFullYear();
    if (language === 'de') {
        footerText.innerHTML = `© <span id="footerYear">${currentYear}</span> Stasher Ltd. Alle Rechte vorbehalten.`;
    } else if (language === 'fr') {
        footerText.innerHTML = `© <span id="footerYear">${currentYear}</span> Stasher Ltd. Tous droits réservés.`;
    } else if (language === 'es') {
        footerText.innerHTML = `© <span id="footerYear">${currentYear}</span> Stasher Ltd. Todos los derechos reservados.`;
    } else if (language === 'it') {
        footerText.innerHTML = `© <span id="footerYear">${currentYear}</span> Stasher Ltd. Tutti i diritti riservati.`;
    } else {
        footerText.innerHTML = `© <span id="footerYear">${currentYear}</span> Stasher Ltd. All rights reserved.`;
    }
}

function getValidationMessage(key) {
    const entry = VALIDATION_TRANSLATIONS[key];
    if (!entry) return '';
    if (formState.language === 'de') {
        return entry.de;
    } else if (formState.language === 'fr') {
        return entry.fr;
    } else if (formState.language === 'es') {
        return entry.es;
    } else if (formState.language === 'it') {
        return entry.it;
    }
    return entry.en;
}

function getTranslatedTextValue(englishText) {
    if (formState.language === 'de') {
        return TEXT_TRANSLATIONS_DE[englishText] || englishText;
    } else if (formState.language === 'fr') {
        return TEXT_TRANSLATIONS_FR[englishText] || englishText;
    } else if (formState.language === 'es') {
        return TEXT_TRANSLATIONS_ES[englishText] || englishText;
    } else if (formState.language === 'it') {
        return TEXT_TRANSLATIONS_IT[englishText] || englishText;
    }
    return englishText;
}

// Setup Page 4 Listeners
function setupPage4Listeners() {
    // Vacation Rental Fields
    const vacationRentalFields = ['city', 'companyName', 'companyWebsite', 'numberOfProperties'];
    vacationRentalFields.forEach(field => {
        const input = document.getElementById(field);
        if (input) {
            ['input', 'change'].forEach(evt => {
                input.addEventListener(evt, function() {
                    formState[field] = this.value;
                    updateContinueButton(4);
                });
            });
        }
    });

    // Commission Type for Vacation Rental
    const commissionType = document.getElementById('commissionType');
    if (commissionType) {
        commissionType.addEventListener('change', function() {
            formState.commissionType = this.value;
            updateContinueButton(4);
        });
    }

    // Other Fields (PMS, Venue, Blog, Other)
    const otherFields = ['city2', 'companyName2', 'companyWebsite2', 'companyDescription'];
    otherFields.forEach(field => {
        const input = document.getElementById(field);
        if (input) {
            ['input', 'change'].forEach(evt => {
                input.addEventListener(evt, function() {
                    // Map to formState
                    if (field === 'city2') formState.city = this.value;
                    if (field === 'companyName2') formState.companyName = this.value;
                    if (field === 'companyWebsite2') formState.companyWebsite = this.value;
                    if (field === 'companyDescription') formState.companyDescription = this.value;
                    updateContinueButton(4);
                });
            });
        }
    });

    // Commission Type for Other Fields
    const commissionType2 = document.getElementById('commissionType2');
    if (commissionType2) {
        commissionType2.addEventListener('change', function() {
            formState.commissionType = this.value;
            updateContinueButton(4);
        });
    }
}

// Page Navigation
function showPage(pageNumber) {
    document.querySelectorAll('.form-page').forEach(page => {
        page.classList.remove('active');
    });
    
    const pageElement = document.getElementById(`page${pageNumber}`);
    if (pageElement) {
        pageElement.classList.add('active');
    }

    // Show appropriate fields for page 4
    if (pageNumber === 4) {
        showPage4Fields();
    }

    // Generate summary for page 5
    if (pageNumber === 5) {
        generateSummary();
    }
}

function scrollToFormTop() {
    const progressContainer = document.getElementById('progressContainer');
    const target = progressContainer || document.getElementById('formContainer');
    if (target) {
        const offset = target.getBoundingClientRect().top + window.pageYOffset - 12;
        window.scrollTo({ top: Math.max(0, offset), behavior: 'instant' });
    } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

function nextPage() {
    if (formState.currentPage < 5) {
        formState.currentPage++;
        showPage(formState.currentPage);
        updateProgressBar(formState.currentPage);
        updateContinueButton(formState.currentPage);
        persistSignupFlowState();
        scrollToFormTop();
    }
}

function previousPage() {
    if (formState.currentPage > 1) {
        formState.currentPage--;
        showPage(formState.currentPage);
        updateProgressBar(formState.currentPage);
        updateContinueButton(formState.currentPage);
        persistSignupFlowState();
        scrollToFormTop();
    }
}

// Show Page 4 Fields Based on Company Type
function showPage4Fields() {
    const vacationRentalFields = document.getElementById('vacationRentalFields');
    const otherFields = document.getElementById('otherFields');
    const countrySelect = document.getElementById('country');
    const countrySelect2 = document.getElementById('country2');

    vacationRentalFields.style.display = 'none';
    otherFields.style.display = 'none';

    if (formState.companyType === 'vacation-rental') {
        vacationRentalFields.style.display = 'block';
        if (countrySelect) {
            countrySelect.value = formState.country || '';
            validateCountryInput(countrySelect);
        }
        // Sync commission type value
        const commissionType = document.getElementById('commissionType');
        if (commissionType && formState.commissionType) {
            commissionType.value = formState.commissionType;
        }
    } else if (['pms', 'venue', 'blog', 'tour-operator', 'transportations', 'other'].includes(formState.companyType)) {
        otherFields.style.display = 'block';
        // Sync commission type value
        const commissionType2 = document.getElementById('commissionType2');
        if (commissionType2 && formState.commissionType) {
            commissionType2.value = formState.commissionType;
        }
        if (countrySelect2) {
            countrySelect2.value = formState.country || '';
            validateCountryInput(countrySelect2);
        }
    }
}

// Setup Progress Bar Navigation
function setupProgressBarNavigation() {
    document.querySelectorAll('.progress-step').forEach((step) => {
        step.addEventListener('click', function() {
            const stepNumber = parseInt(this.dataset.step);
            const currentStep = formState.currentPage;
            
            // Only allow navigation to completed or current steps (not future steps)
            if (stepNumber <= currentStep) {
                navigateToStep(stepNumber);
            }
        });
    });
}

// Navigate to a specific step
function navigateToStep(stepNumber) {
    if (stepNumber >= 1 && stepNumber <= 5) {
        formState.currentPage = stepNumber;
        showPage(stepNumber);
        updateProgressBar(stepNumber);
        updateContinueButton(stepNumber);
        persistSignupFlowState();
    }
}

// Update Progress Bar
function updateProgressBar(currentStep) {
    document.querySelectorAll('.progress-step').forEach((step, index) => {
        const stepNumber = index + 1;
        const circle = step.querySelector('.step-circle');
        const line = step.querySelector('.progress-line');

        circle.classList.remove('active', 'completed');
        if (line) line.classList.remove('completed');
        step.classList.remove('clickable');

        if (stepNumber < currentStep) {
            circle.classList.add('completed');
            if (line) line.classList.add('completed');
            step.classList.add('clickable');
        } else if (stepNumber === currentStep) {
            circle.classList.add('active');
            step.classList.add('clickable');
        }
        // Future steps remain non-clickable (no clickable class added)
    });
}

// Update Continue Button State
function updateContinueButton(pageNumber) {
    let isValid = false;
    let button = null;

    switch(pageNumber) {
        case 1:
            isValid = formState.companyType !== null;
            button = document.getElementById('continueBtn1');
            break;
        case 2:
            isValid = formState.program !== null;
            button = document.getElementById('continueBtn2');
            break;
        case 3:
            isValid = formState.firstName.trim() !== '' &&
                     formState.lastName.trim() !== '' &&
                     formState.email.trim() !== '' &&
                     isValidEmail(formState.email) &&
                     formState.password.length >= 8 &&
                     formState.acceptTerms;
            button = document.getElementById('continueBtn3');
            break;
        case 4:
            let fieldsValid = false;
            if (formState.companyType === 'vacation-rental') {
                fieldsValid = formState.city.trim() !== '' &&
                         formState.country.trim() !== '' &&
                         formState.companyName.trim() !== '' &&
                         formState.commissionType.trim() !== '';
            } else if (['pms', 'venue', 'blog', 'tour-operator', 'transportations', 'other'].includes(formState.companyType)) {
                fieldsValid = formState.city.trim() !== '' &&
                         formState.country.trim() !== '' &&
                         formState.companyName.trim() !== '' &&
                         formState.commissionType.trim() !== '';
            }
            isValid = fieldsValid;
            button = document.getElementById('continueBtn4');
            break;
    }

    if (button) {
        button.disabled = !isValid;
    }
}

// Validation Functions
// Page 1: Company Type
function validatePage1() {
    return formState.companyType !== null;
}

// Page 2: Program Selection
function validatePage2() {
    return formState.program !== null;
}

function validatePage3() {
    return formState.firstName.trim() !== '' &&
           formState.lastName.trim() !== '' &&
           formState.email.trim() !== '' &&
           isValidEmail(formState.email) &&
           formState.password.length >= 8 &&
           formState.acceptTerms;
}

function validatePage4() {
    let fieldsValid = false;
    if (formState.companyType === 'vacation-rental') {
        fieldsValid = formState.city.trim() !== '' &&
               formState.country.trim() !== '' &&
               formState.companyName.trim() !== '' &&
               formState.commissionType.trim() !== '';
    } else if (['pms', 'venue', 'blog', 'tour-operator', 'transportations', 'other'].includes(formState.companyType)) {
        fieldsValid = formState.city.trim() !== '' &&
               formState.country.trim() !== '' &&
               formState.companyName.trim() !== '' &&
               formState.commissionType.trim() !== '';
    }
    return fieldsValid;
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Generate Summary
function generateSummary() {
    const summaryContent = document.getElementById('summaryContent');
    const companyTypeLabels = {
        'supply': getTranslatedTextValue('I want to store bags (Supply)'),
        'vacation-rental': getTranslatedTextValue('Vacation Rental / Airbnb Host'),
        'pms': getTranslatedTextValue('PMS'),
        'venue': getTranslatedTextValue('Venue'),
        'blog': getTranslatedTextValue('Blog'),
        'tour-operator': getTranslatedTextValue('Tour Operator'),
        'transportations': getTranslatedTextValue('Transportations'),
        'other': getTranslatedTextValue('Other')
    };

    let html = `
        <div class="summary-item">
            <span class="summary-label">${getTranslatedTextValue('Program')}:</span>
            <span>${formState.program}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">${getTranslatedTextValue('Company Type')}:</span>
            <span>${companyTypeLabels[formState.companyType] || formState.companyType}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">${getTranslatedTextValue('Name')}:</span>
            <span>${formState.firstName} ${formState.lastName}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">${getTranslatedTextValue('Email')}:</span>
            <span>${formState.email}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">${getTranslatedTextValue('Company Name')}:</span>
            <span>${formState.companyName}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">${getTranslatedTextValue('Location')}:</span>
            <span>${formState.city}, ${formState.country}</span>
        </div>
    `;

    if (formState.companyWebsite) {
        html += `
            <div class="summary-item">
                <span class="summary-label">${getTranslatedTextValue('Website')}:</span>
                <span>${formState.companyWebsite}</span>
            </div>
        `;
    }

    if (formState.numberOfProperties) {
        html += `
            <div class="summary-item">
                <span class="summary-label">${getTranslatedTextValue('Number of Properties')}:</span>
                <span>${formState.numberOfProperties}</span>
            </div>
        `;
    }

    if (formState.companyDescription) {
        html += `
            <div class="summary-item">
                <span class="summary-label">${getTranslatedTextValue('Description')}:</span>
                <span>${formState.companyDescription}</span>
            </div>
        `;
    }

    summaryContent.innerHTML = html;
}

// Handle Skip Demo
async function handleSkipDemo() {
    // Show confirmation page immediately — don't wait for the API call
    showConfirmationPage();

    // Fire enrollment in background
    createTapfiliateAffiliate().then(result => {
        if (result && result.success) {
            console.log('Form submitted successfully to Tapfiliate');
        } else {
            console.warn('Form submission to Tapfiliate had issues:', result);
        }
    }).catch(error => {
        console.error('Error submitting form to Tapfiliate:', error);
    });
}

// Show Confirmation Page
function showConfirmationPage() {
    console.log('showConfirmationPage called');
    clearSignupFlowState();
    
    // Hide landing page
    const landingPage = document.getElementById('landingPage');
    if (landingPage) {
        landingPage.style.display = 'none';
    }
    
    // Hide all form pages except confirmation
    document.querySelectorAll('.form-page').forEach(page => {
        page.classList.remove('active');
        if (page.id !== 'confirmationPage') {
            page.style.display = 'none';
        }
    });
    
    // Show form container
    const formContainer = document.getElementById('formContainer');
    if (formContainer) {
        formContainer.style.display = 'block';
    }
    
    // Show confirmation page
    const confirmationPage = document.getElementById('confirmationPage');
    if (confirmationPage) {
        confirmationPage.style.display = 'block';
        confirmationPage.classList.add('active');
        console.log('Confirmation page displayed');
    } else {
        console.error('Confirmation page element not found!');
    }
    
    // Update email in pill - convert to uppercase
    const confirmationEmail = document.getElementById('confirmationEmail');
    if (confirmationEmail) {
        const email = formState.email || 'your.email@example.com';
        confirmationEmail.textContent = email.toUpperCase();
    }
    
    // Hide progress bar
    const progressContainer = document.getElementById('progressContainer');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    
    updateProgressBar(5);
    
    // Scroll to top of page when confirmation page loads
    window.scrollTo({ top: 0, behavior: 'instant' });
    
    console.log('Confirmation page setup complete');
}

// Helper functions to show/hide loading overlay for Page 3 and Page 4
function showApiLoading() {
    const loadingOverlay = document.getElementById('apiLoadingOverlay');
    console.log('showApiLoading called, element found:', !!loadingOverlay);
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
        console.log('Loading overlay shown');
    } else {
        console.error('apiLoadingOverlay element not found!');
    }
}

function hideApiLoading() {
    const loadingOverlay = document.getElementById('apiLoadingOverlay');
    console.log('hideApiLoading called');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

// Stage A: Create affiliate as soon as Page 3 (personal info) is completed
async function createAffiliateAfterPage3() {
    // If we've already created an affiliate in this session, skip
    if (createdAffiliateId) {
        console.log('Affiliate already created after Page 3 with ID:', createdAffiliateId);
        return;
    }

    // Resolve parent_id with full fallback chain (URL > localStorage > field)
    const parentId = resolveParentId();
    console.log('[Tracking] Stage A parent_id resolved to:', parentId || '(none)');

    // Build minimal payload for Stage A
    const payload = {
        mode: 'create_affiliate_only',
        first_name: formState.firstName,
        last_name: formState.lastName,
        email: formState.email,
        password: formState.password,
        city: 'N/A',  // Will be updated later in Stage B
        country: 'GB',  // Default, will be updated later in Stage B
        company: 'N/A'  // Will be updated later in Stage B
    };

    // Add company_type if available (for custom fields)
    if (formState.companyType) {
        payload.company_type = formState.companyType;
    }

    // Add commission_type if available (for custom fields)
    if (formState.commissionType) {
        payload.commission_type = formState.commissionType;
    }

    // Add wantsDemoCall if available (for custom fields)
    payload.wantsDemoCall = formState.wantsDemoCall;

    // Add parent_id if present (for MLM functionality)
    if (parentId && parentId !== '' && parentId !== 'null') {
        payload.parent_id = parentId;
    }

    console.log('Stage A: Creating affiliate after Page 3 with payload:', JSON.stringify({ ...payload, password: '***MASKED***' }, null, 2));

    // Stage A runs silently in the background — no loading overlay so page 4 is immediately usable
    try {
        const response = await fetch(BACKEND_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const contentType = response.headers.get('content-type');
        const responseText = await response.text();

        if (!response.ok) {
            // Check if response is HTML (error page)
            if (contentType && contentType.includes('text/html')) {
                console.error('Stage A: Backend returned HTML error page instead of JSON');
                return; // Don't throw - allow fallback to legacy mode
            }

            let errorMessage = 'Failed to create affiliate';
            try {
                const errorData = JSON.parse(responseText);
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                console.error('Stage A: Could not parse error response:', responseText);
            }
            console.warn('Stage A: Failed to create affiliate:', errorMessage);
            return; // Don't throw - allow fallback to legacy mode
        }

        // Parse JSON response
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Stage A: Could not parse response:', responseText);
            return; // Don't throw - allow fallback to legacy mode
        }

        if (data && data.success && data.affiliate_id) {
            createdAffiliateId = data.affiliate_id;
            console.log('✅ Stage A: Affiliate created after Page 3 with ID:', createdAffiliateId);
        } else {
            console.warn('Stage A: No affiliate_id returned from backend');
        }
    } catch (error) {
        console.error('Stage A: Error creating affiliate after Page 3:', error);
        // Don't throw - allow fallback to legacy mode
    }
}

// Update affiliate with commission type after Page 4
async function updateCommissionTypeAfterPage4() {
    // Only update if affiliate was created in Stage A and commission type is available
    if (!createdAffiliateId || !formState.commissionType) {
        console.log('Skipping commission type update - no affiliate ID or commission type');
        return;
    }

    const payload = {
        mode: 'update_custom_fields',
        affiliate_id: createdAffiliateId,
        commission_type: formState.commissionType
    };

    console.log('Updating affiliate with commission type:', payload);

    try {
        const response = await fetch(BACKEND_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Failed to update commission type:', errorData);
            // Don't throw - allow flow to continue
        } else {
            const result = await response.json();
            console.log('Commission type updated successfully:', result);
        }
    } catch (error) {
        console.error('Error updating commission type:', error);
        // Don't throw - allow flow to continue
    }
}

// Create affiliate via secure backend endpoint (Stage B or legacy)
async function createTapfiliateAffiliate() {
    const companyTypeLabels = {
        'supply': 'I want to store bags (Supply)',
        'vacation-rental': 'Vacation Rental / Airbnb Host',
        'pms': 'PMS',
        'venue': 'Venue',
        'blog': 'Blog',
        'tour-operator': 'Tour Operator',
        'transportations': 'Transportations',
        'other': 'Other'
    };

    const programId = PROGRAM_ID_MAP[formState.program];
    if (!programId) {
        throw new Error('Program selection is missing or invalid.');
    }

    // If Stage A is still in-flight, wait for it before deciding the payload
    if (stageAPromise && !createdAffiliateId) {
        console.log('Waiting for Stage A to complete before finalizing...');
        await stageAPromise;
    }

    // Decide which payload to send based on whether Stage A has already created an affiliate
    let payloadToSend;

    if (createdAffiliateId) {
        // Stage B: Finalize existing affiliate and enroll into selected program
        payloadToSend = {
            mode: 'finalize_affiliate',
            affiliate_id: createdAffiliateId,
            program: programId,
            address: {
                address: 'n/a',
                postal_code: 'n/a',
                city: formState.city || 'n/a',
                country: {
                    code: COUNTRY_ISO_MAP[formState.country] || 'GB'
                }
            },
            company: {
                name: formState.companyName || 'n/a',
                description: formState.companyDescription || ''
            }
        };

        // Resolve parent_id with full fallback chain (URL > localStorage > field)
        const stageBParentId = resolveParentId();
        console.log('[Tracking] Stage B parent_id resolved to:', stageBParentId || '(none)');
        if (stageBParentId) {
            payloadToSend.parent_id = stageBParentId;
        }

        // Add commission_type if available (for custom fields)
        if (formState.commissionType) {
            payloadToSend.commission_type = formState.commissionType;
        }

        // Add wantsDemoCall if available (for custom fields)
        payloadToSend.wantsDemoCall = formState.wantsDemoCall;

        // Add website metadata if provided
        if (formState.companyWebsite) {
            payloadToSend.metadata = { website: formState.companyWebsite };
        }

        console.log('Stage B: Finalizing existing affiliate with payload:', JSON.stringify(payloadToSend, null, 2));
    } else {
        // Legacy behavior: create affiliate + enroll in one step (fallback if Stage A failed)
        const affiliatePayload = {
            program: programId,
            first_name: formState.firstName,
            last_name: formState.lastName,
            email: formState.email,
            password: formState.password,
            city: formState.city,
            country: formState.country,
            company: formState.companyName
        };

        // Optional fields
        if (formState.companyDescription) {
            affiliatePayload.company_description = formState.companyDescription;
        }

        if (formState.companyWebsite) {
            affiliatePayload.metadata = { website: formState.companyWebsite };
        }

        // Add company_type if available (for custom fields)
        if (formState.companyType) {
            affiliatePayload.company_type = formState.companyType;
        }

        // Add commission_type if available (for custom fields)
        if (formState.commissionType) {
            affiliatePayload.commission_type = formState.commissionType;
        }

        // Add wantsDemoCall if available (for custom fields)
        affiliatePayload.wantsDemoCall = formState.wantsDemoCall;

        // Resolve parent_id with full fallback chain (URL > localStorage > field)
        const legacyParentId = resolveParentId();
        console.log('[Tracking] Legacy path parent_id resolved to:', legacyParentId || '(none)');
        if (legacyParentId) {
            affiliatePayload.parent_id = legacyParentId;
        }

        // Clean up undefined/null values
        Object.keys(affiliatePayload).forEach((key) => {
            if (affiliatePayload[key] === undefined || affiliatePayload[key] === null) {
                delete affiliatePayload[key];
            }
            if (key === 'metadata' && affiliatePayload.metadata && Object.keys(affiliatePayload.metadata).length === 0) {
                delete affiliatePayload.metadata;
            }
        });

        payloadToSend = affiliatePayload;
        console.log('Legacy: Creating and enrolling affiliate in one step with payload:', JSON.stringify({ ...payloadToSend, password: '***MASKED***' }, null, 2));
    }

    try {
        console.log('Sending affiliate data to backend:', JSON.stringify({ ...payloadToSend, password: payloadToSend.password ? '***MASKED***' : undefined }, null, 2));
        
        const response = await fetch(BACKEND_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payloadToSend)
        });

        const contentType = response.headers.get('content-type');
        const responseText = await response.text();
        
        console.log('Backend response status:', response.status);
        console.log('Backend response content-type:', contentType);

        if (!response.ok) {
            // Check if response is HTML (error page)
            if (contentType && contentType.includes('text/html')) {
                console.error('Backend returned HTML error page instead of JSON');
                throw new Error('Something went wrong while creating your affiliate account. Please try again later.');
            }
            
            let errorMessage = 'Something went wrong while creating your affiliate account. Please try again later.';
            
            try {
                const errorData = JSON.parse(responseText);
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                // If not JSON, use generic message
                console.error('Could not parse error response:', responseText);
            }
            
            throw new Error(errorMessage);
        }

        // Parse JSON response
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Could not parse success response:', responseText);
            throw new Error('Invalid response from server');
        }
        
        return data;
    } catch (error) {
        console.error('Error creating affiliate:', error);
        throw error;
    }
}

// Terms Modal Functions
function openTermsModal() {
    const termsModal = document.getElementById('termsModal');
    if (termsModal) {
        termsModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

function closeTermsModal() {
    const termsModal = document.getElementById('termsModal');
    if (termsModal) {
        termsModal.classList.remove('active');
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Export form state for debugging (optional)
window.formState = formState;
