import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import {
	apiRequest,
	apiRequestData,
	apiRequestList,
	attributeRows,
	isFinalPostStatus,
	isPublishingNow,
	loadChannels,
	loadForms,
	loadGroups,
	loadLabels,
	loadMembers,
	searchContacts,
	searchPosts,
	searchTickets,
	loadPostChannels,
	parseMediaUrls,
	pickReachableTicket,
	simplifyContact,
	simplifyTicket,
	toZonedIso,
	UNASSIGN_VALUE,
} from './GenericFunctions';
import type { Reachability } from './GenericFunctions';
import {
	channelFields,
	channelOperations,
	contactFields,
	contactOperations,
	customFieldFields,
	customFieldOperations,
	formFields,
	formOperations,
	groupFields,
	groupOperations,
	labelFields,
	labelOperations,
	mediaFields,
	mediaOperations,
	messageFields,
	messageOperations,
	reportFields,
	reportOperations,
	satisfactionFields,
	satisfactionOperations,
	savedReplyFields,
	savedReplyOperations,
	ticketFields,
	ticketOperations,
} from './descriptions/InboxDescription';
import { postFields, postOperations } from './descriptions/PostDescription';

function requireId(
	context: IExecuteFunctions,
	parameter: string,
	label: string,
	itemIndex: number,
): string {
	// extractValue: a resource locator ("From List" / "By ID") hands over just its value.
	const value = String(
		context.getNodeParameter(parameter, itemIndex, '', { extractValue: true }) ?? '',
	).trim();
	if (!value) {
		throw new NodeOperationError(context.getNode(), `${label} is required`, { itemIndex });
	}
	return encodeURIComponent(value);
}

function scheduledAtValue(
	context: IExecuteFunctions,
	value: unknown,
	itemIndex: number,
): string | null {
	const text = String(value ?? '').trim();
	if (!text) return null;
	const iso = toZonedIso(text, context.getTimezone());
	if (!iso) {
		throw new NodeOperationError(context.getNode(), `"${text}" is not a valid date and time`, {
			itemIndex,
			description: 'Use a format like 2026-12-01T09:00:00+08:00',
		});
	}
	return iso;
}

/** Builds the API's `tiktok` object from the flat "TikTok: ..." fields, or undefined when none was set. */
function tiktokSettings(
	context: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): IDataObject | undefined {
	const keys = [
		'tiktokPrivacyLevel',
		'tiktokAllowComment',
		'tiktokAllowDuet',
		'tiktokAllowStitch',
		'tiktokYourBrand',
		'tiktokBrandedContent',
	];
	if (!keys.some((key) => fields[key] !== undefined)) return undefined;
	if (!fields.tiktokPrivacyLevel) {
		throw new NodeOperationError(context.getNode(), 'TikTok: Visibility is required', {
			itemIndex,
			description: 'Add the "TikTok: Visibility" field when you set any other TikTok field.',
		});
	}
	const tiktok: IDataObject = { privacy_level: fields.tiktokPrivacyLevel };
	if (fields.tiktokAllowComment !== undefined) tiktok.allow_comment = fields.tiktokAllowComment;
	if (fields.tiktokAllowDuet !== undefined) tiktok.allow_duet = fields.tiktokAllowDuet;
	if (fields.tiktokAllowStitch !== undefined) tiktok.allow_stitch = fields.tiktokAllowStitch;
	if (fields.tiktokYourBrand !== undefined) tiktok.your_brand = fields.tiktokYourBrand;
	if (fields.tiktokBrandedContent !== undefined) tiktok.branded_content = fields.tiktokBrandedContent;
	// TikTok's "commercial content" switch is simply "one of the two is on".
	if (fields.tiktokYourBrand === true || fields.tiktokBrandedContent === true) {
		tiktok.commercial_content = true;
	}
	return tiktok;
}

