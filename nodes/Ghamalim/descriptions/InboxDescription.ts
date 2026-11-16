import type { INodeProperties } from 'n8n-workflow';

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

const returnAllAndLimit = (resource: string, operation: string[]): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show(resource, operation),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: [resource], operation, returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

// ------------------------------------------------------------------- message
export const messageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['message'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the messages of a conversation, oldest first',
				action: 'Get many messages',
			},
			{
				name: 'Moderate Comment',
				value: 'moderate',
				description: 'Hide, unhide or delete a Facebook or Instagram comment',
				action: 'Moderate a comment',
			},
			{
				name: 'Send',
				value: 'send',
				description: 'Reply to the customer through the channel of the conversation',
				action: 'Send a message',
			},
			{
				name: 'Send WhatsApp Template',
				value: 'sendTemplate',
				description:
					'Send an approved WhatsApp template, on a conversation or to a phone number. The only message WhatsApp delivers after 24 hours without a customer reply.',
				action: 'Send a whats app template',
			},
		],
		default: 'send',
	},
];

export const messageFields: INodeProperties[] = [
	{
		displayName: 'Send To',
		name: 'sendTo',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Contact',
				value: 'contact',
				description: 'Find the conversation where this contact can be messaged right now',
			},
			{
				name: 'Ticket',
				value: 'ticket',
				description: 'Reply on one conversation, for example the one a trigger event came from',
			},
		],
		default: 'ticket',
		displayOptions: show('message', ['send']),
	},
	{
		displayName: 'Ticket',
		name: 'ticketId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a ticket...',
				typeOptions: { searchListMethod: 'searchTickets', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 3886fe77-9989-4b8c-b04c-205977a6b14c',
			},
		],
		displayOptions: { show: { resource: ['message'], operation: ['send'], sendTo: ['ticket'] } },
		description: 'The conversation to reply on. The Ghamalim Trigger provides it as data.ticket_id.',
	},
	{
		displayName: 'Ticket',
		name: 'ticketId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a ticket...',
				typeOptions: { searchListMethod: 'searchTickets', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 3886fe77-9989-4b8c-b04c-205977a6b14c',
			},
		],
		displayOptions: show('message', ['getAll']),
	},
	{
		displayName: 'Contact',
		name: 'contactId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a contact...',
				typeOptions: { searchListMethod: 'searchContacts', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 9d55072f-be3d-4a32-b65e-87487c7fedad',
			},
		],
		displayOptions: { show: { resource: ['message'], operation: ['send'], sendTo: ['contact'] } },
		description:
			'The contact to message. A contact can only be messaged on a channel where they have written before.',
	},
	{
		displayName: 'Preferred Channel Type',
		name: 'preferredChannelType',
		type: 'string',
		default: '',
		placeholder: 'e.g. whatsapp',
		displayOptions: { show: { resource: ['message'], operation: ['send'], sendTo: ['contact'] } },
		description:
			'Use this channel type when the contact can be messaged there (whatsapp, line, messenger, instagram, telegram, livechat…). Leave empty to use the conversation with the most recent customer message.',
	},
	{
		displayName: 'Text',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		displayOptions: show('message', ['send']),
		description: 'The message text, or the caption when a file is attached',
	},
	{
		displayName: 'Attach File',
		name: 'attachFile',
		type: 'boolean',
		default: false,
		displayOptions: show('message', ['send']),
		description:
			'Whether to send a file from the input data. Images up to 5 MB, video and audio up to 16 MB, documents up to 20 MB.',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: { show: { resource: ['message'], operation: ['send'], attachFile: [true] } },
		hint: 'The name of the input field containing the file to send',
	},
	{
		displayName: 'Options',
		name: 'sendOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('message', ['send']),
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1042-confirmation',
				description:
					'A retry with the same key returns the first result instead of messaging the customer twice. Remembered for 24 hours.',
			},
		],
	},
	{
		displayName: 'Send To',
		name: 'templateSendTo',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Phone Number',
				value: 'phone',
				description: 'Start or continue the conversation with this WhatsApp number',
			},
			{
				name: 'Ticket',
				value: 'ticket',
				description: 'Send on an existing WhatsApp conversation',
			},
		],
		default: 'phone',
		displayOptions: show('message', ['sendTemplate']),
	},
	{
		displayName: 'Ticket',
		name: 'ticketId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a ticket...',
				typeOptions: { searchListMethod: 'searchTickets', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 3886fe77-9989-4b8c-b04c-205977a6b14c',
			},
		],
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'], templateSendTo: ['ticket'] },
		},
		description: 'A WhatsApp conversation',
	},
	{
		displayName: 'WhatsApp Channel Name or ID',
		name: 'channelId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getChannels', loadOptionsDependsOn: ['operation'] },
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'], templateSendTo: ['phone'] },
		},
		description:
			'The WhatsApp number to send from. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'To Phone Number',
		name: 'toPhone',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. +639171234567',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'], templateSendTo: ['phone'] },
		},
		description:
			'The customer’s WhatsApp number with country code. A contact and a conversation are created when this number is new.',
	},
	{
		displayName: 'Template Name',
		name: 'templateName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. order_update',
		displayOptions: show('message', ['sendTemplate']),
		description:
			'An approved template of the channel. Channel > Get WhatsApp Templates lists the names, languages and how many parameters each needs.',
	},
	{
		displayName: 'Template Language',
		name: 'templateLanguage',
		type: 'string',
		required: true,
		default: 'en_US',
		displayOptions: show('message', ['sendTemplate']),
		description: 'The language code of the template, exactly as listed (for example en_US, en, th)',
	},
	{
		displayName: 'Body Parameters',
		name: 'bodyParams',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Parameter',
		default: {},
		displayOptions: show('message', ['sendTemplate']),
		description:
			'One value for each {{1}}, {{2}}… in the template body, in order. The number of values must match the template.',
		options: [
			{
				displayName: 'Parameter',
				name: 'values',
				values: [
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Text without line breaks or tabs',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'templateOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('message', ['sendTemplate']),
		options: [
			{
				displayName: 'Contact Name',
				name: 'contactName',
				type: 'string',
				default: '',
				description:
					'Name for the contact when the phone number is new. Only used with Send To: Phone Number.',
			},
			{
				displayName: 'Header Parameter',
				name: 'headerParam',
				type: 'string',
				default: '',
				description: 'The value for {{1}} in the template header, when the header has one',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1042-confirmation',
				description:
					'A retry with the same key returns the first result instead of messaging the customer twice. Remembered for 24 hours.',
			},
		],
	},
	...returnAllAndLimit('message', ['getAll']),
	{
		displayName: 'Filters',
		name: 'messageFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('message', ['getAll']),
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description:
					'Only messages newer than this, for example since the last run. A time without a zone is read in the workflow time zone.',
			},
		],
	},
	{
		displayName: 'Message',
		name: 'messageId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'id', value: '' },
		modes: [
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 975d0574-8591-4b74-9e48-2aef036b722b',
			},
		],
		displayOptions: show('message', ['moderate']),
		description: 'The comment to moderate',
	},
	{
		displayName: 'Action',
		name: 'moderationAction',
		type: 'options',
		options: [
			{ name: 'Delete', value: 'delete', description: 'Permanent on the platform' },
			{ name: 'Hide', value: 'hide' },
			{ name: 'Unhide', value: 'unhide' },
		],
		default: 'hide',
		displayOptions: show('message', ['moderate']),
	},
];

