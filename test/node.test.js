// Offline tests: the built node runs against a local fake of the Ghamalim API.
// Run with `npm test` (builds first). No network, no real workspace.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHmac } = require('node:crypto');

const { Ghamalim, waitSettings } = require('../dist/nodes/Ghamalim/Ghamalim.node.js');
waitSettings.pollIntervalMs = 20;
const { GhamalimTrigger, verifySignature } = require('../dist/nodes/Ghamalim/GhamalimTrigger.node.js');
const { toZonedIso, parseMediaUrls, pickReachableTicket, isPublishingNow } = require('../dist/nodes/Ghamalim/GenericFunctions.js');

// ---------------------------------------------------------------- fake API
const calls = [];
let errorsLikeN8n = false;
let routes = {};
const server = http.createServer((req, res) => {
	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', () => {
		const url = new URL(req.url, 'http://x');
		const raw = Buffer.concat(chunks);
		const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, raw };
		if ((req.headers['content-type'] || '').startsWith('application/json') && raw.length) call.body = JSON.parse(raw.toString());
		calls.push(call);
		const handler = routes[`${req.method} ${url.pathname}`];
		const out = handler ? handler(call) : { status: 404, body: { error: 'Not found' } };
		res.writeHead(out.status ?? 200, { 'content-type': 'application/json', ...(out.headers || {}) });
		res.end(out.status === 204 ? undefined : JSON.stringify(out.body ?? {}));
	});
});
let baseUrl;
test.before(async () => {
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
test.beforeEach(() => {
	calls.length = 0;
	routes = {};
});

// What n8n's httpRequestWithAuthentication does for this credential: add the
// bearer header, send, parse JSON, throw an axios-shaped error on non-2xx.
async function httpRequestWithAuthentication(_type, options) {
	const url = new URL(options.url);
	for (const [k, v] of Object.entries(options.qs || {})) url.searchParams.set(k, String(v));
	const isForm = options.body instanceof FormData;
	const headers = { ...options.headers, Authorization: 'Bearer test-key' };
	if (!isForm && options.body !== undefined) headers['content-type'] = 'application/json';
	const res = await fetch(url, { method: options.method, headers, body: options.body === undefined ? undefined : isForm ? options.body : JSON.stringify(options.body) });
	const text = await res.text();
	const data = text ? JSON.parse(text) : undefined;
	if (!res.ok) {
		const axiosError = new Error(`Request failed with status code ${res.status}`);
		axiosError.response = { status: res.status, data, headers: Object.fromEntries(res.headers) };
		if (!errorsLikeN8n) throw axiosError;
		// What n8n's request helper really throws (captured from n8n 2.35.7):
		// a NodeApiError with a generic message, the body on context.data and the axios error as cause.
		const { NodeApiError } = require('n8n-workflow');
		const wrapped = new NodeApiError({ name: 'Ghamalim', type: 'x', typeVersion: 1, id: 'n1', position: [0, 0], parameters: {} }, axiosError, { httpCode: String(res.status) });
		wrapped.context.data = data;
		wrapped.cause = axiosError;
		throw wrapped;
	}
	return data;
}

function context(params, { binary, continueOnFail = false, staticData = {} } = {}) {
	const node = { name: 'Ghamalim', type: 'n8n-nodes-ghamalim.ghamalim', typeVersion: 1, id: 'n1', position: [0, 0], parameters: {} };
	return {
		staticData,
		getInputData: () => [{ json: {}, binary }],
		// Like n8n: a resource locator value ({ __rl, mode, value }) comes back as just its value with extractValue.
		getNodeParameter: (name, _i, fallback, options) => {
			const value = name in params ? params[name] : fallback;
			return options?.extractValue && value && typeof value === 'object' && '__rl' in value ? value.value : value;
		},
		getCurrentNodeParameter: (name) => params[name],
		getNode: () => node,
		getWorkflow: () => ({ id: params.__workflowId ?? 'wf1' }),
		getTimezone: () => 'Asia/Manila',
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({ apiKey: 'test-key', baseUrl: `${baseUrl}/` }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => params.__webhookUrl ?? 'https://n8n.example.com/webhook/abc/webhook',
		helpers: {
			httpRequestWithAuthentication,
			assertBinaryData: (_i, prop) => binary[prop],
			getBinaryDataBuffer: async (_i, prop) => Buffer.from(binary[prop].data, 'base64'),
			returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
		},
	};
}
const run = async (params, opts) => (await new Ghamalim().execute.call(context(params, opts)))[0].map((i) => i.json);

// ------------------------------------------------------------------ helpers
test('toZonedIso reads a zone-less time in the workflow time zone', () => {
	assert.equal(toZonedIso('2026-12-01T09:00:00', 'Asia/Manila'), '2026-12-01T01:00:00.000Z');
	assert.equal(toZonedIso('2026-12-01 09:00:00', 'Asia/Bangkok'), '2026-12-01T02:00:00.000Z');
	assert.equal(toZonedIso('2026-07-01T09:00:00', 'America/New_York'), '2026-07-01T13:00:00.000Z');
	assert.equal(toZonedIso('2026-01-15T09:00:00', 'America/New_York'), '2026-01-15T14:00:00.000Z');
	assert.equal(toZonedIso('2026-12-01T09:00:00', 'UTC'), '2026-12-01T09:00:00.000Z');
});
test('toZonedIso keeps the meaning of a value that already has a zone', () => {
	assert.equal(toZonedIso('2026-12-01T09:00:00+07:00', 'Asia/Manila'), '2026-12-01T02:00:00.000Z');
	assert.equal(toZonedIso('2026-12-01T09:00:00.000Z', 'Asia/Manila'), '2026-12-01T09:00:00.000Z');
	assert.equal(toZonedIso('2026-12-01T09:00:00.000-05:00', 'Asia/Manila'), '2026-12-01T14:00:00.000Z');
});
test('toZonedIso refuses nonsense', () => {
	assert.equal(toZonedIso('tomorrow', 'Asia/Manila'), null);
	assert.equal(toZonedIso('', 'Asia/Manila'), null);
	assert.equal(toZonedIso('2026-12-01T09:00:00', 'Not/AZone'), null);
});
test('parseMediaUrls accepts a list or separated text', () => {
	assert.deepEqual(parseMediaUrls(['https://a/1.jpg', ' ', 'https://a/2.jpg ']), ['https://a/1.jpg', 'https://a/2.jpg']);
	assert.deepEqual(parseMediaUrls('https://a/1.jpg, https://a/2.jpg\nhttps://a/3.jpg'), ['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg']);
});

// -------------------------------------------------------------------- posts
test('post create sends the API body, auth header and idempotency key', async () => {
	routes['POST /api/v1/posts'] = () => ({ status: 202, body: { data: { id: 'p1', status: 'scheduled' } } });
	const out = await run({
		resource: 'post', operation: 'create', channelIds: ['c1', 'c2'], caption: '  Hello  ', mediaUrls: ' https://a/1.jpg ',
		additionalFields: { scheduledAt: '2026-12-01T09:00:00', externalId: 'listing-7', labelIds: ['l1'], requireApproval: true, idempotencyKey: 'k1', tiktokPrivacyLevel: 'SELF_ONLY', tiktokAllowDuet: false },
	});
	assert.deepEqual(out, [{ id: 'p1', status: 'scheduled' }]);
	assert.equal(calls[0].headers.authorization, 'Bearer test-key');
	assert.equal(calls[0].headers['idempotency-key'], 'k1');
	assert.deepEqual(calls[0].body, {
		channel_ids: ['c1', 'c2'], caption: 'Hello', media: ['https://a/1.jpg'], require_approval: true, external_id: 'listing-7', label_ids: ['l1'],
		scheduled_at: '2026-12-01T01:00:00.000Z', tiktok: { privacy_level: 'SELF_ONLY', allow_duet: false },
	});
});
test('post create is refused locally without channels (unless a draft) or without content', async () => {
	await assert.rejects(run({ resource: 'post', operation: 'create', channelIds: [], caption: 'x', additionalFields: {} }), /at least one channel/);
	await assert.rejects(run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: '', mediaUrls: '', additionalFields: {} }), /caption, media, or both/);
	await assert.rejects(run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: 'x', additionalFields: { tiktokAllowDuet: false } }), /TikTok: Visibility/);
	assert.equal(calls.length, 0);
	routes['POST /api/v1/posts'] = () => ({ status: 202, body: { data: { id: 'd1', status: 'draft' } } });
	await run({ resource: 'post', operation: 'create', channelIds: [], caption: 'x', additionalFields: { draft: true } });
	assert.deepEqual(calls[0].body, { caption: 'x', draft: true });
	// A carousel: comma-separated text, or a list from an expression.
	await run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: '', mediaUrls: 'https://a/1.jpg, https://a/2.jpg', additionalFields: {} });
	assert.deepEqual(calls[1].body.media, ['https://a/1.jpg', 'https://a/2.jpg']);
	await run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: '', mediaUrls: ['https://a/1.jpg', 'https://a/2.jpg'], additionalFields: {} });
	assert.deepEqual(calls[2].body.media, ['https://a/1.jpg', 'https://a/2.jpg']);
});
test('post get many walks pages of 200 and stops at the limit', async () => {
	const all = Array.from({ length: 450 }, (_, i) => ({ id: `p${i}` }));
	routes['GET /api/v1/posts'] = (c) => {
		const limit = Number(c.query.limit), offset = Number(c.query.offset);
		return { body: { data: all.slice(offset, offset + limit), pagination: { limit, offset, total: all.length } } };
	};
	assert.equal((await run({ resource: 'post', operation: 'getAll', returnAll: true, filters: { status: 'published' } })).length, 450);
	assert.deepEqual(calls.map((c) => [c.query.limit, c.query.offset, c.query.status]), [['200', '0', 'published'], ['200', '200', 'published'], ['200', '400', 'published']]);
	calls.length = 0;
	const some = await run({ resource: 'post', operation: 'getAll', returnAll: false, limit: 250, filters: {} });
	assert.equal(some.length, 250);
	assert.deepEqual(calls.map((c) => [c.query.limit, c.query.offset]), [['200', '0'], ['50', '200']]);
});
test('post update, publish, reject, approve, retry, refresh, delete hit the right endpoints', async () => {
	const ok = () => ({ body: { data: { id: 'p1' } } });
	for (const r of ['PATCH /api/v1/posts/p1', 'POST /api/v1/posts/p1/publish', 'POST /api/v1/posts/p1/reject', 'POST /api/v1/posts/p1/approve', 'POST /api/v1/posts/p1/retry', 'POST /api/v1/posts/p1/refresh-insights', 'DELETE /api/v1/posts/p1', 'GET /api/v1/posts/p1']) routes[r] = ok;
	await run({ resource: 'post', operation: 'update', postId: 'p1', updateFields: { caption: 'New', scheduledAt: '' } });
	assert.deepEqual(calls.at(-1).body, { caption: 'New', scheduled_at: null });
	await assert.rejects(run({ resource: 'post', operation: 'update', postId: 'p1', updateFields: {} }), /at least one field/);
	await run({ resource: 'post', operation: 'publish', postId: 'p1', publishOptions: { scheduledAt: '2026-12-01T09:00:00+08:00' } });
	assert.deepEqual(calls.at(-1).body, { scheduled_at: '2026-12-01T01:00:00.000Z' });
	await run({ resource: 'post', operation: 'reject', postId: 'p1', reason: 'Wrong photo' });
	assert.deepEqual(calls.at(-1).body, { reason: 'Wrong photo' });
	for (const op of ['approve', 'retry', 'refreshInsights', 'delete', 'get']) await run({ resource: 'post', operation: op, postId: 'p1' });
	assert.deepEqual(calls.slice(-5).map((c) => `${c.method} ${c.path}`), ['POST /api/v1/posts/p1/approve', 'POST /api/v1/posts/p1/retry', 'POST /api/v1/posts/p1/refresh-insights', 'DELETE /api/v1/posts/p1', 'GET /api/v1/posts/p1']);
	await assert.rejects(run({ resource: 'post', operation: 'get', postId: '  ' }), /Post ID is required/);
});
test('captions and best times return one item per row', async () => {
	routes['POST /api/v1/posts/ai/captions'] = () => ({ body: { data: { variants: [{ platform: 'facebook', caption: 'a' }, { platform: 'x', caption: 'b' }] } } });
	routes['GET /api/v1/posts/best-times'] = () => ({ body: { data: [{ weekday: 'mon', hour: 9 }] } });
	assert.equal((await run({ resource: 'post', operation: 'generateCaptions', brief: 'New condo', captionOptions: { platforms: ['facebook', 'x'], tone: 'warm' } })).length, 2);
	assert.deepEqual(calls[0].body, { brief: 'New condo', platforms: ['facebook', 'x'], tone: 'warm' });
	await run({ resource: 'post', operation: 'getBestTimes', bestTimeOptions: { channelIds: ['c1', 'c2'], suggestions: 3 } });
	assert.deepEqual(calls[1].query, { timezone: 'Asia/Manila', channel_ids: 'c1,c2', limit: '3' });
});