async function binaryFormData(
	context: IExecuteFunctions,
	itemIndex: number,
	extraFields: Record<string, string> = {},
): Promise<FormData> {
	const property = context.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const meta = context.helpers.assertBinaryData(itemIndex, property);
	const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, property);
	const form = new FormData();
	for (const [key, value] of Object.entries(extraFields)) form.append(key, value);
	form.append(
		'file',
		new Blob([new Uint8Array(buffer)], { type: meta.mimeType || 'application/octet-stream' }),
		meta.fileName || `file.${meta.fileExtension || 'bin'}`,
	);
	return form;
}

// How often the post is re-read while waiting. Well inside the API's budget
// of 120 requests a minute even with several items waiting at once.
export const waitSettings = { pollIntervalMs: 3000 };

/**
 * "Wait Until Published": re-reads the post until every channel has answered
 * (published, partially published or failed) or the time is up, and returns
 * the latest version either way. Never fails the node because of the wait:
 * the post keeps publishing in Ghamalim regardless.
 */
async function waitForPost(
	context: IExecuteFunctions,
	post: IDataObject,
	itemIndex: number,
): Promise<IDataObject> {
	if (!context.getNodeParameter('waitUntilPublished', itemIndex, false)) return post;
	if (!post.id || !isPublishingNow(post)) return post;
	const maxWaitSeconds = Math.min(
		600,
		Math.max(5, Number(context.getNodeParameter('maxWaitSeconds', itemIndex, 120)) || 120),
	);
	const deadline = Date.now() + maxWaitSeconds * 1000;
	let latest = post;
	while (!isFinalPostStatus(latest) && Date.now() < deadline) {
		await sleep(Math.min(waitSettings.pollIntervalMs, Math.max(0, deadline - Date.now())));
		latest = await apiRequestData.call(
			context,
			'GET',
			`/posts/${encodeURIComponent(String(post.id))}`,
			{ itemIndex },
		);
	}
	return { ...latest, wait_timed_out: !isFinalPostStatus(latest) };
}