// -------------------------------------------------------------------- ticket
export const ticketOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['ticket'] } },
		options: [
			{
				name: 'Add Note',
				value: 'addNote',
				description: 'Add an internal note that only the team sees',
				action: 'Add a note to a ticket',
			},
			{
				name: 'Add Tag',
				value: 'addTag',
				description: 'Put a tag on a conversation',
				action: 'Add a tag to a ticket',
			},
			{ name: 'Get', value: 'get', description: 'Get a conversation', action: 'Get a ticket' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many conversations, newest first',
				action: 'Get many tickets',
			},
			{
				name: 'Get Notes',
				value: 'getNotes',
				description: 'Get the internal notes of a conversation, oldest first',
				action: 'Get notes of a ticket',
			},
			{
				name: 'Remove Tag',
				value: 'removeTag',
				description: 'Take a tag off a conversation',
				action: 'Remove a tag from a ticket',
			},
			{
				name: 'Send Form',
				value: 'sendForm',
				description: 'Send one of your forms to the customer as a link in the conversation',
				action: 'Send a form on a ticket',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Resolve, reopen, snooze, change the priority or assign a conversation',
				action: 'Update a ticket',
			},
		],
		default: 'getAll',
	},
];

export const ticketFields: INodeProperties[] = [
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: false,
		displayOptions: show('ticket', ['get', 'getAll']),
		description:
			'Whether to return a simplified version of the response with the 10 most used fields instead of the raw data',
	},
	{
		displayName: 'Ticket',
		name: 'ticketId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a ticket...',
				typeOptions: { searchListMethod: 'searchTickets', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 3886fe77-9989-4b8c-b04c-205977a6b14c',
			},
		],
		displayOptions: show('ticket', ['get', 'update', 'addTag', 'removeTag', 'addNote', 'getNotes', 'sendForm']),
		description: 'The conversation. The Ghamalim Trigger provides it as data.ticket_id.',
	},
	{
		displayName: 'Update Fields',
		name: 'ticketUpdateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('ticket', ['update']),
		options: [
			{
				displayName: 'Assigned Agent Name or ID',
				name: 'assignedAgentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMembers' },
				default: '',
				description:
					'Who handles the conversation. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Assigned Group Name or ID',
				name: 'assignedGroupId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getGroups' },
				default: '',
				description:
					'The team that handles the conversation. A group with smart assignment also picks one of its members. Cannot be combined with Assigned Agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'High', value: 'high' },
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'Urgent', value: 'urgent' },
				],
				default: 'medium',
			},
			{
				displayName: 'Snooze Until',
				name: 'snoozedUntil',
				type: 'dateTime',
				default: '',
				description:
					'Hide the conversation until this time. A time without a zone is read in the workflow time zone. Cannot be combined with Status.',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'On Hold', value: 'on_hold' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Reopened', value: 'reopened' },
					{
						name: 'Resolved',
						value: 'resolved',
						description: 'Also sends the satisfaction survey when one is set up',
					},
				],
				default: 'resolved',
			},
		],
	},
	{
		displayName: 'Tag By',
		name: 'tagBy',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Name', value: 'name', description: 'The tag is created when it does not exist yet' },
			{ name: 'Select From List', value: 'id' },
		],
		default: 'name',
		displayOptions: show('ticket', ['addTag']),
	},
	{
		displayName: 'Tag Name',
		name: 'tagName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. vip',
		displayOptions: { show: { resource: ['ticket'], operation: ['addTag'], tagBy: ['name'] } },
	},
	{
		displayName: 'Tag Name or ID',
		name: 'tagId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLabels' },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['ticket'], operation: ['addTag'], tagBy: ['id'] } },
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Tag Name or ID',
		name: 'tagId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLabels' },
		required: true,
		default: '',
		displayOptions: show('ticket', ['removeTag']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	{
		displayName: 'Note',
		name: 'noteContent',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: show('ticket', ['addNote']),
		description: 'Shown to the team inside the conversation. Never sent to the customer.',
	},
	{
		displayName: 'Form Name or ID',
		name: 'formId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getForms' },
		required: true,
		default: '',
		displayOptions: show('ticket', ['sendForm']),
		description:
			'The form to send. The answers arrive with the Form Submitted trigger. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Options',
		name: 'formOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: show('ticket', ['sendForm']),
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'A unique value for this send. A retry with the same key does not send the form a second time.',
			},
		],
	},
	...returnAllAndLimit('ticket', ['getAll', 'getNotes']),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('ticket', ['getAll']),
		options: [
			{
				displayName: 'Assigned Agent Name or ID',
				name: 'assignedAgentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMembers' },
				default: '',
				description:
					'Conversations of one team member, or "Nobody" for unassigned ones. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Assigned Group Name or ID',
				name: 'assignedGroupId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getGroups' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Channel Name or ID',
				name: 'channelId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getChannels' },
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'Only the conversations of this contact',
			},
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'A time without a zone is read in the workflow time zone',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'High', value: 'high' },
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'Urgent', value: 'urgent' },
				],
				default: 'urgent',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'On Hold', value: 'on_hold' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Reopened', value: 'reopened' },
					{ name: 'Resolved', value: 'resolved' },
					{ name: 'Snoozed', value: 'snoozed' },
				],
				default: 'pending',
			},
			{
				displayName: 'Tag Name or ID',
				name: 'tagId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLabels' },
				default: '',
				description:
					'Only conversations that carry this tag. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Updated After',
				name: 'updatedAfter',
				type: 'dateTime',
				default: '',
				description:
					'Only conversations changed after this time, for example since the last run of a scheduled workflow',
			},
		],
	},
];