// ----------------------------------------------------------------- messages
test('message send: text as JSON, file as multipart with the caption', async () => {
	routes['POST /api/v1/tickets/t1/messages'] = () => ({ status: 201, body: { data: { id: 'm1', delivery_status: 'sent' } } });
	assert.deepEqual(await run({ resource: 'message', operation: 'send', ticketId: 't1', content: 'Hi', attachFile: false, sendOptions: { idempotencyKey: 'abc' } }), [{ id: 'm1', delivery_status: 'sent' }]);
	assert.deepEqual(calls[0].body, { content: 'Hi' });
	assert.equal(calls[0].headers['idempotency-key'], 'abc');

	const binary = { data: { data: Buffer.from('PNGDATA').toString('base64'), mimeType: 'image/png', fileName: 'photo.png' } };
	await run({ resource: 'message', operation: 'send', ticketId: 't1', content: 'Caption', attachFile: true, binaryPropertyName: 'data', sendOptions: {} }, { binary });
	assert.match(calls[1].headers['content-type'], /^multipart\/form-data; boundary=/);
	const raw = calls[1].raw.toString();
	assert.match(raw, /name="content"\r\n\r\nCaption/);
	assert.match(raw, /name="file"; filename="photo.png"\r\nContent-Type: image\/png\r\n\r\nPNGDATA/);
	await assert.rejects(run({ resource: 'message', operation: 'send', ticketId: 't1', content: ' ', attachFile: false, sendOptions: {} }), /text or attach a file/);
});
test('a provider refusal surfaces the API reason, not a bare status code', async () => {
	routes['POST /api/v1/tickets/t1/messages'] = () => ({ status: 502, body: { error: 'The channel refused the message', data: { id: 'm2', delivery_status: 'failed', delivery_error: "WhatsApp's 24-hour window has closed" } } });
	const params = { resource: 'message', operation: 'send', ticketId: 't1', content: 'Hi', attachFile: false, sendOptions: {} };
	await assert.rejects(run(params), (err) => {
		assert.equal(err.message, 'The channel refused the message');
		assert.match(err.description, /24-hour window/);
		assert.equal(err.httpCode, '502');
		assert.equal(err.context.itemIndex, 0);
		return true;
	});
	const [item] = await run(params, { continueOnFail: true });
	assert.equal(item.error, 'The channel refused the message');
	assert.equal(item.httpCode, '502');
});
test('the same reason surfaces from the error shape real n8n produces', async () => {
	errorsLikeN8n = true;
	try {
		routes['POST /api/v1/tickets/t1/messages'] = () => ({ status: 502, body: { error: 'The channel refused the message', data: { delivery_error: "WhatsApp's 24-hour window has closed" } } });
		routes['GET /api/v1/labels'] = () => ({ status: 429, headers: { 'retry-after': '17' }, body: { error: 'Rate limit exceeded' } });
		await assert.rejects(run({ resource: 'message', operation: 'send', ticketId: 't1', content: 'Hi', attachFile: false, sendOptions: {} }), (err) => {
			assert.equal(err.message, 'The channel refused the message');
			assert.match(err.description, /24-hour window/);
			assert.equal(err.httpCode, '502');
			return true;
		});
		await assert.rejects(run({ resource: 'label', operation: 'getAll', returnAll: true }), (e) => e.message === 'Rate limit exceeded' && /17 seconds/.test(e.description));
	} finally {
		errorsLikeN8n = false;
	}
});
test('401, 402 and 429 explain what to do', async () => {
	const params = { resource: 'label', operation: 'getAll', returnAll: true };
	routes['GET /api/v1/labels'] = () => ({ status: 401, body: { error: 'Invalid or missing API key' } });
	await assert.rejects(run(params), (e) => /API key/.test(e.description) && e.message === 'Invalid or missing API key');
	routes['GET /api/v1/labels'] = () => ({ status: 402, body: { error: 'No active subscription', code: 'subscription_inactive' } });
	await assert.rejects(run(params), (e) => /Billing/.test(e.description));
	routes['GET /api/v1/labels'] = () => ({ status: 429, headers: { 'retry-after': '17' }, body: { error: 'Rate limit exceeded' } });
	await assert.rejects(run(params), (e) => /17 seconds/.test(e.description));
});
test('message get many and moderate', async () => {
	routes['GET /api/v1/tickets/t1/messages'] = (c) => ({ body: { data: [{ id: 'm1' }, { id: 'm2' }], pagination: { limit: Number(c.query.limit), offset: 0, total: 2 } } });
	routes['POST /api/v1/messages/m9/moderate'] = () => ({ body: { data: { id: 'm9', action: 'hide' } } });
	assert.equal((await run({ resource: 'message', operation: 'getAll', ticketId: 't1', returnAll: true })).length, 2);
	await run({ resource: 'message', operation: 'moderate', messageId: 'm9', moderationAction: 'hide' });
	assert.deepEqual(calls.at(-1).body, { action: 'hide' });
});