async function executePost(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'create') {
		const additional = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const channelIds = this.getNodeParameter('channelIds', i, []) as string[];
		const caption = (this.getNodeParameter('caption', i, '') as string).trim();
		const media = parseMediaUrls(this.getNodeParameter('mediaUrls', i, ''));
		const draft = additional.draft === true;

		if (!draft && channelIds.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Choose at least one channel', {
				itemIndex: i,
				description: 'Channels are only optional when "Save as Draft" is on.',
			});
		}
		if (!caption && media.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Add a caption, media, or both', {
				itemIndex: i,
			});
		}

		const body: IDataObject = {};
		if (channelIds.length) body.channel_ids = channelIds;
		if (caption) body.caption = caption;
		if (media.length) body.media = media;
		if (draft) body.draft = true;
		if (additional.requireApproval === true) body.require_approval = true;
		if (additional.externalId) body.external_id = additional.externalId;
		const labelIds = (additional.labelIds as string[] | undefined) ?? [];
		if (labelIds.length) body.label_ids = labelIds;
		const scheduledAt = scheduledAtValue(this, additional.scheduledAt, i);
		if (scheduledAt) body.scheduled_at = scheduledAt;
		const tiktok = tiktokSettings(this, additional, i);
		if (tiktok) body.tiktok = tiktok;

		const headers: IDataObject = {};
		if (additional.idempotencyKey) headers['Idempotency-Key'] = String(additional.idempotencyKey);
		const created = await apiRequestData.call(this, 'POST', '/posts', {
			body,
			headers,
			itemIndex: i,
		});
		return await waitForPost(this, created, i);
	}

	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = {};
		if (filters.status) qs.status = filters.status;
		if (filters.externalId) qs.external_id = filters.externalId;
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		return await apiRequestList.call(this, '/posts', {
			qs,
			paginated: true,
			returnAll,
			limit: returnAll ? undefined : (this.getNodeParameter('limit', i, 50) as number),
			itemIndex: i,
		});
	}

	if (operation === 'generateCaptions') {
		const options = this.getNodeParameter('captionOptions', i, {}) as IDataObject;
		const body: IDataObject = { brief: this.getNodeParameter('brief', i) as string };
		const platforms = (options.platforms as string[] | undefined) ?? [];
		if (platforms.length) body.platforms = platforms;
		if (options.tone) body.tone = options.tone;
		const data = await apiRequestData.call(this, 'POST', '/posts/ai/captions', {
			body,
			itemIndex: i,
		});
		return (data.variants as IDataObject[] | undefined) ?? [];
	}

	if (operation === 'getBestTimes') {
		const options = this.getNodeParameter('bestTimeOptions', i, {}) as IDataObject;
		const qs: IDataObject = { timezone: options.timezone || this.getTimezone() };
		const channelIds = (options.channelIds as string[] | undefined) ?? [];
		if (channelIds.length) qs.channel_ids = channelIds.join(',');
		if (options.suggestions) qs.limit = options.suggestions;
		const response = await apiRequest.call(this, 'GET', '/posts/best-times', { qs, itemIndex: i });
		return (response.data as IDataObject[] | undefined) ?? [];
	}

	const postId = requireId(this, 'postId', 'Post ID', i);

	if (operation === 'get') {
		return await apiRequestData.call(this, 'GET', `/posts/${postId}`, { itemIndex: i });
	}

	if (operation === 'update') {
		const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		if (fields.caption !== undefined) body.caption = fields.caption;
		if (fields.channelIds !== undefined) body.channel_ids = fields.channelIds;
		if (fields.labelIds !== undefined) body.label_ids = fields.labelIds;
		if (fields.mediaUrls !== undefined) body.media = parseMediaUrls(fields.mediaUrls);
		if (fields.scheduledAt !== undefined) {
			body.scheduled_at = scheduledAtValue(this, fields.scheduledAt, i);
		}
		const tiktok = tiktokSettings(this, fields, i);
		if (tiktok) body.tiktok = tiktok;
		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
				itemIndex: i,
			});
		}
		return await apiRequestData.call(this, 'PATCH', `/posts/${postId}`, { body, itemIndex: i });
	}

	if (operation === 'delete') {
		return await apiRequestData.call(this, 'DELETE', `/posts/${postId}`, { itemIndex: i });
	}

	if (operation === 'publish') {
		const options = this.getNodeParameter('publishOptions', i, {}) as IDataObject;
		const body: IDataObject = {};
		const channelIds = (options.channelIds as string[] | undefined) ?? [];
		if (channelIds.length) body.channel_ids = channelIds;
		const scheduledAt = scheduledAtValue(this, options.scheduledAt, i);
		if (scheduledAt) body.scheduled_at = scheduledAt;
		const accepted = await apiRequestData.call(this, 'POST', `/posts/${postId}/publish`, {
			body,
			itemIndex: i,
		});
		return await waitForPost(this, accepted, i);
	}

	if (operation === 'reject') {
		const reason = (this.getNodeParameter('reason', i, '') as string).trim();
		return await apiRequestData.call(this, 'POST', `/posts/${postId}/reject`, {
			body: reason ? { reason } : {},
			itemIndex: i,
		});
	}

	const actionPaths: Record<string, string> = {
		approve: 'approve',
		retry: 'retry',
		refreshInsights: 'refresh-insights',
	};
	if (actionPaths[operation]) {
		const result = await apiRequestData.call(
			this,
			'POST',
			`/posts/${postId}/${actionPaths[operation]}`,
			{ body: {}, itemIndex: i },
		);
		return operation === 'refreshInsights' ? result : await waitForPost(this, result, i);
	}

	throw new NodeOperationError(this.getNode(), `Unknown post operation "${operation}"`, {
		itemIndex: i,
	});
}