// ------------------------------------------------------------------- contact
export const contactOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['contact'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Add a contact, for example a lead from a form',
				action: 'Create a contact',
			},
			{
				name: 'Create or Update',
				value: 'upsert',
				description:
					'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update a contact',
			},
			{ name: 'Get', value: 'get', description: 'Get a contact', action: 'Get a contact' },
			{
				name: 'Get Channels',
				value: 'getChannels',
				description:
					'See where a contact can be reached, the ticket to send on, and whether a message can be sent right now',
				action: 'Get channels of a contact',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many contacts, or look one up by phone, email or your own user ID',
				action: 'Get many contacts',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Change the details or custom attributes of a contact',
				action: 'Update a contact',
			},
		],
		default: 'getAll',
	},
];

export const contactFields: INodeProperties[] = [
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: false,
		displayOptions: show('contact', ['get', 'getAll']),
		description:
			'Whether to return a simplified version of the response with the most used fields instead of the raw data',
	},
	{
		displayName: 'Contact',
		name: 'contactId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a contact...',
				typeOptions: { searchListMethod: 'searchContacts', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 9d55072f-be3d-4a32-b65e-87487c7fedad',
			},
		],
		displayOptions: show('contact', ['get', 'getChannels', 'update']),
	},
	{
		displayName: 'Match On',
		name: 'matchOn',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Email', value: 'email' },
			{ name: 'External ID', value: 'externalId' },
			{ name: 'Phone', value: 'phone' },
		],
		default: 'phone',
		displayOptions: show('contact', ['upsert']),
		description:
			'The field that decides whether the contact already exists. Fill in the same field below.',
	},
	{
		displayName: 'First Name',
		name: 'firstName',
		type: 'string',
		default: '',
		displayOptions: show('contact', ['create', 'upsert']),
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'e.g. name@email.com',
		default: '',
		displayOptions: show('contact', ['create', 'upsert']),
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		default: '',
		placeholder: 'e.g. +639171234567',
		displayOptions: show('contact', ['create', 'upsert']),
		description: 'With country code. Saved as + followed by the digits.',
	},
	{
		displayName: 'Additional Fields',
		name: 'contactAdditionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('contact', ['create', 'upsert']),
		options: [
			{
				displayName: 'Custom Attributes',
				name: 'attributes',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Attribute',
				default: {},
				description: 'Your own fields on the contact. On update they are added to the existing ones.',
				options: [
					{
						displayName: 'Attribute',
						name: 'values',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				description: 'Your own ID for this person, to find the contact again later',
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. en',
			},
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
		],
	},
	{
		displayName: 'Update Fields',
		name: 'contactUpdateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('contact', ['update']),
		description: 'Only the fields added here are changed. An empty value clears the field.',
		options: [
			{
				displayName: 'Automatic Replies',
				name: 'botEnabled',
				type: 'boolean',
				default: false,
				description:
					'Whether the AI agent and automation sequences answer this contact. Turn off to hand the conversation to a person.',
			},
			{
				displayName: 'Custom Attributes',
				name: 'attributes',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Attribute',
				default: {},
				description:
					'Added to the existing attributes. An attribute with an empty value is removed.',
				options: [
					{
						displayName: 'Attribute',
						name: 'values',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. name@email.com',
				default: '',
			},
			{ displayName: 'External ID', name: 'externalId', type: 'string', default: '' },
			{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
			{ displayName: 'Language', name: 'language', type: 'string', default: '' },
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
		],
	},
	...returnAllAndLimit('contact', ['getAll']),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('contact', ['getAll']),
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'A time without a zone is read in the workflow time zone',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. name@email.com',
				default: '',
				description: 'Exact match, not case sensitive',
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				description: 'Your own user ID, as sent by web chat identity verification',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				placeholder: 'e.g. +639171234567',
				description: 'Exact match, with or without the leading +',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Part of the name, email address or phone number (at least 2 characters)',
			},
		],
	},
];

// ------------------------------------------------------------------- channel
export const channelOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['channel'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a connected channel and what it can do',
				action: 'Get a channel',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many connected channels',
				action: 'Get many channels',
			},
			{
				name: 'Get TikTok Options',
				value: 'getTiktokOptions',
				description: 'Get what the connected TikTok account allows right now',
				action: 'Get tik tok options of a channel',
			},
			{
				name: 'Get WhatsApp Templates',
				value: 'getTemplates',
				description: 'Get the approved WhatsApp message templates of a channel',
				action: 'Get whats app templates of a channel',
			},
		],
		default: 'getAll',
	},
];