// ------------------------------------------------------------ read resources
test('tickets, contacts, channels, media, labels', async () => {
	routes['GET /api/v1/tickets'] = (c) => ({ body: { data: [{ id: 't1' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	routes['GET /api/v1/tickets/t1'] = () => ({ body: { data: { id: 't1' } } });
	routes['GET /api/v1/contacts'] = () => ({ body: { data: [{ id: 'c1' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	routes['GET /api/v1/contacts/c1'] = () => ({ body: { data: { id: 'c1' } } });
	routes['GET /api/v1/contacts/c1/channels'] = () => ({ body: { data: [{ ticket_id: 't1', can_send_text: true }, { ticket_id: null, can_send_text: false }] } });
	routes['GET /api/v1/channels'] = () => ({ body: { data: [{ id: 'ch1' }, { id: 'ch2' }, { id: 'ch3' }] } });
	routes['GET /api/v1/channels/ch1'] = () => ({ body: { data: { id: 'ch1' } } });
	routes['GET /api/v1/channels/ch1/templates'] = () => ({ body: { data: [{ name: 'hello' }] } });
	routes['GET /api/v1/channels/ch1/tiktok-options'] = () => ({ body: { data: { privacy_level_options: ['SELF_ONLY'] } } });
	routes['GET /api/v1/media'] = () => ({ body: { data: [{ url: 'https://a/1.jpg' }] } });
	routes['POST /api/v1/media'] = () => ({ status: 201, body: { data: { url: 'https://cdn/x.png', type: 'image' } } });
	routes['GET /api/v1/labels'] = () => ({ body: { data: [{ id: 'l1', name: 'Promo' }] } });

	await run({ resource: 'ticket', operation: 'getAll', returnAll: false, limit: 50, filters: { status: 'pending' } });
	assert.equal(calls.at(-1).query.status, 'pending');
	assert.deepEqual(await run({ resource: 'ticket', operation: 'get', ticketId: 't1' }), [{ id: 't1' }]);
	await run({ resource: 'contact', operation: 'getAll', returnAll: false, limit: 5, filters: { phone: '+639171234567', email: 'a@b.co', externalId: 'u1' } });
	assert.deepEqual(calls.at(-1).query, { phone: '+639171234567', email: 'a@b.co', external_id: 'u1', limit: '5', offset: '0' });
	assert.deepEqual(await run({ resource: 'contact', operation: 'get', contactId: 'c1' }), [{ id: 'c1' }]);
	assert.equal((await run({ resource: 'contact', operation: 'getChannels', contactId: 'c1' })).length, 2);
	assert.equal((await run({ resource: 'channel', operation: 'getAll', returnAll: false, limit: 2, filters: { type: 'line' } })).length, 2);
	assert.deepEqual(calls.at(-1).query, { type: 'line' });
	assert.deepEqual(await run({ resource: 'channel', operation: 'get', channelId: 'ch1' }), [{ id: 'ch1' }]);
	assert.deepEqual(await run({ resource: 'channel', operation: 'getTemplates', channelId: 'ch1' }), [{ name: 'hello' }]);
	assert.deepEqual(await run({ resource: 'channel', operation: 'getTiktokOptions', channelId: 'ch1' }), [{ privacy_level_options: ['SELF_ONLY'] }]);
	assert.equal((await run({ resource: 'media', operation: 'getAll', returnAll: true })).length, 1);
	const binary = { data: { data: Buffer.from('X').toString('base64'), mimeType: 'image/png', fileName: 'x.png' } };
	assert.deepEqual(await run({ resource: 'media', operation: 'upload', binaryPropertyName: 'data' }, { binary }), [{ url: 'https://cdn/x.png', type: 'image' }]);
	assert.deepEqual(await run({ resource: 'label', operation: 'getAll', returnAll: true }), [{ id: 'l1', name: 'Promo' }]);
});
test('channel dropdown lists only connected channels the API can post to', async () => {
	routes['GET /api/v1/channels'] = () => ({ body: { data: [
		{ id: '1', type: 'facebook_feed', name: 'My Page', is_connected: true, capabilities: { api: { publish_posts: true } } },
		{ id: '2', type: 'whatsapp', name: 'WA', is_connected: true, capabilities: { api: { publish_posts: false } } },
		{ id: '3', type: 'instagram_feed', name: 'Old IG', is_connected: false, capabilities: { api: { publish_posts: true } } },
	] } });
	const options = await new Ghamalim().methods.loadOptions.getPostChannels.call(context({}));
	assert.deepEqual(options, [{ name: 'My Page (Facebook)', value: '1' }]);
});

// ------------------------------------------------------------------ trigger
// Exactly what the app does in lib/chat-app/webhook-dispatch.ts (signStandardWebhook).
const appSign = (secret, id, ts, body) => `v1,${createHmac('sha256', secret).update(`${id}.${ts}.${body}`, 'utf8').digest('base64')}`;

test('verifySignature accepts the app signature and refuses tampering, wrong secret, old timestamps', () => {
	const secret = 'a'.repeat(64), id = 'evt_1', now = 1_800_000_000, body = '{"id":"evt_1","event":"message.received","data":{"content":"สวัสดี"}}';
	const sig = appSign(secret, id, now, body);
	assert.equal(verifySignature(secret, id, String(now), body, sig, now), 'ok');
	assert.equal(verifySignature(secret, id, String(now), Buffer.from(body), sig, now), 'ok');
	assert.equal(verifySignature(secret, id, String(now), body, `v1,AAAA ${sig}`, now), 'ok');
	assert.equal(verifySignature(secret, id, String(now), body.replace('message', 'massage'), sig, now), 'bad_signature');
	assert.equal(verifySignature('b'.repeat(64), id, String(now), body, sig, now), 'bad_signature');
	assert.equal(verifySignature(secret, 'evt_2', String(now), body, sig, now), 'bad_signature');
	assert.equal(verifySignature(secret, id, String(now), body, sig.replace('v1,', 'v2,'), now), 'bad_signature');
	assert.equal(verifySignature(secret, id, String(now), body, sig, now + 301), 'bad_timestamp');
	assert.equal(verifySignature(secret, id, 'abc', body, sig, now), 'bad_timestamp');
});

test('trigger lifecycle: registers, recognises its registration, replaces a stale one, unregisters', async () => {
	let remote = [];
	let created = 0;
	routes['GET /api/v1/webhooks'] = () => ({ body: { data: remote } });
	routes['POST /api/v1/webhooks'] = (c) => {
		const row = { id: `w${++created}`, url: c.body.url, events: c.body.events, is_active: true };
		remote.push(row);
		return { status: 201, body: { data: { ...row, secret: 'sec-' + row.id } } };
	};
	const del = (id) => () => ((remote = remote.filter((w) => w.id !== id)), { status: 204 });
	routes['DELETE /api/v1/webhooks/w1'] = del('w1');
	routes['DELETE /api/v1/webhooks/w2'] = del('w2');

	const hooks = new GhamalimTrigger().webhookMethods.default;
	const staticData = {};
	const ctx = (events) => context({ events }, { staticData });

	assert.equal(await hooks.checkExists.call(ctx(['message.received'])), false);
	assert.equal(await hooks.create.call(ctx(['message.received'])), true);
	assert.deepEqual(staticData, { webhookId: 'w1', webhookSecret: 'sec-w1' });
	assert.equal(await hooks.checkExists.call(ctx(['message.received'])), true);

	// The event selection changed: the old registration is removed, not left to double-deliver.
	assert.equal(await hooks.checkExists.call(ctx(['message.received', 'ticket.created'])), false);
	assert.deepEqual(remote, []);
	assert.equal(await hooks.create.call(ctx(['message.received', 'ticket.created'])), true);
	assert.equal(staticData.webhookId, 'w2');

	// Ghamalim switched it off after days of failures: re-register.
	remote[0].is_active = false;
	assert.equal(await hooks.checkExists.call(ctx(['message.received', 'ticket.created'])), false);
	assert.deepEqual(remote, []);

	remote.push({ id: 'w1', url: 'https://n8n.example.com/webhook/abc/webhook', events: ['x'], is_active: true });
	staticData.webhookId = 'w1';
	staticData.webhookSecret = 's';
	assert.equal(await hooks.delete.call(ctx([])), true);
	assert.deepEqual(staticData, {});
	assert.deepEqual(remote, []);
	// Deleting one that is already gone is fine.
	staticData.webhookId = 'w1';
	assert.equal(await hooks.delete.call(ctx([])), true);
});
test('trigger refuses to register a non-https n8n address with a clear reason', async () => {
	const hooks = new GhamalimTrigger().webhookMethods.default;
	await assert.rejects(hooks.create.call(context({ events: ['message.received'], __webhookUrl: 'http://localhost:5678/webhook-test/x' })), /public https address/);
	await assert.rejects(hooks.create.call(context({ events: [] })), /at least one event/);
	assert.equal(calls.length, 0);
});

let eventCounter = 0;
function delivery({ secret = 'sec', event = 'message.received', events = ['message.received'], tamper, ageSeconds = 0, withRaw = true, stored = 'sec', dropHeaders = false, id = `evt_${++eventCounter}` }) {
	const body = { id, event, created_at: '2026-11-15T00:00:00.000Z', data: { ticket_id: 't1', content: 'hi' } };
	const raw = JSON.stringify(body);
	const ts = Math.floor(Date.now() / 1000) - ageSeconds;
	const headers = dropHeaders ? {} : { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': appSign(secret, id, ts, raw) };
	const sent = { status: null, json: null };
	const res = { status: (s) => ((sent.status = s), res), json: (j) => ((sent.json = j), res) };
	const ctx = {
		...context({ events }, { staticData: stored ? { webhookSecret: stored } : {} }),
		getRequestObject: () => (withRaw ? { rawBody: Buffer.from(tamper ? raw.replace('hi', 'yo') : raw) } : {}),
		getResponseObject: () => res,
		getHeaderData: () => headers,
		getBodyData: () => body,
	};
	return { ctx, sent, body };
}
test('trigger starts the workflow only for a correctly signed, fresh, subscribed event', async () => {
	const trigger = new GhamalimTrigger();
	let d = delivery({});
	assert.deepEqual((await trigger.webhook.call(d.ctx)).workflowData, [[{ json: d.body }]]);
	d = delivery({ withRaw: false });
	assert.ok((await trigger.webhook.call(d.ctx)).workflowData, 'falls back to the parsed body');
	d = delivery({ event: 'test' });
	assert.ok((await trigger.webhook.call(d.ctx)).workflowData, 'test events pass');

	for (const [name, opts, status] of [
		['tampered body', { tamper: true }, 401],
		['wrong secret', { secret: 'other' }, 401],
		['old delivery', { ageSeconds: 400 }, 401],
		['no headers', { dropHeaders: true }, 401],
		['not registered', { stored: null }, 401],
		['unsubscribed event', { event: 'ticket.created' }, 200],
	]) {
		d = delivery(opts);
		assert.deepEqual(await trigger.webhook.call(d.ctx), { noWebhookResponse: true }, name);
		assert.equal(d.sent.status, status, name);
	}
});

// ------------------------------------------------------ wait until published
test('isPublishingNow: only a post that is on its way out is worth waiting for', () => {
	const now = Date.parse('2026-11-15T00:00:00Z');
	assert.equal(isPublishingNow({ status: 'scheduled', scheduled_at: null }, now), true);
	assert.equal(isPublishingNow({ status: 'publishing' }, now), true);
	assert.equal(isPublishingNow({ status: 'scheduled', scheduled_at: '2026-11-15T00:00:05Z' }, now), true);
	assert.equal(isPublishingNow({ status: 'scheduled', scheduled_at: '2026-12-01T00:00:00Z' }, now), false);
	for (const status of ['draft', 'pending_approval', 'rejected', 'published', 'partially_published', 'failed']) assert.equal(isPublishingNow({ status }, now), false, status);
});
test('wait until published re-reads the post until every channel answered', async () => {
	let reads = 0;
	routes['POST /api/v1/posts'] = () => ({ status: 202, body: { data: { id: 'p1', status: 'scheduled', scheduled_at: null } } });
	routes['GET /api/v1/posts/p1'] = () => ({ body: { data: ++reads < 3 ? { id: 'p1', status: 'publishing' } : { id: 'p1', status: 'published', targets: [{ state: 'published', url: 'https://fb.example/1' }] } } });
	const params = { resource: 'post', operation: 'create', channelIds: ['c1'], caption: 'x', additionalFields: {}, waitUntilPublished: true, maxWaitSeconds: 5 };
	const [post] = await run(params);
	assert.equal(post.status, 'published');
	assert.equal(post.targets[0].url, 'https://fb.example/1');
	assert.equal(post.wait_timed_out, false);
	assert.equal(reads, 3);

	// Off by default: one request, the accepted post comes straight back.
	calls.length = 0;
	const [quick] = await run({ ...params, waitUntilPublished: false });
	assert.equal(quick.status, 'scheduled');
	assert.equal(calls.length, 1);
});
test('wait gives up at the time limit without failing, and skips posts that are not going out now', async () => {
	routes['POST /api/v1/posts/p1/retry'] = () => ({ status: 202, body: { data: { id: 'p1', status: 'publishing' } } });
	routes['GET /api/v1/posts/p1'] = () => ({ body: { data: { id: 'p1', status: 'publishing' } } });
	const started = Date.now();
	const [slow] = await run({ resource: 'post', operation: 'retry', postId: 'p1', waitUntilPublished: true, maxWaitSeconds: 0.2 });
	assert.equal(slow.status, 'publishing');
	assert.equal(slow.wait_timed_out, true);
	assert.ok(Date.now() - started < 7000);

	calls.length = 0;
	routes['POST /api/v1/posts'] = () => ({ status: 202, body: { data: { id: 'p2', status: 'scheduled', scheduled_at: '2099-01-01T00:00:00.000Z' } } });
	const [later] = await run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: 'x', additionalFields: { scheduledAt: '2099-01-01T00:00:00Z' }, waitUntilPublished: true });
	assert.equal(later.status, 'scheduled');
	assert.equal('wait_timed_out' in later, false);
	assert.equal(calls.length, 1, 'a scheduled post is not polled');
});
test('a failed publish is returned as data when waiting, with the platform reason', async () => {
	routes['POST /api/v1/posts/p1/publish'] = () => ({ status: 202, body: { data: { id: 'p1', status: 'scheduled' } } });
	routes['GET /api/v1/posts/p1'] = () => ({ body: { data: { id: 'p1', status: 'failed', targets: [{ state: 'failed', error: 'Token expired' }] } } });
	const [post] = await run({ resource: 'post', operation: 'publish', postId: 'p1', publishOptions: {}, waitUntilPublished: true });
	assert.equal(post.status, 'failed');
	assert.equal(post.targets[0].error, 'Token expired');
});

// --------------------------------------------------------------- TikTok flags
test('TikTok brand flags switch commercial content on', async () => {
	routes['POST /api/v1/posts'] = () => ({ status: 202, body: { data: { id: 'p1', status: 'scheduled' } } });
	await run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: 'x', mediaUrls: 'https://a/v.mp4', additionalFields: { tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE', tiktokYourBrand: true } });
	assert.deepEqual(calls[0].body.tiktok, { privacy_level: 'PUBLIC_TO_EVERYONE', your_brand: true, commercial_content: true });
	await run({ resource: 'post', operation: 'create', channelIds: ['c1'], caption: 'x', mediaUrls: 'https://a/v.mp4', additionalFields: { tiktokPrivacyLevel: 'SELF_ONLY', tiktokYourBrand: false, tiktokBrandedContent: false } });
	assert.deepEqual(calls[1].body.tiktok, { privacy_level: 'SELF_ONLY', your_brand: false, branded_content: false });
});

// ------------------------------------------------------------ send to contact
const reach = (type, extra) => ({ channel: { id: 'ch-' + type, type, name: type.toUpperCase() }, ticket_id: 't-' + type, last_inbound_at: '2026-11-01T00:00:00Z', can_send_text: true, reason: null, ...extra });
test('pickReachableTicket prefers the asked channel, else the most recent usable conversation', () => {
	const rows = [reach('line', { last_inbound_at: '2026-11-10T00:00:00Z' }), reach('whatsapp', { last_inbound_at: '2026-11-14T00:00:00Z' }), reach('messenger', { can_send_text: false, reason: 'window_closed' })];
	assert.deepEqual(pickReachableTicket(rows), { ticketId: 't-whatsapp', channelType: 'whatsapp' });
	assert.deepEqual(pickReachableTicket(rows, ' LINE '), { ticketId: 't-line', channelType: 'line' });
	assert.deepEqual(pickReachableTicket(rows, 'messenger'), { ticketId: 't-whatsapp', channelType: 'whatsapp' }, 'falls back when the preferred one is closed');
	assert.match(pickReachableTicket([reach('whatsapp', { can_send_text: false, reason: 'window_closed_template_required' }), reach('line', { can_send_text: false, reason: 'contact_blocked_channel' })]).why, /WHATSAPP: WhatsApp's 24-hour window is closed.*LINE: the contact blocked this channel/);
	assert.match(pickReachableTicket([reach('line', { ticket_id: null, can_send_text: false, reason: 'no_conversation' })]).why, /never written/);
	assert.match(pickReachableTicket([]).why, /no conversation on any channel/);
});
test('message send to a contact finds the ticket, sends there and says where it went', async () => {
	routes['GET /api/v1/contacts/c1/channels'] = () => ({ body: { data: [reach('line'), reach('whatsapp', { can_send_text: false, reason: 'window_closed_template_required' })] } });
	routes['POST /api/v1/tickets/t-line/messages'] = () => ({ status: 201, body: { data: { id: 'm1', delivery_status: 'sent' } } });
	const params = { resource: 'message', operation: 'send', sendTo: 'contact', contactId: 'c1', preferredChannelType: 'whatsapp', content: 'Your order shipped', attachFile: false, sendOptions: {} };
	assert.deepEqual(await run(params), [{ id: 'm1', delivery_status: 'sent', ticket_id: 't-line', channel_type: 'line' }]);
	assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /api/v1/contacts/c1/channels', 'POST /api/v1/tickets/t-line/messages']);

	calls.length = 0;
	routes['GET /api/v1/contacts/c1/channels'] = () => ({ body: { data: [reach('whatsapp', { can_send_text: false, reason: 'window_closed_template_required' })] } });
	await assert.rejects(run(params), (err) => err.message === 'This contact cannot be messaged right now' && /24-hour window/.test(err.description));
	assert.equal(calls.length, 1, 'nothing is sent');
});

// ---------------------------------------------------------- channel dropdown
test('channel dropdown of the Channel resource fits the operation', async () => {
	routes['GET /api/v1/channels'] = () => ({ body: { data: [
		{ id: '1', type: 'whatsapp', name: 'Sales', is_connected: true },
		{ id: '2', type: 'tiktok_posting', name: 'Shop', is_connected: true },
		{ id: '3', type: 'line', name: 'Old', is_connected: false },
	] } });
	const load = (operation) => new Ghamalim().methods.loadOptions.getChannels.call(context({ operation }));
	assert.deepEqual((await load('get')).map((o) => o.name), ['Old (line) - disconnected', 'Sales (whatsapp)', 'Shop (TikTok)']);
	assert.deepEqual(await load('getTemplates'), [{ name: 'Sales (whatsapp)', value: '1' }]);
	assert.deepEqual(await load('getTiktokOptions'), [{ name: 'Shop (TikTok)', value: '2' }]);
});

// ------------------------------------------------------------ trigger dedupe
test('trigger starts once for an event that Ghamalim delivers again', async () => {
	const trigger = new GhamalimTrigger();
	const first = delivery({ id: 'evt_same' });
	assert.ok((await trigger.webhook.call(first.ctx)).workflowData);
	assert.deepEqual(first.sent, { status: 200, json: { received: true } });
	assert.deepEqual(first.ctx.staticData.recentEventIds, ['evt_same']);

	// A retry later, when only the saved state is left (another process, or after a restart).
	const later = delivery({ id: 'evt_same' });
	later.ctx.getWorkflow = () => ({ id: 'after-restart' });
	later.ctx.getWorkflowStaticData = () => ({ webhookSecret: 'sec', recentEventIds: ['evt_same'] });
	assert.deepEqual(await trigger.webhook.call(later.ctx), { noWebhookResponse: true });
	assert.deepEqual(later.sent, { status: 200, json: { received: true, duplicate: true } });

	// Two copies in the same instant, before n8n has saved that state.
	const instant = delivery({ id: 'evt_same' });
	assert.deepEqual(await trigger.webhook.call(instant.ctx), { noWebhookResponse: true });
	assert.equal(instant.sent.json.duplicate, true);

	// A forged delivery is not remembered, so the genuine one still gets through.
	const forged = delivery({ id: 'evt_forged', secret: 'other' });
	await trigger.webhook.call(forged.ctx);
	assert.equal(forged.sent.status, 401);
	const genuine = delivery({ id: 'evt_forged' });
	assert.ok((await trigger.webhook.call(genuine.ctx)).workflowData);
});

// ------------------------------------------------- inbox writes (tickets, contacts, templates)
test('ticket update sends only the chosen fields, unassign as null, snooze in the workflow time zone', async () => {
	routes['PATCH /api/v1/tickets/t1'] = (c) => ({ body: { data: { id: 't1', ...c.body } } });
	const [resolved] = await run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: { status: 'resolved', priority: 'high' } });
	assert.deepEqual(calls[0].body, { status: 'resolved', priority: 'high' });
	assert.equal(resolved.status, 'resolved');

	await run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: { assignedAgentId: 'unassign' } });
	assert.deepEqual(calls[1].body, { assigned_agent_id: null });
	await run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: { assignedAgentId: 'm1' } });
	assert.deepEqual(calls[2].body, { assigned_agent_id: 'm1' });
	await run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: { snoozedUntil: '2026-12-01T09:00:00' } });
	assert.deepEqual(calls[3].body, { snoozed_until: '2026-12-01T01:00:00.000Z' });

	await assert.rejects(run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: {} }), /at least one field/);
	assert.equal(calls.length, 4);
});

test('ticket tags by name or id, remove, notes add and list', async () => {
	routes['POST /api/v1/tickets/t1/tags'] = () => ({ body: { data: { tags: [{ id: 'g1', name: 'vip' }], changed: true } } });
	routes['DELETE /api/v1/tickets/t1/tags/g1'] = () => ({ body: { data: { tags: [], changed: true } } });
	routes['POST /api/v1/tickets/t1/notes'] = (c) => ({ status: 201, body: { data: { id: 'n1', content: c.body.content } } });
	routes['GET /api/v1/tickets/t1/notes'] = () => ({ body: { data: [{ id: 'n1' }, { id: 'n2' }], pagination: { limit: 200, offset: 0, total: 2 } } });

	const [byName] = await run({ resource: 'ticket', operation: 'addTag', ticketId: 't1', tagBy: 'name', tagName: ' vip ' });
	assert.deepEqual(calls[0].body, { name: 'vip' });
	assert.equal(byName.changed, true);
	await run({ resource: 'ticket', operation: 'addTag', ticketId: 't1', tagBy: 'id', tagId: 'g1' });
	assert.deepEqual(calls[1].body, { tag_id: 'g1' });
	const [removed] = await run({ resource: 'ticket', operation: 'removeTag', ticketId: 't1', tagId: 'g1' });
	assert.deepEqual(removed.tags, []);
	const [note] = await run({ resource: 'ticket', operation: 'addNote', ticketId: 't1', noteContent: 'call back at 3pm' });
	assert.deepEqual(calls[3].body, { content: 'call back at 3pm' });
	assert.equal(note.id, 'n1');
	const notes = await run({ resource: 'ticket', operation: 'getNotes', ticketId: 't1', returnAll: true });
	assert.equal(notes.length, 2);
});

test('contact create sends what was filled in; update clears an emptied field and removes an emptied attribute', async () => {
	routes['POST /api/v1/contacts'] = (c) => ({ status: 201, body: { data: { id: 'c1', ...c.body } } });
	routes['PATCH /api/v1/contacts/c1'] = (c) => ({ body: { data: { id: 'c1', ...c.body } } });
	const [created] = await run({
		resource: 'contact', operation: 'create', firstName: ' Ana ', email: '', phone: '+63 917 123 4567',
		contactAdditionalFields: { lastName: 'Cruz', externalId: 'user-42', attributes: { values: [{ name: 'plan', value: 'pro' }, { name: '', value: 'skipped' }, { name: 'empty', value: '' }] } },
	});
	assert.deepEqual(calls[0].body, { first_name: 'Ana', last_name: 'Cruz', phone: '+63 917 123 4567', external_id: 'user-42', attributes: { plan: 'pro' } });
	assert.equal(created.id, 'c1');

	await run({ resource: 'contact', operation: 'update', contactId: 'c1', contactUpdateFields: { email: '', firstName: 'Anna', attributes: { values: [{ name: 'plan', value: '' }, { name: 'seats', value: '5' }] } } });
	assert.deepEqual(calls[1].body, { first_name: 'Anna', email: null, attributes: { plan: null, seats: '5' } });
	await assert.rejects(run({ resource: 'contact', operation: 'update', contactId: 'c1', contactUpdateFields: {} }), /at least one field/);
});

test('contact create or update: updates the match, creates when there is none, and says which', async () => {
	let existing = [{ id: 'c1' }];
	routes['GET /api/v1/contacts'] = () => ({ body: { data: existing, pagination: { limit: 1, offset: 0, total: existing.length } } });
	routes['PATCH /api/v1/contacts/c1'] = (c) => ({ body: { data: { id: 'c1', ...c.body } } });
	routes['POST /api/v1/contacts'] = (c) => ({ status: 201, body: { data: { id: 'c2', ...c.body } } });
	const params = { resource: 'contact', operation: 'upsert', matchOn: 'email', firstName: 'Ana', email: 'ana@example.com', phone: '', contactAdditionalFields: {} };

	const [updated] = await run(params);
	assert.equal(calls[0].query.email, 'ana@example.com');
	assert.equal(calls[1].method, 'PATCH');
	assert.deepEqual(calls[1].body, { first_name: 'Ana', email: 'ana@example.com' });
	assert.equal(updated.created, false);

	existing = [];
	const [made] = await run(params);
	assert.equal(calls[3].method, 'POST');
	assert.equal(made.id, 'c2');
	assert.equal(made.created, true);

	await assert.rejects(run({ ...params, matchOn: 'phone' }), /Match On is empty/);
	await run({ ...params, matchOn: 'externalId', contactAdditionalFields: { externalId: 'user-42' } });
	assert.equal(calls[4].query.external_id, 'user-42');
});

test('WhatsApp template: to a phone number through the channel, or on a ticket, with parameters and idempotency key', async () => {
	routes['POST /api/v1/channels/w1/template-messages'] = () => ({ status: 201, body: { data: { id: 'm1', ticket_id: 't9', contact_id: 'c9', delivery_status: 'sent' } } });
	routes['POST /api/v1/tickets/t1/template'] = () => ({ status: 201, body: { data: { id: 'm2', ticket_id: 't1', delivery_status: 'sent' } } });
	const base = { resource: 'message', operation: 'sendTemplate', templateName: ' order_update ', templateLanguage: 'en_US', bodyParams: { values: [{ value: '#1042' }, { value: 'Friday' }] } };

	const [toPhone] = await run({ ...base, templateSendTo: 'phone', channelId: 'w1', toPhone: '+639171234567', templateOptions: { contactName: 'Ana', headerParam: 'Hi', idempotencyKey: 'order-1042' } });
	assert.deepEqual(calls[0].body, { name: 'order_update', language: 'en_US', body_params: ['#1042', 'Friday'], header_param: 'Hi', to: '+639171234567', contact_name: 'Ana' });
	assert.equal(calls[0].headers['idempotency-key'], 'order-1042');
	assert.equal(toPhone.ticket_id, 't9');

	const [onTicket] = await run({ ...base, bodyParams: {}, templateSendTo: 'ticket', ticketId: 't1', templateOptions: { contactName: 'ignored' } });
	assert.deepEqual(calls[1].body, { name: 'order_update', language: 'en_US' });
	assert.equal(calls[1].headers['idempotency-key'], undefined);
	assert.equal(onTicket.id, 'm2');

	await assert.rejects(run({ ...base, templateSendTo: 'phone', channelId: 'w1', toPhone: ' ', templateOptions: {} }), /To Phone Number is required/);
});

test('a refused template send shows WhatsApp’s reason', async () => {
	routes['POST /api/v1/tickets/t1/template'] = () => ({ status: 422, body: { error: 'This template needs exactly 2 body parameter(s); got 0.' } });
	await assert.rejects(
		run({ resource: 'message', operation: 'sendTemplate', templateSendTo: 'ticket', ticketId: 't1', templateName: 'order_update', templateLanguage: 'en_US', bodyParams: {}, templateOptions: {} }),
		/exactly 2 body parameter/,
	);
});

test('dropdowns: members with an unassign entry, WhatsApp channels only for a template', async () => {
	routes['GET /api/v1/members'] = () => ({ body: { data: [{ id: 'm2', display_name: 'Zed', role: 'agent', status: 'offline' }, { id: 'm1', display_name: 'Ana', role: 'admin', status: 'online' }] } });
	routes['GET /api/v1/channels'] = () => ({ body: { data: [{ id: 'w1', type: 'whatsapp', name: 'Sales', is_connected: true }, { id: 'f1', type: 'facebook_feed', name: 'Page', is_connected: true }] } });
	const node = new Ghamalim();
	const members = await node.methods.loadOptions.getMembers.call(context({}));
	assert.deepEqual(members.map((m) => m.value), ['unassign', 'm1', 'm2']);
	assert.equal(members[1].name, 'Ana (admin)');
	const channels = await node.methods.loadOptions.getChannels.call(context({ operation: 'sendTemplate' }));
	assert.deepEqual(channels.map((c) => c.value), ['w1']);
});

// ------------------------------------------------- 0.3.0: filters, groups, forms, labels, satisfaction
test('ticket list sends every chosen filter; "Nobody" becomes none and times get the workflow zone', async () => {
	routes['GET /api/v1/tickets'] = () => ({ body: { data: [{ id: 't1' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	await run({ resource: 'ticket', operation: 'getAll', filters: { status: 'pending', priority: 'urgent', assignedAgentId: 'unassign', assignedGroupId: 'g1', channelId: 'c1', contactId: ' p1 ', tagId: 'l1', updatedAfter: '2026-12-01T09:00:00' } });
	const { limit, offset, ...sent } = calls[0].query;
	assert.deepEqual(sent, { status: 'pending', priority: 'urgent', assigned_agent_id: 'none', assigned_group_id: 'g1', channel_id: 'c1', contact_id: 'p1', tag_id: 'l1', updated_after: '2026-12-01T01:00:00.000Z' });
});

test('ticket update assigns a group, and refuses a person and a group together', async () => {
	routes['PATCH /api/v1/tickets/t1'] = (c) => ({ body: { data: { id: 't1', ...c.body } } });
	await run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: { assignedGroupId: 'g1' } });
	assert.deepEqual(calls[0].body, { assigned_group_id: 'g1' });
	await assert.rejects(run({ resource: 'ticket', operation: 'update', ticketId: 't1', ticketUpdateFields: { assignedGroupId: 'g1', assignedAgentId: 'm1' } }), /not both/);
	assert.equal(calls.length, 1);
});

test('send form posts the form id with the idempotency key', async () => {
	routes['POST /api/v1/tickets/t1/forms'] = () => ({ status: 201, body: { data: { id: 'msg1', ticket_id: 't1', form_response_id: 'r1', delivery_status: 'sent' } } });
	const [sent] = await run({ resource: 'ticket', operation: 'sendForm', ticketId: 't1', formId: 'f1', formOptions: { idempotencyKey: 'k1' } });
	assert.deepEqual(calls[0].body, { form_id: 'f1' });
	assert.equal(calls[0].headers['idempotency-key'], 'k1');
	assert.equal(sent.form_response_id, 'r1');
});

test('form responses: answered only by default, or waiting, or all', async () => {
	routes['GET /api/v1/forms/f1/responses'] = () => ({ body: { data: [{ id: 'r1' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	await run({ resource: 'form', operation: 'getResponses', formId: 'f1' });
	assert.equal(calls[0].query.submitted, 'true');
	await run({ resource: 'form', operation: 'getResponses', formId: 'f1', responseState: 'waiting' });
	assert.equal(calls[1].query.submitted, 'false');
	await run({ resource: 'form', operation: 'getResponses', formId: 'f1', responseState: 'all' });
	assert.equal(calls[2].query.submitted, undefined);
});

test('label create returns the existing label when the name is taken; delete by id', async () => {
	routes['POST /api/v1/labels'] = (c) => ({ status: 201, body: { data: { id: 'l9', name: c.body.name, color: c.body.color } } });
	routes['GET /api/v1/labels'] = () => ({ body: { data: [] } });
	const [made] = await run({ resource: 'label', operation: 'create', labelName: ' VIP ', labelColor: '#ff0000' });
	assert.deepEqual(calls[1].body, { name: 'VIP', color: '#ff0000' });
	assert.equal(made.created, true);

	calls.length = 0;
	routes['GET /api/v1/labels'] = () => ({ body: { data: [{ id: 'l1', name: 'vip', color: '#3b82f6' }] } });
	const [existing] = await run({ resource: 'label', operation: 'create', labelName: 'VIP' });
	assert.equal(existing.id, 'l1');
	assert.equal(existing.created, false);
	assert.equal(calls.filter((c) => c.method === 'POST').length, 0);

	routes['DELETE /api/v1/labels/l1'] = () => ({ body: { data: { id: 'l1', deleted: true } } });
	const [gone] = await run({ resource: 'label', operation: 'delete', labelId: 'l1' });
	assert.equal(gone.deleted, true);
});

test('groups, saved replies, satisfaction ratings and contact search', async () => {
	routes['GET /api/v1/groups'] = () => ({ body: { data: [{ id: 'g1', name: 'Sales' }] } });
	routes['GET /api/v1/saved-replies'] = () => ({ body: { data: [{ id: 's1', keyword: 'refund', body: 'Hi' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	routes['GET /api/v1/csat-responses'] = () => ({ body: { data: [{ id: 'c1', score: 1 }], pagination: { limit: 50, offset: 0, total: 1 } } });
	routes['GET /api/v1/contacts'] = () => ({ body: { data: [{ id: 'p1' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	const [group] = await run({ resource: 'group', operation: 'getAll' });
	assert.equal(group.name, 'Sales');
	await run({ resource: 'savedReply', operation: 'getAll', filters: { search: ' refund ' } });
	assert.equal(calls[1].query.q, 'refund');
	await run({ resource: 'satisfaction', operation: 'getAll', filters: { score: 1, ticketId: 't1' } });
	assert.equal(calls[2].query.score, '1');
	assert.equal(calls[2].query.ticket_id, 't1');
	await run({ resource: 'contact', operation: 'getAll', filters: { search: 'ana' } });
	assert.equal(calls[3].query.q, 'ana');
});

test('dropdowns: groups and forms by name', async () => {
	routes['GET /api/v1/groups'] = () => ({ body: { data: [{ id: 'g2', name: 'Support' }, { id: 'g1', name: 'Sales' }] } });
	routes['GET /api/v1/forms'] = () => ({ body: { data: [{ id: 'f1', name: 'Lead form' }] } });
	const node = new Ghamalim();
	assert.deepEqual((await node.methods.loadOptions.getGroups.call(context({}))).map((g) => g.value), ['g1', 'g2']);
	assert.deepEqual(await node.methods.loadOptions.getForms.call(context({})), [{ name: 'Lead form', value: 'f1' }]);
});

// ------------------------------------------------- 0.4.0
test('custom fields, report summary, messages since a time, and the automatic replies switch', async () => {
	routes['GET /api/v1/custom-fields'] = () => ({ body: { data: [{ id: 'a1', key: 'plan', label: 'Plan', data_type: 'text' }] } });
	routes['GET /api/v1/reports/summary'] = (c) => ({ body: { data: { period_days: Number(c.query.days), tickets_created: 4 } } });
	routes['GET /api/v1/tickets/t1/messages'] = () => ({ body: { data: [{ id: 'm1' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	routes['PATCH /api/v1/contacts/p1'] = (c) => ({ body: { data: { id: 'p1', ...c.body } } });
	const [field] = await run({ resource: 'customField', operation: 'getAll' });
	assert.equal(field.key, 'plan');
	const [report] = await run({ resource: 'report', operation: 'getSummary', days: 7 });
	assert.equal(report.period_days, 7);
	await run({ resource: 'message', operation: 'getAll', ticketId: 't1', messageFilters: { createdAfter: '2026-12-01T09:00:00' } });
	assert.equal(calls[2].query.created_after, '2026-12-01T01:00:00.000Z');
	await run({ resource: 'contact', operation: 'update', contactId: 'p1', contactUpdateFields: { botEnabled: false } });
	assert.deepEqual(calls[3].body, { bot_enabled: false });
});

test('Simplify returns the short ticket and contact shapes, and leaves the raw data alone by default', async () => {
	routes['GET /api/v1/tickets/t1'] = () => ({ body: { data: { id: 't1', status: 'pending', priority: 'high', created_at: 'c', updated_at: 'u', resolved_at: null, snoozed_until: null, assigned_agent_id: 'm1', assigned_group_id: null, channel_id: 'ch', channel_type: 'whatsapp', contact: { id: 'p1', full_name: 'Ana', email: null, phone: null }, tags: [{ id: 'l1', name: 'vip', color: null }] } } });
	routes['GET /api/v1/contacts/p1'] = () => ({ body: { data: { id: 'p1', full_name: 'Ana', first_name: 'Ana', last_name: null, email: 'a@x.com', phone: null, language: 'en', attributes: { plan: 'pro' }, customer_lifetime_value: 0, bot_enabled: true, created_at: 'c' } } });
	const [raw] = await run({ resource: 'ticket', operation: 'get', ticketId: 't1' });
	assert.equal(raw.channel_id, 'ch');
	const [short] = await run({ resource: 'ticket', operation: 'get', ticketId: 't1', simplify: true });
	assert.deepEqual(Object.keys(short), ['id', 'status', 'priority', 'created_at', 'updated_at', 'assigned_agent_id', 'channel_type', 'contact_id', 'contact_name', 'tags']);
	assert.equal(short.contact_name, 'Ana');
	assert.deepEqual(short.tags, ['vip']);
	const [contact] = await run({ resource: 'contact', operation: 'get', contactId: 'p1', simplify: true });
	assert.equal(contact.first_name, undefined);
	assert.deepEqual(contact.attributes, { plan: 'pro' });
});

// ------------------------------------------------- 0.5.0: resource locators
test('a resource locator value works in both modes, and plain IDs from expressions still do', async () => {
	routes['GET /api/v1/tickets/t1'] = () => ({ body: { data: { id: 't1' } } });
	routes['GET /api/v1/contacts/p1'] = () => ({ body: { data: { id: 'p1' } } });
	routes['POST /api/v1/messages/m1/moderate'] = () => ({ body: { data: { id: 'm1' } } });
	await run({ resource: 'ticket', operation: 'get', ticketId: { __rl: true, mode: 'list', value: 't1' } });
	await run({ resource: 'ticket', operation: 'get', ticketId: { __rl: true, mode: 'id', value: ' t1 ' } });
	await run({ resource: 'contact', operation: 'get', contactId: { __rl: true, mode: 'list', value: 'p1' } });
	await run({ resource: 'message', operation: 'moderate', messageId: { __rl: true, mode: 'id', value: 'm1' }, moderationAction: 'hide' });
	assert.deepEqual(calls.map((c) => c.path), ['/api/v1/tickets/t1', '/api/v1/tickets/t1', '/api/v1/contacts/p1', '/api/v1/messages/m1/moderate']);
	await assert.rejects(run({ resource: 'ticket', operation: 'get', ticketId: { __rl: true, mode: 'id', value: '' } }), /Ticket ID is required/);
});

test('"From List" pickers: newest first, a label people can recognise, paging and typed search', async () => {
	routes['GET /api/v1/tickets'] = (c) => ({ body: { data: [{ id: 'aaaaaaaa-1111', status: 'pending', channel_type: 'whatsapp', contact: { full_name: 'Ana Reyes' } }, { id: 'bbbbbbbb-2222', status: 'resolved', channel_type: 'line', contact: null }], pagination: { limit: 50, offset: Number(c.query.offset), total: 120 } } });
	routes['GET /api/v1/contacts'] = (c) => ({ body: { data: [{ id: 'p1', full_name: 'Ana', email: 'a@x.com', phone: null }], pagination: { limit: 50, offset: 0, total: 1 } } });
	routes['GET /api/v1/posts'] = () => ({ body: { data: [{ id: 'q1', status: 'published', caption: 'New listing near the station' }], pagination: { limit: 50, offset: 0, total: 1 } } });
	const node = new Ghamalim();
	const tickets = await node.methods.listSearch.searchTickets.call(context({}), undefined, undefined);
	assert.equal(tickets.results[0].name, 'Ana Reyes · pending · whatsapp · aaaaaaaa');
	assert.equal(tickets.results[1].name, 'Unknown contact · resolved · line · bbbbbbbb');
	assert.equal(tickets.paginationToken, '2');
	const next = await node.methods.listSearch.searchTickets.call(context({}), undefined, '2');
	assert.equal(calls.at(-1).query.offset, '2');
	assert.equal(next.paginationToken, '4');
	const filtered = await node.methods.listSearch.searchTickets.call(context({}), 'ana', undefined);
	assert.deepEqual(filtered.results.map((r) => r.value), ['aaaaaaaa-1111']);
	const contacts = await node.methods.listSearch.searchContacts.call(context({}), 'an', undefined);
	assert.equal(calls.at(-1).query.q, 'an');
	assert.equal(contacts.results[0].name, 'Ana · a@x.com');
	assert.equal(contacts.paginationToken, undefined);
	await node.methods.listSearch.searchContacts.call(context({}), 'a', undefined);
	assert.equal(calls.at(-1).query.q, undefined);
	const posts = await node.methods.listSearch.searchPosts.call(context({}), undefined, undefined);
	assert.equal(posts.results[0].name, 'New listing near the station · published');
});