async function executeMessage(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'send') {
		const content = (this.getNodeParameter('content', i, '') as string).trim();
		const attachFile = this.getNodeParameter('attachFile', i, false) as boolean;
		const options = this.getNodeParameter('sendOptions', i, {}) as IDataObject;
		if (!content && !attachFile) {
			throw new NodeOperationError(this.getNode(), 'Enter a text or attach a file', {
				itemIndex: i,
			});
		}

		let ticketId: string;
		let sentOn: IDataObject = {};
		if (this.getNodeParameter('sendTo', i, 'ticket') === 'contact') {
			const contactId = requireId(this, 'contactId', 'Contact ID', i);
			const reach = await apiRequest.call(this, 'GET', `/contacts/${contactId}/channels`, {
				itemIndex: i,
			});
			const picked = pickReachableTicket(
				(reach.data as Reachability[] | undefined) ?? [],
				this.getNodeParameter('preferredChannelType', i, '') as string,
			);
			if ('why' in picked) {
				throw new NodeOperationError(this.getNode(), 'This contact cannot be messaged right now', {
					itemIndex: i,
					description: picked.why,
				});
			}
			ticketId = encodeURIComponent(picked.ticketId);
			sentOn = { ticket_id: picked.ticketId, channel_type: picked.channelType };
		} else {
			ticketId = requireId(this, 'ticketId', 'Ticket ID', i);
		}

		const headers: IDataObject = {};
		if (options.idempotencyKey) headers['Idempotency-Key'] = String(options.idempotencyKey);
		const body = attachFile
			? await binaryFormData(this, i, content ? { content } : {})
			: { content };
		const sent = await apiRequestData.call(this, 'POST', `/tickets/${ticketId}/messages`, {
			body,
			headers,
			itemIndex: i,
		});
		return { ...sent, ...sentOn };
	}

	if (operation === 'getAll') {
		const ticketId = requireId(this, 'ticketId', 'Ticket ID', i);
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		const filters = this.getNodeParameter('messageFilters', i, {}) as IDataObject;
		const createdAfter = scheduledAtValue(this, filters.createdAfter, i);
		return await apiRequestList.call(this, `/tickets/${ticketId}/messages`, {
			qs: createdAfter ? { created_after: createdAfter } : {},
			paginated: true,
			returnAll,
			limit: returnAll ? undefined : (this.getNodeParameter('limit', i, 50) as number),
			itemIndex: i,
		});
	}

	if (operation === 'sendTemplate') {
		const options = this.getNodeParameter('templateOptions', i, {}) as IDataObject;
		const rows =
			((this.getNodeParameter('bodyParams', i, {}) as IDataObject).values as IDataObject[] | undefined) ?? [];
		const body: IDataObject = {
			name: (this.getNodeParameter('templateName', i) as string).trim(),
			language: (this.getNodeParameter('templateLanguage', i) as string).trim(),
		};
		const bodyParams = rows.map((row) => String(row.value ?? ''));
		if (bodyParams.length) body.body_params = bodyParams;
		if (options.headerParam) body.header_param = String(options.headerParam);

		let path: string;
		if (this.getNodeParameter('templateSendTo', i, 'phone') === 'ticket') {
			path = `/tickets/${requireId(this, 'ticketId', 'Ticket ID', i)}/template`;
		} else {
			path = `/channels/${requireId(this, 'channelId', 'WhatsApp Channel', i)}/template-messages`;
			body.to = String(this.getNodeParameter('toPhone', i, '')).trim();
			if (!body.to) {
				throw new NodeOperationError(this.getNode(), 'To Phone Number is required', {
					itemIndex: i,
				});
			}
			if (options.contactName) body.contact_name = String(options.contactName);
		}
		const headers: IDataObject = {};
		if (options.idempotencyKey) headers['Idempotency-Key'] = String(options.idempotencyKey);
		return await apiRequestData.call(this, 'POST', path, { body, headers, itemIndex: i });
	}

	if (operation === 'moderate') {
		const messageId = requireId(this, 'messageId', 'Message ID', i);
		return await apiRequestData.call(this, 'POST', `/messages/${messageId}/moderate`, {
			body: { action: this.getNodeParameter('moderationAction', i) as string },
			itemIndex: i,
		});
	}

	throw new NodeOperationError(this.getNode(), `Unknown message operation "${operation}"`, {
		itemIndex: i,
	});
}

