import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { apiRequest } from './GenericFunctions';

// Deliveries older or newer than this are refused, so a captured request
// can't be replayed later. Same tolerance the Standard Webhooks spec suggests.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

// Ghamalim retries a delivery it got no answer for within 8 seconds, with the
// same event id. Remember the last ones so a retry of an event this workflow
// already started on doesn't start it twice.
const REMEMBERED_EVENT_IDS = 200;

// n8n saves the remembered ids a moment after it answers, so two copies of
// one event arriving within the same instant would both miss that list. This
// in-process list closes that gap.
const justSeen: string[] = [];

type RemoteWebhook = { id: string; url: string; events: string[]; is_active: boolean };

function sameEvents(a: string[], b: string[]): boolean {
	return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

/**
 * Ghamalim signs every delivery the Standard Webhooks way:
 *   webhook-signature = "v1," + base64( HMAC-SHA256( secret, "{webhook-id}.{webhook-timestamp}.{raw body}" ) )
 * keyed with the secret's own UTF-8 bytes. The header may carry several
 * space-separated signatures (key rotation), any one matching is enough.
 */
export function verifySignature(
	secret: string,
	webhookId: string,
	timestamp: string,
	rawBody: string | Buffer,
	signatureHeader: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): 'ok' | 'bad_timestamp' | 'bad_signature' {
	const sentAt = Number(timestamp);
	if (!Number.isFinite(sentAt) || Math.abs(nowSeconds - sentAt) > TIMESTAMP_TOLERANCE_SECONDS) {
		return 'bad_timestamp';
	}
	const expected = createHmac('sha256', secret)
		.update(`${webhookId}.${timestamp}.`, 'utf8')
		.update(rawBody)
		.digest();
	for (const candidate of signatureHeader.split(' ')) {
		const [version, value] = candidate.split(',');
		if (version !== 'v1' || !value) continue;
		const given = Buffer.from(value, 'base64');
		if (given.length === expected.length && timingSafeEqual(given, expected)) return 'ok';
	}
	return 'bad_signature';
}

export class GhamalimTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ghamalim Trigger',
		name: 'ghamalimTrigger',
		icon: { light: 'file:ghamalim.svg', dark: 'file:ghamalim.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when something happens in Ghamalim: a customer message, a new ticket, a published post and more',
		defaults: { name: 'Ghamalim Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ghamalimApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The workflow starts when any of these happens',
				options: [
					{
						name: 'Call Answered',
						value: 'call.answered',
					},
					{
						name: 'Call Ended',
						value: 'call.ended',
					},
					{
						name: 'Call Incoming',
						value: 'call.incoming',
					},
					{
						name: 'Call Missed',
						value: 'call.missed',
					},
					{
						name: 'Contact Created',
						value: 'contact.created',
					},
					{
						name: 'Contact Updated',
						value: 'contact.updated',
					},
					{
						name: 'CSAT Submitted',
						value: 'csat.submitted',
						description: 'A customer rated a conversation',
					},
					{
						name: 'Form Submitted',
						value: 'form.submitted',
					},
					{
						name: 'Message Deleted',
						value: 'message.deleted',
					},
					{
						name: 'Message Failed',
						value: 'message.failed',
						description: 'A message to a customer could not be delivered',
					},
					{
						name: 'Message Received',
						value: 'message.received',
						description: 'A customer sent a message',
					},
					{
						name: 'Message Sent',
						value: 'message.sent',
						description: 'A message was sent to a customer',
					},
					{
						name: 'Message Status Updated',
						value: 'message.status_updated',
						description: 'A sent message was delivered or read',
					},
					{
						name: 'Message Updated',
						value: 'message.updated',
						description: 'A message was edited, hidden or unhidden',
					},
					{
						name: 'Note Created',
						value: 'note.created',
					},
					{
						name: 'Post Failed',
						value: 'post.failed',
						description: 'A social post could not be published',
					},
					{
						name: 'Post Published',
						value: 'post.published',
						description: 'A social post went live',
					},
					{
						name: 'SLA Breached',
						value: 'sla.breached',
					},
					{
						name: 'Tag Added',
						value: 'tag.added',
					},
					{
						name: 'Tag Removed',
						value: 'tag.removed',
					},
					{
						name: 'Ticket Assigned',
						value: 'ticket.assigned',
					},
					{
						name: 'Ticket Created',
						value: 'ticket.created',
						description: 'A new conversation started',
					},
					{
						name: 'Ticket Priority Changed',
						value: 'ticket.priority_changed',
					},
					{
						name: 'Ticket Reopened',
						value: 'ticket.reopened',
					},
					{
						name: 'Ticket Resolved',
						value: 'ticket.resolved',
					},
					{
						name: 'Ticket Status Changed',
						value: 'ticket.status_changed',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				const staticData = this.getWorkflowStaticData('node');

				const response = await apiRequest.call(this, 'GET', '/webhooks');
				const remote = ((response.data as RemoteWebhook[] | undefined) ?? []).filter(
					(webhook) => webhook.url === webhookUrl,
				);

				const ours = remote.find((webhook) => webhook.id === staticData.webhookId);
				if (ours && staticData.webhookSecret && ours.is_active && sameEvents(ours.events, events)) {
					return true;
				}

				// Anything else registered for this exact n8n URL is stale: a
				// registration whose signing secret we no longer hold (it is only
				// shown once), one that Ghamalim switched off after days of failed
				// deliveries, or one with an older event selection. Remove it so
				// create() starts clean and events are not delivered twice.
				for (const webhook of remote) {
					await apiRequest.call(this, 'DELETE', `/webhooks/${webhook.id}`);
				}
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Choose at least one event');
				}
				if (!webhookUrl.startsWith('https://')) {
					throw new NodeOperationError(
						this.getNode(),
						'Ghamalim only delivers events to a public https address',
						{
							description: `This n8n instance's webhook address is ${webhookUrl}. Set WEBHOOK_URL to a public https address (or use a tunnel) and try again.`,
						},
					);
				}

				const response = await apiRequest.call(this, 'POST', '/webhooks', {
					body: { url: webhookUrl, events },
				});
				const created = response.data as IDataObject | undefined;
				if (!created?.id || !created.secret) {
					throw new NodeOperationError(
						this.getNode(),
						'Ghamalim did not return the webhook registration',
					);
				}

				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = created.id as string;
				staticData.webhookSecret = created.secret as string;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId) {
					try {
						await apiRequest.call(this, 'DELETE', `/webhooks/${staticData.webhookId}`);
					} catch (error) {
						// Already gone on the Ghamalim side is fine; anything else
						// would leave a registration behind, so report it.
						if ((error as { httpCode?: string }).httpCode !== '404') return false;
					}
				}
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				delete staticData.recentEventIds;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const headers = this.getHeaderData();
		const body = this.getBodyData();
		const staticData = this.getWorkflowStaticData('node');
		const secret = staticData.webhookSecret as string | undefined;

		const refuse = (status: number, message: string): IWebhookResponseData => {
			response.status(status).json({ error: message });
			return { noWebhookResponse: true };
		};

		const header = (name: string) => {
			const value = headers[name];
			return Array.isArray(value) ? value[0] : value;
		};
		const webhookId = header('webhook-id');
		const timestamp = header('webhook-timestamp');
		const signature = header('webhook-signature');

		if (!secret) return refuse(401, 'This webhook is not registered');
		if (!webhookId || !timestamp || !signature) return refuse(401, 'Missing signature headers');

		// The signature covers the exact bytes that were sent. n8n keeps them
		// on the request; re-serializing the parsed body is only a fallback
		// (Ghamalim sends compact JSON, which round-trips unchanged).
		const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);
		const verdict = verifySignature(secret, webhookId, timestamp, rawBody, signature);
		if (verdict === 'bad_timestamp') return refuse(401, 'Timestamp outside the allowed window');
		if (verdict === 'bad_signature') return refuse(401, 'Invalid signature');

		// Acknowledge, but don't start the workflow for, an event this node is
		// not listening for. The "Send test event" button in Ghamalim always
		// starts it, so a workflow can be built against a real delivery.
		const events = this.getNodeParameter('events', []) as string[];
		const event = body.event as string | undefined;
		if (event !== 'test' && event && !events.includes(event)) {
			response.status(200).json({ received: true, ignored: true });
			return { noWebhookResponse: true };
		}

		const eventId = typeof body.id === 'string' ? body.id : undefined;
		const seen = Array.isArray(staticData.recentEventIds)
			? (staticData.recentEventIds as string[])
			: [];
		const memoryKey = eventId ? `${this.getWorkflow().id}:${this.getNode().id}:${eventId}` : undefined;
		if (eventId && (seen.includes(eventId) || justSeen.includes(memoryKey as string))) {
			response.status(200).json({ received: true, duplicate: true });
			return { noWebhookResponse: true };
		}
		if (eventId) {
			staticData.recentEventIds = [...seen, eventId].slice(-REMEMBERED_EVENT_IDS);
			justSeen.push(memoryKey as string);
			if (justSeen.length > REMEMBERED_EVENT_IDS) justSeen.shift();
		}

		// Answer here rather than through n8n's default reply (which would be
		// the literal text of its response setting): Ghamalim only needs a 2xx.
		response.status(200).json({ received: true });
		return {
			noWebhookResponse: true,
			workflowData: [this.helpers.returnJsonArray(body as IDataObject)],
		};
	}
}
