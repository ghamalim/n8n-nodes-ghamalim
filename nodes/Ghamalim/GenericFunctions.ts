import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type ApiContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

type ApiRequestOptions = {
	body?: IDataObject | FormData;
	qs?: IDataObject;
	headers?: IDataObject;
	itemIndex?: number;
};

const PAGE_SIZE = 200;

export async function getApiBaseUrl(this: ApiContext): Promise<string> {
	const credentials = await this.getCredentials('ghamalimApi');
	const baseUrl = String(credentials.baseUrl || 'https://app.ghamalim.net').replace(/\/+$/, '');
	return `${baseUrl}/api/v1`;
}

/**
 * The API answers errors as `{ "error": "human readable reason" }` (plus
 * `request_id` on a 500 and `data.delivery_error` when a provider refused a
 * message). Surface that text instead of a bare "Request failed with status
 * code 422", so the person building the workflow can act on it.
 */
function toNodeApiError(context: ApiContext, error: unknown, itemIndex?: number): NodeApiError {
	// Inside n8n the request helper has already turned the failure into a
	// NodeApiError: the API's answer is on `context.data` (and on the axios
	// error kept as `cause`). A plain axios-style error carries it on
	// `response`. Read whichever is there.
	type HttpResponse = { status?: number; data?: unknown; headers?: Record<string, string> };
	const source = error as {
		message?: string;
		httpCode?: string | null;
		response?: HttpResponse;
		cause?: { response?: HttpResponse };
		context?: { data?: unknown };
	};
	const response = source.response ?? source.cause?.response;
	const status = response?.status ?? (source.httpCode ? Number(source.httpCode) : undefined);
	let payload = response?.data ?? source.context?.data;
	if (typeof payload === 'string') {
		try {
			payload = JSON.parse(payload);
		} catch {
			// keep the raw text
		}
	}
	const body = payload && typeof payload === 'object' ? (payload as IDataObject) : undefined;
	const apiMessage = typeof body?.error === 'string' ? body.error : undefined;

	const details: string[] = [];
	const deliveryError = (body?.data as IDataObject | undefined)?.delivery_error;
	if (typeof deliveryError === 'string') details.push(deliveryError);
	if (status === 401) details.push('Check the API key in the Ghamalim credential.');
	if (status === 402)
		details.push('The workspace has no active subscription. Open Settings > Billing in Ghamalim.');
	if (status === 429) {
		const retryAfter = response?.headers?.['retry-after'];
		details.push(
			retryAfter
				? `Rate limit reached. Try again in ${retryAfter} seconds.`
				: 'Rate limit reached. Try again shortly.',
		);
	}
	if (typeof body?.request_id === 'string') details.push(`Request ID: ${body.request_id}`);
	if (status !== undefined) details.push(`(HTTP ${status})`);

	const message = apiMessage ?? source.message ?? 'Ghamalim did not accept the request';
	// A fresh object on purpose: NodeApiError hands back an error that is
	// already a NodeApiError untouched, which would drop the API's own reason.
	// httpCode goes on the error afterwards for the same reason: given to the
	// constructor, n8n replaces the message with its generic text for that status.
	const apiError = new NodeApiError(context.getNode(), { message } as JsonObject, {
		message,
		description: details.join(' ') || undefined,
		itemIndex,
	});
	if (status !== undefined) apiError.httpCode = String(status);
	return apiError;
}