async function executeTicketWrite(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const ticketId = requireId(this, 'ticketId', 'Ticket ID', i);

	if (operation === 'update') {
		const fields = this.getNodeParameter('ticketUpdateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		if (fields.status) body.status = fields.status;
		if (fields.priority) body.priority = fields.priority;
		if (fields.assignedAgentId) {
			body.assigned_agent_id = fields.assignedAgentId === UNASSIGN_VALUE ? null : fields.assignedAgentId;
		}
		if (fields.assignedGroupId) {
			if (fields.assignedAgentId) {
				throw new NodeOperationError(
					this.getNode(),
					'Choose either Assigned Agent or Assigned Group, not both',
					{
						itemIndex: i,
						description:
							'Assigning to a person clears the group, and a group picks its own member.',
					},
				);
			}
			body.assigned_group_id = fields.assignedGroupId;
		}
		if (fields.snoozedUntil) body.snoozed_until = scheduledAtValue(this, fields.snoozedUntil, i);
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
				itemIndex: i,
			});
		}
		return await apiRequestData.call(this, 'PATCH', `/tickets/${ticketId}`, { body, itemIndex: i });
	}

	if (operation === 'addTag') {
		const body =
			this.getNodeParameter('tagBy', i, 'name') === 'id'
				? { tag_id: this.getNodeParameter('tagId', i) as string }
				: { name: (this.getNodeParameter('tagName', i) as string).trim() };
		return await apiRequestData.call(this, 'POST', `/tickets/${ticketId}/tags`, {
			body,
			itemIndex: i,
		});
	}

	if (operation === 'removeTag') {
		const tagId = requireId(this, 'tagId', 'Tag', i);
		return await apiRequestData.call(this, 'DELETE', `/tickets/${ticketId}/tags/${tagId}`, {
			itemIndex: i,
		});
	}

	if (operation === 'sendForm') {
		const options = this.getNodeParameter('formOptions', i, {}) as IDataObject;
		const headers: IDataObject = {};
		if (options.idempotencyKey) headers['Idempotency-Key'] = String(options.idempotencyKey);
		return await apiRequestData.call(this, 'POST', `/tickets/${ticketId}/forms`, {
			body: { form_id: this.getNodeParameter('formId', i) as string },
			headers,
			itemIndex: i,
		});
	}

	if (operation === 'addNote') {
		return await apiRequestData.call(this, 'POST', `/tickets/${ticketId}/notes`, {
			body: { content: this.getNodeParameter('noteContent', i) as string },
			itemIndex: i,
		});
	}

	// getNotes
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	return await apiRequestList.call(this, `/tickets/${ticketId}/notes`, {
		paginated: true,
		returnAll,
		limit: returnAll ? undefined : (this.getNodeParameter('limit', i, 50) as number),
		itemIndex: i,
	});
}

const CONTACT_MATCH_QUERY: Record<string, string> = {
	phone: 'phone',
	email: 'email',
	externalId: 'external_id',
};