export const channelFields: INodeProperties[] = [
	{
		displayName: 'Channel Name or ID',
		name: 'channelId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getChannels', loadOptionsDependsOn: ['operation'] },
		required: true,
		default: '',
		displayOptions: show('channel', ['get', 'getTiktokOptions', 'getTemplates']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	...returnAllAndLimit('channel', ['getAll']),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('channel', ['getAll']),
		options: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'string',
				default: '',
				placeholder: 'e.g. facebook_feed',
				description:
					'Only channels of this type, for example whatsapp, line, facebook_feed, instagram_feed, tiktok_posting',
			},
		],
	},
];

// --------------------------------------------------------------------- media
export const mediaOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['media'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get images and videos recently used in posts',
				action: 'Get many media',
			},
			{
				name: 'Upload',
				value: 'upload',
				description: 'Upload an image or video and get a public link to use in a post',
				action: 'Upload media',
			},
		],
		default: 'upload',
	},
];

export const mediaFields: INodeProperties[] = [
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: show('media', ['upload']),
		hint: 'The name of the input field containing the image (up to 20 MB) or video (up to 200 MB)',
	},
	...returnAllAndLimit('media', ['getAll']),
];

// --------------------------------------------------------------------- label
export const labelOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['label'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Add a label. When the name is taken, the existing label is returned.',
				action: 'Create a label',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a label for good. It comes off every ticket and post.',
				action: 'Delete a label',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the labels that can be put on posts and tickets',
				action: 'Get many labels',
			},
		],
		default: 'getAll',
	},
];

