// Local synthetic CRM interaction regression runner.
// Restore scripts/qa/fixtures/crm-polish on credential-free localhost:3047 first.
// All non-fixture routes, remote network, and HTTP mutations are blocked.
// Browser-local fixture adapters handle the explicitly simulated actions.
// Run: node scripts/qa/crm-polish-interactions.mjs [optional-test-name-filter]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = '.tmp/round2-interactions';
fs.mkdirSync(root, { recursive: true });
const results = [];
const started = new Date().toISOString();
const blocked = [];
const only = process.argv[2];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.route('**/*', route => {
    const q = route.request();
    const u = new URL(q.url());
    if (u.origin !== 'http://127.0.0.1:3047' || !['GET', 'HEAD'].includes(q.method()) || !(/^\/(?:board\/qa-polish(?:$|\/)|_next\/|images\/|favicon\.ico|icon\.svg|apple-icon)/.test(u.pathname))) {
        blocked.push({ url: u.pathname, method: q.method() });
        return route.abort('blockedbyclient');
    }
    return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const wait = ms => page.waitForTimeout(ms);
const go = async (surface, state = '') => {
    await page.goto(`http://127.0.0.1:3047/board/qa-polish?surface=${surface}&state=${state}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("[data-qa-boundary-hydrated='true']").waitFor({ timeout: 60000 });
    await wait(400);
    if (surface === 'dock')
        await page.locator('.ops-dock-base').waitFor();
    if (surface === 'login')
        await page.getByRole('button', { name: /Sign in as/ }).first().waitFor();
};
const focus = () => page.evaluate(() => ({ id: document.activeElement?.id, text: document.activeElement?.textContent?.trim().slice(0, 180), tag: document.activeElement?.tagName }));
async function test(name, run) {
    if (only && !name.includes(only))
        return;
    const result = { name };
    try {
        result.evidence = await run();
        result.pass = true;
    }
    catch (e) {
        result.pass = false;
        result.error = String(e);
        result.focus = await focus().catch(() => null);
    }
    await page.screenshot({ path: `${root}/${name}.jpg`, type: 'jpeg', quality: 82, fullPage: true }).catch(() => {
    });
    results.push(result);
    fs.writeFileSync(`${root}/results.json`, JSON.stringify({ started, updated: new Date().toISOString(), results, errors, blocked }, null, 2));
    console.log(JSON.stringify(result));
}
try {
    await test('login-sms-focus-error', async () => {
        await go('login');
        await page.getByRole('button', { name: /Sign in as/ }).first().click();
        await page.getByRole('button', { name: 'Text my code', exact: true }).click();
        await page.getByLabel('Six-digit code').waitFor();
        assert.match((await focus()).id, /^ops-code-/);
        await page.getByLabel('Six-digit code').fill('123456');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.getByLabel('Six-digit code').and(page.locator('[aria-invalid=true]')).waitFor();
        const afterError = await focus();
        assert.match(afterError.id, /^ops-code-/, 'Failed verification must return focus to editable code');
        await page.getByRole('button', { name: 'Choose a different person' }).click();
        assert.match((await focus()).text, /Daniel/);
        return { codeFocus: true, errorFocus: afterError, personReturn: true };
    });
    await test('login-pending-locked', async () => {
        await go('login', 'pending');
        await page.getByRole('button', { name: /Sign in as/ }).first().click();
        await page.getByRole('button', { name: 'Text my code', exact: true }).click();
        await page.getByRole('button', { name: 'Sending...', exact: true }).waitFor();
        const buttons = await page.locator('[data-qa-local-interactions] button').evaluateAll(es => es.map(e => ({ text: e.textContent, disabled: e.disabled })));
        assert.ok(buttons.every(x => x.disabled));
        return { buttons };
    });
    await test('menu-keyboard', async () => {
        await go('board');
        const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
        await trigger.click();
        await wait(150);
        assert.equal((await focus()).tag, 'BUTTON');
        await page.keyboard.press('Shift+Tab');
        assert.equal((await focus()).text, 'Sign out');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.ops-more-close').evaluate(e => e === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.match((await focus()).id, /^ops-menu-job-search-/);
        let tabs = [];
        for (let i = 0; i < 30; i++) {
            await page.keyboard.press('Tab');
            tabs.push(await focus());
            assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('.ops-more-panel'))), true, 'Focus escaped modal');
        }
        const summary = page.locator('.ops-more-panel summary').first();
        if (await summary.count()) {
            await summary.focus();
            await page.keyboard.press('Enter');
            assert.equal(await summary.evaluate(e => e.parentElement.open), true);
        }
        await page.keyboard.press('Escape');
        await page.locator('.ops-more-panel').waitFor({ state: 'detached' });
        assert.equal(await page.locator('.ops-more-trigger').evaluate(e => e === document.activeElement), true);
        assert.equal(await page.locator('[inert]').count(), 0);
        return { tabs, disclosure: await summary.count(), escapeRestored: true };
    });
    await test('menu-cached-dom-scope', async () => {
        await go('board');
        await page.evaluate(() => {
            const retained = document.createElement('div');
            retained.hidden = true;
            retained.dataset.qaRetained = 'true';
            retained.innerHTML = '<div class="ops-more-backdrop"><aside id="ops-more-panel"><h2 id="ops-more-title">Old route menu</h2><input id="ops-menu-job-search"></aside></div>';
            document.body.prepend(retained);
        });
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await wait(150);
        const current = await page.locator('.ops-more-panel').evaluate(e => ({ inertAncestor: Boolean(e.closest('[inert]')), focused: e.ownerDocument.activeElement?.className }));
        assert.equal(current.inertAncestor, false, 'Current dialog cannot be inerted by a retained hidden backdrop');
        await page.locator('.ops-more-search label').click();
        assert.equal(await page.locator('.ops-more-search input[type=search]').evaluate(e => e === document.activeElement), true, 'Visible menu label must focus its own input');
        assert.equal(await page.locator('.ops-more-panel').evaluate(e => document.getElementById(e.getAttribute('aria-labelledby'))?.textContent), 'Menu', 'Visible dialog name must resolve current title');
        await page.keyboard.press('Escape');
        return current;
    });
    await test('menu-native-disclosure', async () => {
        await go('board');
        await page.evaluate(() => {
            const original = window.fetch;
            window.fetch = (input, init) => String(input).includes('/api/ops/handset-slips') ? Promise.resolve(Response.json({ slips: [{ id: 1, question: '[INTERNAL TEST] Saved keyboard answer', answer: 'Synthetic', receipt_ids: [], created_at: '2026-10-29T17:00:00Z' }] })) : original(input, init);
        });
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await wait(150);
        await page.locator('.ops-more-panel').getByRole('button', { name: 'Ask Jobs', exact: true }).click();
        await wait(150);
        const summary = page.locator('.ops-slip-basket summary');
        await summary.waitFor();
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await summary.evaluate(e => e.parentElement.open), true);
        await page.keyboard.press('Tab');
        assert.match((await focus()).text, /Saved keyboard answer/);
        await page.keyboard.press('Shift+Tab');
        assert.equal((await focus()).tag, 'SUMMARY');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.ops-more-trigger').evaluate(e => e === document.activeElement), true);
        return { nativeDisclosure: true, tabOrder: true, escapeRestored: true };
    });
    await test('skip-retained-main', async () => {
        await go('board');
        await page.evaluate(() => {
            const retained = document.createElement('div');
            retained.hidden = true;
            retained.innerHTML = '<main id="main" tabindex="-1">Retained route</main>';
            document.body.prepend(retained);
        });
        await page.locator('a.skip').focus();
        await page.keyboard.press('Enter');
        await wait(150);
        const landed = await page.evaluate(() => ({ id: document.activeElement?.id, visible: Boolean(document.activeElement?.getClientRects().length), className: document.activeElement?.className }));
        assert.equal(landed.id, 'main');
        assert.equal(landed.visible, true);
        assert.equal(landed.className, 'main');
        return landed;
    });
    await test('price-repeated-fragment', async () => {
        await go('job');
        await page.getByRole('link', { name: 'Edit price: $875' }).click();
        await wait(150);
        assert.match((await focus()).id, /lead-estimate$/);
        assert.equal(await page.locator('[data-job-fragment=lead-estimate]').evaluate(e => e.closest('details').open), true);
        const bounds = await page.locator('[data-job-fragment=lead-estimate]').evaluate(e => {
            const r = e.getBoundingClientRect();
            const l = e.labels[0].getBoundingClientRect();
            const dock = document.querySelector('.job-action-spine').getBoundingClientRect();
            return { input: { top: r.top, bottom: r.bottom }, label: { top: l.top, bottom: l.bottom }, dockTop: dock.top };
        });
        assert.ok(bounds.label.top >= 0 && bounds.input.bottom <= bounds.dockTop);
        await page.locator('details').filter({ has: page.locator('[data-job-fragment=lead-estimate]') }).locator('summary').click();
        await page.getByRole('link', { name: 'Edit price: $875' }).click();
        await wait(150);
        assert.match((await focus()).id, /lead-estimate$/);
        assert.equal(await page.locator('[data-job-fragment=lead-estimate]').evaluate(e => e.closest('details').open), true);
        return { bounds, repeatedHash: true };
    });
    await test('job-label-retained-id', async () => {
        await go('job');
        await page.getByRole('link', { name: 'Edit price: $875' }).click();
        await wait(150);
        await page.evaluate(() => {
            const retained = document.createElement('div');
            retained.hidden = true;
            retained.innerHTML = '<label for="lead-estimate">Old quote field</label><input id="lead-estimate" value="1">';
            document.body.prepend(retained);
        });
        const label = page.locator('.job-page label').filter({ hasText: 'Estimate ($); saves the job as quoted' });
        await label.click();
        const focused = await page.locator('.job-page [data-job-fragment=lead-estimate]').evaluate(e => e === document.activeElement);
        assert.equal(focused, true, 'Current job quote label must focus its own field, not a retained job');
        return { focused };
    });
    await test('photo-completed-repeat', async () => {
        await go('job', 'completed');
        await page.getByRole('link', { name: 'Photo', exact: true }).click();
        const photo = page.locator('[data-job-fragment=done-photo]');
        await photo.waitFor();
        await wait(150);
        assert.equal(await photo.evaluate(e => e === document.activeElement), true);
        await page.locator('.ops-done-note').evaluate(form => {
            form.dataset.qaLocalInteractions = '';
            form.addEventListener('submit', event => event.preventDefault(), { capture: true });
        });
        await page.getByRole('button', { name: 'File closeout note', exact: true }).click();
        assert.equal(await photo.isVisible(), true, 'A prevented submit must keep the closeout draft open');
        await page.getByRole('link', { name: 'Photo', exact: true }).click();
        await photo.waitFor({ timeout: 3000 });
        await wait(150);
        assert.equal(await photo.evaluate(e => e === document.activeElement), true);
        return { initialFocus: true, preventedSubmitKeepsDraft: true, repeatedSameHashKeepsDraft: true, networkActionPrevented: true };
    });
    await test('job-dock-states', async () => {
        let states = [];
        for (const state of ['pending', 'failed']) {
            await go('job', state);
            const dock = page.locator('.job-action-spine');
            const metrics = await dock.evaluate(e => ({ height: e.getBoundingClientRect().height, text: e.textContent, disabled: e.querySelector('button').disabled }));
            if (state === 'pending')
                assert.equal(metrics.disabled, true);
            else
                assert.match(metrics.text, /could not connect/);
            states.push({ state, ...metrics });
        }
        return { states };
    });
    await test('dock-source-provenance', async () => {
        await go('dock', 'delayed-source');
        await page.evaluate(() => {
            const original = window.fetch;
            window.fetch = async (...args) => {
                const response = await original(...args);
                if (String(args[0]).includes('/api/ops/receipts')) {
                    const data = await response.json();
                    data.receipts = data.receipts.map(item => ({ ...item, lead_id: item.id }));
                    return Response.json(data);
                }
                return response;
            };
        });
        await page.getByRole('button', { name: 'Ask Jobs', exact: true }).click();
        await wait(150);
        assert.match((await focus()).id, /^ops-handset-question-/);
        await page.locator('.ops-slip-basket summary').click();
        await page.getByRole('button', { name: /Saved answer A/ }).click();
        await page.getByRole('button', { name: /Saved answer B/ }).click();
        await wait(5500);
        const answer = await page.locator('.ops-thermal-slip').innerText();
        assert.match(answer, /Answer B/);
        assert.equal(await page.locator('.ops-thermal-slip a').getAttribute('href'), '/ops/leads/2');
        await page.locator('.ops-handset-panel').getByRole('button', { name: 'Close', exact: true }).click();
        await wait(100);
        assert.equal(await page.locator('.ops-handset-key').evaluate(e => e === document.activeElement), true);
        return { answer, closeFocus: true };
    });
    await test('dock-stale-brief', async () => {
        await go('dock', 'stale-brief');
        await page.getByRole('button', { name: 'Morning Brief', exact: true }).click();
        await page.locator('.ops-radio-panel').getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByRole('button', { name: 'Morning Brief', exact: true }).click();
        await wait(5500);
        const text = await page.locator('.ops-radio-panel [role=status]').innerText();
        assert.match(text, /Brief 2/);
        assert.doesNotMatch(text, /Brief 1/);
        return { text };
    });
    await test('dock-nonok-feedback', async () => {
        await go('dock', 'failed');
        await page.getByRole('button', { name: 'Morning Brief', exact: true }).click();
        await wait(250);
        assert.match(await page.locator('.ops-radio-panel').innerText(), /could not load/);
        assert.equal(await page.getByRole('button', { name: 'Play again' }).isDisabled(), true);
        await page.getByRole('button', { name: 'Ask Jobs', exact: true }).click();
        await page.locator('.ops-slip-basket summary').click();
        await page.getByRole('button', { name: /Saved answer A/ }).click();
        await wait(250);
        assert.match(await page.locator('.ops-basket-status').innerText(), /source|Source/);
        await page.getByRole('button', { name: 'Clear saved answers', exact: true }).click();
        await wait(200);
        assert.equal(await page.getByRole('button', { name: /Saved answer [AB]/ }).count(), 2);
        const clearMessage = await page.locator('.ops-basket-status').innerText();
        assert.match(clearMessage, /could not be cleared/);
        await page.getByLabel('Question for Ask Jobs').fill('What next?');
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        await wait(250);
        const answer = await page.locator('.ops-thermal-slip').innerText();
        assert.match(answer, /unavailable/);
        return { clearMessage, answer };
    });
    await test('client-labels-retained-route', async () => {
        const evidence = [];
        for (const surface of ['forms', 'job', 'login', 'dock']) {
            await go(surface);
            if (surface === 'forms')
                await page.getByRole('button', { name: 'More details', exact: true }).click();
            if (surface === 'login')
                await page.getByRole('button', { name: "My name isn't here", exact: true }).click();
            if (surface === 'dock')
                await page.getByRole('button', { name: 'Ask Jobs', exact: true }).click();
            await wait(150);
            await page.evaluate(() => {
                const aliases = ['payment-amount', 'payment-method', 'payment-reversal-amount', 'payment-reversal-reason', 'payment-hint', 'reversal-hint', 'ops-email', 'ops-phone', 'ops-code', 'ops-login-message', 'jobs-inline-name', 'jobs-inline-phone', 'jobs-inline-need', 'jobs-inline-service', 'jobs-inline-referral', 'jobs-inline-error', 'ops-handset-question', 'ops-handset-speak', 'done-note', 'closeout-source', 'finish-photo', 'done-photo', 'job-reply-result'];
                const hidden = document.createElement('div');
                hidden.hidden = true;
                hidden.innerHTML = aliases.map(id => '<label for="' + id + '">Old route label</label><input id="' + id + '">').join('');
                document.body.prepend(hidden);
            });
            const labels = await page.evaluate(() => Array.from(document.querySelectorAll('label[for]')).filter(label => label.getClientRects().length > 0).map(label => ({ label: label.textContent.trim(), for: label.htmlFor, control: label.control?.id, visible: Boolean(label.control?.getClientRects().length), references: (label.control?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => ({ id, visible: Boolean(document.getElementById(id)?.getClientRects().length) })) })));
            assert.ok(labels.length > 0);
            assert.ok(labels.every(label => label.visible && label.control === label.for), surface + ' has a label bound outside visible route');
            assert.ok(labels.every(label => label.references.every(item => item.visible)), surface + ' has stale hint association');
            evidence.push({ surface, labels });
        }
        return evidence;
    });
    await test('voice-inflight-identity-guard', async () => {
        await go('voice');
        await wait(3000);
        await page.evaluate(() => {
            const original = window.fetch;
            window.qaOwnerPost = false;
            window.fetch = async (...args) => {
                const result = await original(...args);
                if (String(args[0]).includes('/api/ops/transcribe') && args[1]?.method === 'POST' && new Headers(args[1].headers).get('X-Voice-Operator-Scope') === 'operator:987654321:owner') {
                    window.qaOwnerPost = true;
                    await new Promise(resolve => setTimeout(resolve, 1800));
                }
                return result;
            };
        });
        await page.getByRole('button', { name: 'Use owner identity' }).click();
        await page.waitForFunction(() => window.qaOwnerPost);
        await page.getByRole('button', { name: 'Use crew identity' }).click();
        await wait(2300);
        await page.getByRole('button', { name: 'Inspect saved notes' }).click();
        const inventory = await page.locator('#qa-voice-stored').innerText();
        assert.match(inventory, /voice-owner: preserved/);
        const visibleTranscript = await page.locator('[data-qa-local-interactions] > p').allTextContents();
        assert.ok(!visibleTranscript.some(text => text.includes('Recovered qa-polish-voice-owner')));
        await page.getByRole('button', { name: 'Use owner identity' }).click();
        await wait(3800);
        await page.getByRole('button', { name: 'Inspect saved notes' }).click();
        assert.match(await page.locator('#qa-voice-stored').innerText(), /voice-owner: absent/);
        return { inventory, visibleTranscript, ownerLaterRecovered: true };
    });
    await test('voice-identity-preservation', async () => {
        await go('voice');
        await wait(3500);
        await page.getByRole('button', { name: 'Inspect saved notes' }).click();
        const crewInventory = await page.locator('#qa-voice-stored').innerText();
        const crewEvents = await page.locator('#qa-voice-events').innerText();
        assert.match(crewInventory, /voice-owner: preserved/);
        assert.match(crewInventory, /voice-legacy: preserved/);
        assert.match(crewInventory, /voice-crew: absent/);
        assert.doesNotMatch(crewEvents, /id=qa-polish-voice-owner/);
        await page.getByRole('button', { name: 'Use owner identity' }).click();
        await wait(3500);
        await page.getByRole('button', { name: 'Inspect saved notes' }).click();
        const ownerInventory = await page.locator('#qa-voice-stored').innerText();
        const events = await page.locator('#qa-voice-events').innerText();
        assert.match(ownerInventory, /voice-owner: absent/);
        assert.match(ownerInventory, /voice-legacy: preserved/);
        assert.match(events, /POST id=qa-polish-voice-owner scope=operator:987654321:owner/);
        assert.match(events, /POST id=qa-polish-voice-crew scope=operator:987654322:crew/);
        await page.getByRole('button', { name: 'Use crew identity' }).click();
        await wait(1200);
        assert.equal(await page.locator('#qa-voice-events').innerText(), events);
        return { crewInventory, ownerInventory, events, noCrossUpload: true };
    });
}
finally {
    await browser.close();
    fs.writeFileSync(`${root}/results.json`, JSON.stringify({ started, updated: new Date().toISOString(), results, errors, blocked }, null, 2));
}
process.exitCode = results.some(x => !x.pass) || errors.length > 0 ? 1 : 0;