export async function apiRequest(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: ApiRequestOptions = {},
): Promise<IDataObject> {
	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${await getApiBaseUrl.call(this)}${path}`,
		headers: { Accept: 'application/json', ...options.headers },
		json: !(options.body instanceof FormData),
	};
	if (options.qs && Object.keys(options.qs).length) requestOptions.qs = options.qs;
	if (options.body !== undefined) requestOptions.body = options.body;

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'ghamalimApi',
			requestOptions,
		);
		// DELETE /webhooks/{id} answers 204 with no body.
		if (response === undefined || response === null || response === '') return {};
		return (typeof response === 'string' ? JSON.parse(response) : response) as IDataObject;
	} catch (error) {
		throw toNodeApiError(this, error, options.itemIndex);
	}
}

/** Unwraps `{ data: ... }` for endpoints that return one object. */
export async function apiRequestData(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: ApiRequestOptions = {},
): Promise<IDataObject> {
	const response = await apiRequest.call(this, method, path, options);
	return (response.data ?? response) as IDataObject;
}

/**
 * List endpoints. Paginated ones (`limit` / `offset`, max 200 per page, with
 * `pagination.total`) are walked until `returnAll` or `limit` is satisfied;
 * the unpaginated ones (channels, labels, media, templates) answer everything
 * in one response and are trimmed locally.
 */
export async function apiRequestList(
	this: ApiContext,
	path: string,
	options: {
		qs?: IDataObject;
		paginated: boolean;
		returnAll: boolean;
		limit?: number;
		itemIndex?: number;
	},
): Promise<IDataObject[]> {
	const wanted = options.returnAll ? Infinity : Math.max(1, options.limit ?? 50);

	if (!options.paginated) {
		const response = await apiRequest.call(this, 'GET', path, {
			qs: options.qs,
			itemIndex: options.itemIndex,
		});
		const rows = (response.data as IDataObject[] | undefined) ?? [];
		return options.returnAll ? rows : rows.slice(0, wanted);
	}

	const results: IDataObject[] = [];
	let offset = 0;
	while (results.length < wanted) {
		const pageSize = Math.min(PAGE_SIZE, wanted - results.length);
		const response = await apiRequest.call(this, 'GET', path, {
			qs: { ...options.qs, limit: pageSize, offset },
			itemIndex: options.itemIndex,
		});
		const rows = (response.data as IDataObject[] | undefined) ?? [];
		results.push(...rows);
		offset += rows.length;
		const total = (response.pagination as IDataObject | undefined)?.total as number | undefined;
		if (rows.length < pageSize || (total !== undefined && offset >= total)) break;
	}
	return results;
}

type ChannelRow = {
	id: string;
	type: string;
	name: string | null;
	is_connected: boolean;
	capabilities?: { api?: { publish_posts?: boolean } };
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
	facebook_feed: 'Facebook',
	instagram_feed: 'Instagram',
	tiktok_posting: 'TikTok',
	linkedin_page: 'LinkedIn',
	x_profile: 'X',
};

export async function loadPostChannels(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await apiRequest.call(this, 'GET', '/channels');
	const channels = (response.data as ChannelRow[] | undefined) ?? [];
	return channels
		.filter((channel) => channel.is_connected && channel.capabilities?.api?.publish_posts)
		.map((channel) => ({
			name: `${channel.name || 'Unnamed channel'} (${CHANNEL_TYPE_LABELS[channel.type] ?? channel.type})`,
			value: channel.id,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Channel dropdown of the Channel resource: only the channels the chosen operation applies to. */
export async function loadChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const operation = this.getCurrentNodeParameter('operation') as string | undefined;
	const onlyType =
		operation === 'getTemplates' || operation === 'sendTemplate'
			? 'whatsapp'
			: operation === 'getTiktokOptions'
				? 'tiktok_posting'
				: undefined;
	const response = await apiRequest.call(this, 'GET', '/channels');
	const channels = (response.data as ChannelRow[] | undefined) ?? [];
	return channels
		.filter((channel) => !onlyType || channel.type === onlyType)
		.map((channel) => ({
			name: `${channel.name || 'Unnamed channel'} (${CHANNEL_TYPE_LABELS[channel.type] ?? channel.type})${channel.is_connected ? '' : ' - disconnected'}`,
			value: channel.id,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export type Reachability = {
	channel: { id: string; type: string; name: string | null };
	ticket_id: string | null;
	last_inbound_at: string | null;
	can_send_text: boolean;
	reason: string | null;
};

const REACHABILITY_REASONS: Record<string, string> = {
	no_conversation: 'the contact has never written on this channel',
	not_supported_by_api: 'this channel cannot be messaged through the API',
	contact_blocked_channel: 'the contact blocked this channel',
	window_closed_template_required:
		"WhatsApp's 24-hour window is closed, so only an approved template can be sent (from the Ghamalim app)",
	window_closed_human_agent_in_app_only:
		'the 24-hour window is closed; an agent can still reply from the Ghamalim app',
	window_closed: 'the messaging window of this channel is closed',
};

/**
 * Picks the conversation to message a contact on, from GET /contacts/{id}/channels:
 * the preferred channel type when it can be used, otherwise the usable one
 * with the most recent customer message. When none can be used, `why` says
 * the reason for each channel in plain words.
 */
export function pickReachableTicket(
	rows: Reachability[],
	preferredType?: string,
): { ticketId: string; channelType: string } | { why: string } {
	const usable = rows
		.filter((row) => row.can_send_text && row.ticket_id)
		.sort((a, b) => (b.last_inbound_at ?? '').localeCompare(a.last_inbound_at ?? ''));
	const wanted = preferredType?.trim().toLowerCase();
	const chosen = (wanted && usable.find((row) => row.channel.type.toLowerCase() === wanted)) || usable[0];
	if (chosen?.ticket_id) return { ticketId: chosen.ticket_id, channelType: chosen.channel.type };
	if (rows.length === 0) return { why: 'This contact has no conversation on any channel yet.' };
	return {
		why: rows
			.map(
				(row) =>
					`${row.channel.name || row.channel.type}: ${REACHABILITY_REASONS[row.reason ?? ''] ?? row.reason ?? 'cannot be messaged right now'}`,
			)
			.join('; '),
	};
}

const POST_FINAL_STATUSES = ['published', 'partially_published', 'failed'];
const POST_NOT_PUBLISHING_STATUSES = ['draft', 'pending_approval', 'rejected'];

/** Whether a post returned by the API is on its way out now (so waiting for the result makes sense). */
export function isPublishingNow(post: IDataObject, now = Date.now()): boolean {
	const status = String(post.status ?? '');
	if (POST_FINAL_STATUSES.includes(status) || POST_NOT_PUBLISHING_STATUSES.includes(status)) return false;
	const scheduledAt = typeof post.scheduled_at === 'string' ? Date.parse(post.scheduled_at) : NaN;
	// "scheduled" is also the status right after a publish-now request; a real
	// schedule has a time comfortably in the future.
	return !(Number.isFinite(scheduledAt) && scheduledAt - now > 30_000);
}

export function isFinalPostStatus(post: IDataObject): boolean {
	return POST_FINAL_STATUSES.includes(String(post.status ?? ''));
}

// ----------------------------------------------------------- "From List" pickers
// Each page is PAGE_SIZE rows, newest first; the paginationToken is the next offset. The API has no free-text search for
// tickets and posts, so the typed text narrows the page that was loaded (contacts are searched by the API itself).
const PICKER_PAGE_SIZE = 50;
type Page = { data?: IDataObject[]; pagination?: { total?: number } };

function pickerResult(
	page: Page,
	offset: number,
	toRow: (row: IDataObject) => { name: string; value: string },
	filter?: string,
): INodeListSearchResult {
	const rows = (page.data ?? []).map(toRow);
	const needle = filter?.trim().toLowerCase();
	const results = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
	const next = offset + (page.data ?? []).length;
	return {
		results,
		...(next < (page.pagination?.total ?? 0) ? { paginationToken: String(next) } : {}),
	};
}

const clip = (text: unknown, max: number) => {
	const value = String(text ?? '').replace(/\s+/g, ' ').trim();
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

export async function searchTickets(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const offset = Number(paginationToken) || 0;
	const page = (await apiRequest.call(this, 'GET', '/tickets', {
		qs: { limit: PICKER_PAGE_SIZE, offset },
	})) as Page;
	return pickerResult(
		page,
		offset,
		(ticket) => {
			const contact = (ticket.contact as IDataObject | null) ?? null;
			const who = clip(contact?.full_name, 40) || 'Unknown contact';
			const where = ticket.channel_type ? ` · ${ticket.channel_type}` : '';
			return {
				name: `${who} · ${ticket.status}${where} · ${String(ticket.id).slice(0, 8)}`,
				value: String(ticket.id),
			};
		},
		filter,
	);
}

export async function searchContacts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const offset = Number(paginationToken) || 0;
	const search = filter?.trim() ?? '';
	const page = (await apiRequest.call(this, 'GET', '/contacts', {
		qs: { limit: PICKER_PAGE_SIZE, offset, ...(search.length >= 2 ? { q: search } : {}) },
	})) as Page;
	return pickerResult(page, offset, (contact) => {
		const detail = [contact.email, contact.phone].filter(Boolean).join(' · ');
		return {
			name: `${clip(contact.full_name, 40) || 'Unnamed contact'}${detail ? ` · ${detail}` : ''}`,
			value: String(contact.id),
		};
	});
}

export async function searchPosts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const offset = Number(paginationToken) || 0;
	const page = (await apiRequest.call(this, 'GET', '/posts', {
		qs: { limit: PICKER_PAGE_SIZE, offset },
	})) as Page;
	return pickerResult(
		page,
		offset,
		(post) => ({
			name: `${clip(post.caption, 60) || '(no caption)'} · ${post.status}`,
			value: String(post.id),
		}),
		filter,
	);
}

export async function loadLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const response = await apiRequest.call(this, 'GET', '/labels');
	const labels = (response.data as Array<{ id: string; name: string }> | undefined) ?? [];
	return labels
		.map((label) => ({ name: label.name, value: label.id }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Assignee dropdown of Ticket > Update: the team, plus an entry that unassigns. */
export const UNASSIGN_VALUE = 'unassign';
export async function loadMembers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const response = await apiRequest.call(this, 'GET', '/members');
	const members =
		(response.data as Array<{ id: string; display_name: string; role: string; status: string }> | undefined) ??
		[];
	return [
		{ name: 'Nobody (Unassign)', value: UNASSIGN_VALUE },
		...members
			.map((member) => ({ name: `${member.display_name} (${member.role})`, value: member.id }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	];
}

async function loadNamed(this: ILoadOptionsFunctions, path: string): Promise<INodePropertyOptions[]> {
	const response = await apiRequest.call(this, 'GET', path);
	const rows = (response.data as Array<{ id: string; name: string }> | undefined) ?? [];
	return rows
		.map((row) => ({ name: row.name, value: row.id }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await loadNamed.call(this, '/groups');
}

export async function loadForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await loadNamed.call(this, '/forms');
}

/** Rows of a "name / value" fixed collection as an object; rows without a name are skipped. */
export function attributeRows(value: unknown, emptyValue: string | null): IDataObject {
	const rows = ((value as IDataObject | undefined)?.values as IDataObject[] | undefined) ?? [];
	const out: IDataObject = {};
	for (const row of rows) {
		const name = String(row.name ?? '').trim();
		if (!name) continue;
		const text = row.value === undefined || row.value === null ? '' : String(row.value);
		out[name] = text === '' ? emptyValue : text;
	}
	return out;
}

function zoneOffsetMs(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(date);
	const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const asUtc = Date.UTC(
		part('year'),
		part('month') - 1,
		part('day'),
		part('hour'),
		part('minute'),
		part('second'),
	);
	return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The API wants ISO 8601 WITH a time zone. n8n's date picker produces wall
 * time without one ("2026-11-20T09:00:00"), which means "in the workflow's
 * time zone" to the person who picked it. A value that already carries a zone
 * (an expression, another node's output) is passed through unchanged in
 * meaning. Returns null when the value is not a date.
 */
export function toZonedIso(value: string, timeZone: string): string | null {
	const text = value.trim();
	if (!text) return null;
	if (/(z|[+-]\d{2}(:?\d{2})?)$/i.test(text)) {
		const parsed = new Date(text);
		return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
	}
	const wallAsUtc = new Date(`${text.replace(' ', 'T')}Z`);
	if (Number.isNaN(wallAsUtc.getTime())) return null;
	let offset: number;
	try {
		offset = zoneOffsetMs(wallAsUtc, timeZone);
	} catch {
		return null;
	}
	let result = new Date(wallAsUtc.getTime() - offset);
	// Around a daylight-saving change the first guess can land on the other side.
	const corrected = zoneOffsetMs(result, timeZone);
	if (corrected !== offset) result = new Date(wallAsUtc.getTime() - corrected);
	return result.toISOString();
}

/** Media URLs arrive as a list (one field per URL) or as text separated by commas / new lines. */
export function parseMediaUrls(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : [];
	return raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

/** Output of "Simplify" for a ticket: the 10 fields people use most, with the contact flattened and the tags as names. */
export function simplifyTicket(row: IDataObject): IDataObject {
	const contact = (row.contact as IDataObject | null | undefined) ?? null;
	const tags = Array.isArray(row.tags) ? (row.tags as IDataObject[]).map((tag) => tag.name) : undefined;
	return {
		id: row.id,
		status: row.status,
		priority: row.priority,
		created_at: row.created_at,
		updated_at: row.updated_at,
		assigned_agent_id: row.assigned_agent_id,
		channel_type: row.channel_type,
		contact_id: contact?.id ?? null,
		contact_name: contact?.full_name ?? null,
		...(tags ? { tags } : {}),
	};
}

/** Output of "Simplify" for a contact: the fields people use most, without the splits of the name. */
export function simplifyContact(row: IDataObject): IDataObject {
	return {
		id: row.id,
		full_name: row.full_name,
		email: row.email,
		phone: row.phone,
		language: row.language,
		bot_enabled: row.bot_enabled,
		attributes: row.attributes,
		created_at: row.created_at,
	};
}