async function executeContactWrite(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	if (operation === 'update') {
		const contactId = requireId(this, 'contactId', 'Contact ID', i);
		const fields = this.getNodeParameter('contactUpdateFields', i, {}) as IDataObject;
		const body: IDataObject = {};
		// A field that was added but left empty clears the value.
		const text = (key: string, apiName: string) => {
			if (key in fields) body[apiName] = String(fields[key] ?? '').trim() || null;
		};
		text('firstName', 'first_name');
		text('lastName', 'last_name');
		text('email', 'email');
		text('phone', 'phone');
		text('language', 'language');
		text('externalId', 'external_id');
		if (typeof fields.botEnabled === 'boolean') body.bot_enabled = fields.botEnabled;
		const attributes = attributeRows(fields.attributes, null);
		if (Object.keys(attributes).length) body.attributes = attributes;
		if (!Object.keys(body).length) {
			throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
				itemIndex: i,
			});
		}
		return await apiRequestData.call(this, 'PATCH', `/contacts/${contactId}`, {
			body,
			itemIndex: i,
		});
	}

	// create / upsert: only what was filled in is sent, so an update never clears a field by accident.
	const extra = this.getNodeParameter('contactAdditionalFields', i, {}) as IDataObject;
	const values: Record<string, string> = {
		firstName: String(this.getNodeParameter('firstName', i, '') ?? '').trim(),
		lastName: String(extra.lastName ?? '').trim(),
		email: String(this.getNodeParameter('email', i, '') ?? '').trim(),
		phone: String(this.getNodeParameter('phone', i, '') ?? '').trim(),
		language: String(extra.language ?? '').trim(),
		externalId: String(extra.externalId ?? '').trim(),
	};
	const body: IDataObject = {};
	if (values.firstName) body.first_name = values.firstName;
	if (values.lastName) body.last_name = values.lastName;
	if (values.email) body.email = values.email;
	if (values.phone) body.phone = values.phone;
	if (values.language) body.language = values.language;
	if (values.externalId) body.external_id = values.externalId;
	// On create an attribute without a value is left out (there is nothing to remove yet).
	const attributes = attributeRows(extra.attributes, null);
	for (const key of Object.keys(attributes)) if (attributes[key] === null) delete attributes[key];
	if (Object.keys(attributes).length) body.attributes = attributes;

	if (operation === 'upsert') {
		const matchOn = this.getNodeParameter('matchOn', i, 'phone') as string;
		const matchValue = values[matchOn];
		if (!matchValue) {
			throw new NodeOperationError(this.getNode(), 'The field chosen in Match On is empty', {
				itemIndex: i,
				description: 'Fill in the phone, email or external ID that identifies the contact.',
			});
		}
		const found = await apiRequest.call(this, 'GET', '/contacts', {
			qs: { [CONTACT_MATCH_QUERY[matchOn]]: matchValue, limit: 1 },
			itemIndex: i,
		});
		const existing = ((found.data as IDataObject[] | undefined) ?? [])[0];
		if (existing?.id) {
			const updated = await apiRequestData.call(
				this,
				'PATCH',
				`/contacts/${encodeURIComponent(String(existing.id))}`,
				{ body, itemIndex: i },
			);
			return { ...updated, created: false };
		}
		const created = await apiRequestData.call(this, 'POST', '/contacts', { body, itemIndex: i });
		return { ...created, created: true };
	}

	return await apiRequestData.call(this, 'POST', '/contacts', { body, itemIndex: i });
}