export const labelFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'labelName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. vip',
		displayOptions: show('label', ['create']),
	},
	{
		displayName: 'Color',
		name: 'labelColor',
		type: 'color',
		default: '#3b82f6',
		displayOptions: show('label', ['create']),
	},
	{
		displayName: 'Label Name or ID',
		name: 'labelId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLabels' },
		required: true,
		default: '',
		displayOptions: show('label', ['delete']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	...returnAllAndLimit('label', ['getAll']),
];

// --------------------------------------------------------------------- group
export const groupOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['group'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the teams a conversation can be assigned to',
				action: 'Get many groups',
			},
		],
		default: 'getAll',
	},
];

export const groupFields: INodeProperties[] = [...returnAllAndLimit('group', ['getAll'])];

// --------------------------------------------------------------- saved reply
export const savedReplyOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['savedReply'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the ready-made replies the team shares, by keyword',
				action: 'Get many saved replies',
			},
		],
		default: 'getAll',
	},
];

export const savedReplyFields: INodeProperties[] = [
	...returnAllAndLimit('savedReply', ['getAll']),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('savedReply', ['getAll']),
		options: [
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Part of the keyword or the text (at least 2 characters)',
			},
		],
	},
];

// ---------------------------------------------------------------------- form
export const formOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['form'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get your forms with their questions and how often each was answered',
				action: 'Get many forms',
			},
			{
				name: 'Get Responses',
				value: 'getResponses',
				description: 'Get what customers answered on a form, newest first',
				action: 'Get responses of a form',
			},
		],
		default: 'getAll',
	},
];

export const formFields: INodeProperties[] = [
	{
		displayName: 'Form Name or ID',
		name: 'formId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getForms' },
		required: true,
		default: '',
		displayOptions: show('form', ['getResponses']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
	...returnAllAndLimit('form', ['getAll', 'getResponses']),
	{
		displayName: 'Responses',
		name: 'responseState',
		type: 'options',
		options: [
			{ name: 'All', value: 'all' },
			{ name: 'Answered Only', value: 'answered' },
			{ name: 'Not Answered Yet', value: 'waiting' },
		],
		default: 'answered',
		displayOptions: show('form', ['getResponses']),
	},
];

// -------------------------------------------------------------- satisfaction
export const satisfactionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['satisfaction'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the scores and comments customers gave after a conversation, newest first',
				action: 'Get many satisfaction ratings',
			},
		],
		default: 'getAll',
	},
];

export const satisfactionFields: INodeProperties[] = [
	...returnAllAndLimit('satisfaction', ['getAll']),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('satisfaction', ['getAll']),
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'A time without a zone is read in the workflow time zone',
			},
			{
				displayName: 'Score',
				name: 'score',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 5 },
				default: 5,
				description: 'Only ratings with exactly this score, from 1 (worst) to 5 (best)',
			},
			{
				displayName: 'Ticket ID',
				name: 'ticketId',
				type: 'string',
				default: '',
			},
		],
	},
];

// -------------------------------------------------------------- custom field
export const customFieldOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['customField'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get the custom contact fields: the names to use in Custom Attributes',
				action: 'Get many custom fields',
			},
		],
		default: 'getAll',
	},
];

export const customFieldFields: INodeProperties[] = [...returnAllAndLimit('customField', ['getAll'])];

// -------------------------------------------------------------------- report
export const reportOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['report'] } },
		options: [
			{
				name: 'Get Summary',
				value: 'getSummary',
				description:
					'Get the inbox numbers: tickets created and resolved, response times, per day, per channel and per agent',
				action: 'Get a report summary',
			},
		],
		default: 'getSummary',
	},
];

export const reportFields: INodeProperties[] = [
	{
		displayName: 'Days',
		name: 'days',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 90 },
		default: 30,
		displayOptions: show('report', ['getSummary']),
		description: 'How many days back from now the report covers (1 to 90)',
	},
];