async function executeRead(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const listOptions = (paginated: boolean, qs: IDataObject = {}) => {
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		return {
			qs,
			paginated,
			returnAll,
			limit: returnAll ? undefined : (this.getNodeParameter('limit', i, 50) as number),
			itemIndex: i,
		};
	};

	const simplified = (rows: IDataObject | IDataObject[], simplify: (row: IDataObject) => IDataObject) =>
		this.getNodeParameter('simplify', i, false)
			? Array.isArray(rows)
				? rows.map(simplify)
				: simplify(rows)
			: rows;

	if (resource === 'ticket') {
		if (operation === 'get') {
			const ticketId = requireId(this, 'ticketId', 'Ticket ID', i);
			return simplified(
				await apiRequestData.call(this, 'GET', `/tickets/${ticketId}`, { itemIndex: i }),
				simplifyTicket,
			);
		}
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = {};
		if (filters.status) qs.status = filters.status;
		if (filters.priority) qs.priority = filters.priority;
		if (filters.assignedAgentId) {
			qs.assigned_agent_id =
				filters.assignedAgentId === UNASSIGN_VALUE ? 'none' : filters.assignedAgentId;
		}
		if (filters.assignedGroupId) qs.assigned_group_id = filters.assignedGroupId;
		if (filters.channelId) qs.channel_id = filters.channelId;
		if (filters.contactId) qs.contact_id = String(filters.contactId).trim();
		if (filters.tagId) qs.tag_id = filters.tagId;
		if (filters.createdAfter) qs.created_after = scheduledAtValue(this, filters.createdAfter, i);
		if (filters.updatedAfter) qs.updated_after = scheduledAtValue(this, filters.updatedAfter, i);
		return simplified(await apiRequestList.call(this, '/tickets', listOptions(true, qs)), simplifyTicket);
	}

	if (resource === 'contact') {
		if (operation === 'getAll') {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			const qs: IDataObject = {};
			if (filters.phone) qs.phone = filters.phone;
			if (filters.email) qs.email = filters.email;
			if (filters.externalId) qs.external_id = filters.externalId;
			if (filters.search) qs.q = String(filters.search).trim();
			if (filters.createdAfter) qs.created_after = scheduledAtValue(this, filters.createdAfter, i);
			return simplified(await apiRequestList.call(this, '/contacts', listOptions(true, qs)), simplifyContact);
		}
		const contactId = requireId(this, 'contactId', 'Contact ID', i);
		if (operation === 'getChannels') {
			const response = await apiRequest.call(this, 'GET', `/contacts/${contactId}/channels`, {
				itemIndex: i,
			});
			return (response.data as IDataObject[] | undefined) ?? [];
		}
		return simplified(
			await apiRequestData.call(this, 'GET', `/contacts/${contactId}`, { itemIndex: i }),
			simplifyContact,
		);
	}

	if (resource === 'channel') {
		if (operation === 'getAll') {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			return await apiRequestList.call(
				this,
				'/channels',
				listOptions(false, filters.type ? { type: filters.type } : {}),
			);
		}
		const channelId = requireId(this, 'channelId', 'Channel ID', i);
		if (operation === 'getTemplates') {
			const response = await apiRequest.call(this, 'GET', `/channels/${channelId}/templates`, {
				itemIndex: i,
			});
			return (response.data as IDataObject[] | undefined) ?? [];
		}
		const suffix = operation === 'getTiktokOptions' ? '/tiktok-options' : '';
		return await apiRequestData.call(this, 'GET', `/channels/${channelId}${suffix}`, {
			itemIndex: i,
		});
	}

	if (resource === 'media') {
		if (operation === 'upload') {
			return await apiRequestData.call(this, 'POST', '/media', {
				body: await binaryFormData(this, i),
				itemIndex: i,
			});
		}
		return await apiRequestList.call(this, '/media', listOptions(false));
	}

	if (resource === 'label') {
		if (operation === 'create') {
			const body: IDataObject = { name: (this.getNodeParameter('labelName', i) as string).trim() };
			const color = String(this.getNodeParameter('labelColor', i, '') ?? '').trim();
			if (color) body.color = color;
			// A name that is taken is not an error here: the label that has it is what the workflow asked for.
			const all = await apiRequest.call(this, 'GET', '/labels', { itemIndex: i });
			const existing = ((all.data as IDataObject[] | undefined) ?? []).find(
				(label) => String(label.name).toLowerCase() === String(body.name).toLowerCase(),
			);
			if (existing) return { ...existing, created: false };
			const created = await apiRequestData.call(this, 'POST', '/labels', { body, itemIndex: i });
			return { ...created, created: true };
		}
		if (operation === 'delete') {
			const labelId = requireId(this, 'labelId', 'Label', i);
			return await apiRequestData.call(this, 'DELETE', `/labels/${labelId}`, { itemIndex: i });
		}
		return await apiRequestList.call(this, '/labels', listOptions(false));
	}

	if (resource === 'customField') {
		return await apiRequestList.call(this, '/custom-fields', listOptions(false));
	}

	if (resource === 'report') {
		const days = Number(this.getNodeParameter('days', i, 30)) || 30;
		return await apiRequestData.call(this, 'GET', '/reports/summary', { qs: { days }, itemIndex: i });
	}

	if (resource === 'group') {
		return await apiRequestList.call(this, '/groups', listOptions(false));
	}

	if (resource === 'savedReply') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const search = String(filters.search ?? '').trim();
		return await apiRequestList.call(this, '/saved-replies', listOptions(true, search ? { q: search } : {}));
	}

	if (resource === 'form') {
		if (operation === 'getResponses') {
			const formId = requireId(this, 'formId', 'Form', i);
			const state = this.getNodeParameter('responseState', i, 'answered') as string;
			const qs: IDataObject = {};
			if (state === 'answered') qs.submitted = 'true';
			if (state === 'waiting') qs.submitted = 'false';
			return await apiRequestList.call(this, `/forms/${formId}/responses`, listOptions(true, qs));
		}
		return await apiRequestList.call(this, '/forms', listOptions(false));
	}

	if (resource === 'satisfaction') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		const qs: IDataObject = {};
		if (filters.score) qs.score = filters.score;
		if (filters.ticketId) qs.ticket_id = String(filters.ticketId).trim();
		if (filters.createdAfter) qs.created_after = scheduledAtValue(this, filters.createdAfter, i);
		return await apiRequestList.call(this, '/csat-responses', listOptions(true, qs));
	}

	throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, { itemIndex: i });
}

const TICKET_WRITE_OPERATIONS = ['update', 'addTag', 'removeTag', 'addNote', 'getNotes', 'sendForm'];
const CONTACT_WRITE_OPERATIONS = ['create', 'update', 'upsert'];

export class Ghamalim implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ghamalim',
		name: 'ghamalim',
		icon: { light: 'file:ghamalim.svg', dark: 'file:ghamalim.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Publish social posts and work with customer conversations, contacts and channels in Ghamalim',
		defaults: { name: 'Ghamalim' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ghamalimApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Channel', value: 'channel' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Custom Field', value: 'customField' },
					{ name: 'Form', value: 'form' },
					{ name: 'Group', value: 'group' },
					{ name: 'Label', value: 'label' },
					{ name: 'Media', value: 'media' },
					{ name: 'Message', value: 'message' },
					{ name: 'Post', value: 'post' },
					{ name: 'Report', value: 'report' },
					{ name: 'Satisfaction Rating', value: 'satisfaction' },
					{ name: 'Saved Reply', value: 'savedReply' },
					{ name: 'Ticket', value: 'ticket' },
				],
				default: 'post',
			},
			...postOperations,
			...postFields,
			...messageOperations,
			...messageFields,
			...ticketOperations,
			...ticketFields,
			...contactOperations,
			...contactFields,
			...channelOperations,
			...channelFields,
			...mediaOperations,
			...mediaFields,
			...labelOperations,
			...labelFields,
			...groupOperations,
			...groupFields,
			...savedReplyOperations,
			...savedReplyFields,
			...formOperations,
			...formFields,
			...satisfactionOperations,
			...satisfactionFields,
			...customFieldOperations,
			...customFieldFields,
			...reportOperations,
			...reportFields,
		],
	};

	methods = {
		listSearch: {
			async searchTickets(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await searchTickets.call(this, filter, paginationToken);
			},
			async searchContacts(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await searchContacts.call(this, filter, paginationToken);
			},
			async searchPosts(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			): Promise<INodeListSearchResult> {
				return await searchPosts.call(this, filter, paginationToken);
			},
		},
		loadOptions: {
			async getPostChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadPostChannels.call(this);
			},
			async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadChannels.call(this);
			},
			async getLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadLabels.call(this);
			},
			async getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadGroups.call(this);
			},
			async getForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadForms.call(this);
			},
			async getMembers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadMembers.call(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let result: IDataObject | IDataObject[];
				if (resource === 'post') result = await executePost.call(this, operation, i);
				else if (resource === 'message') result = await executeMessage.call(this, operation, i);
				else if (resource === 'ticket' && TICKET_WRITE_OPERATIONS.includes(operation)) {
					result = await executeTicketWrite.call(this, operation, i);
				} else if (resource === 'contact' && CONTACT_WRITE_OPERATIONS.includes(operation)) {
					result = await executeContactWrite.call(this, operation, i);
				} else result = await executeRead.call(this, resource, operation, i);

				const rows = Array.isArray(result) ? result : [result];
				for (const row of rows) returnData.push({ json: row, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					const failure = error as NodeApiError;
					returnData.push({
						json: {
							error: failure.message,
							...(failure.description ? { description: failure.description } : {}),
							...(failure.httpCode ? { httpCode: failure.httpCode } : {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError) {
					// Already carries the API's reason and the item index (see toNodeApiError).
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
					description: (error as NodeOperationError).description ?? undefined,
				});
			}
		}

		return [returnData];
	}
}
