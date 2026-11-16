import type { INodeProperties } from 'n8n-workflow';

const forPost = (operation: string[]) => ({ show: { resource: ['post'], operation } });

const postIdOperations = [
	'get',
	'update',
	'delete',
	'publish',
	'approve',
	'reject',
	'retry',
	'refreshInsights',
];

const tiktokPrivacyOptions = [
	{ name: 'Everyone', value: 'PUBLIC_TO_EVERYONE' },
	{ name: 'Followers', value: 'FOLLOWER_OF_CREATOR' },
	{ name: 'Friends (Mutual Followers)', value: 'MUTUAL_FOLLOW_FRIENDS' },
	{ name: 'Only Me', value: 'SELF_ONLY' },
];

const tiktokFields: INodeProperties[] = [
	{
		displayName: 'TikTok: Allow Comments',
		name: 'tiktokAllowComment',
		type: 'boolean',
		default: true,
	},
	{
		displayName: 'TikTok: Allow Duet',
		name: 'tiktokAllowDuet',
		type: 'boolean',
		default: true,
	},
	{
		displayName: 'TikTok: Allow Stitch',
		name: 'tiktokAllowStitch',
		type: 'boolean',
		default: true,
	},
	{
		displayName: 'TikTok: Branded Content',
		name: 'tiktokBrandedContent',
		type: 'boolean',
		default: false,
		description: 'Whether the post promotes another brand or a third party (paid partnership)',
	},
	{
		displayName: 'TikTok: Promotes Own Brand',
		name: 'tiktokYourBrand',
		type: 'boolean',
		default: false,
		description: 'Whether the post promotes your own business',
	},
	{
		displayName: 'TikTok: Visibility',
		name: 'tiktokPrivacyLevel',
		type: 'options',
		options: tiktokPrivacyOptions,
		default: 'SELF_ONLY',
		description:
			'Required when a TikTok channel is selected. TikTok asks the poster to choose who can see every post.',
	},
];

export const postOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['post'] } },
		options: [
			{
				name: 'Approve',
				value: 'approve',
				description: 'Approve a post that is waiting for approval',
				action: 'Approve a post',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Publish a post now, schedule it, or save it as a draft',
				action: 'Create a post',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a post, also on the platform where that is possible',
				action: 'Delete a post',
			},
			{
				name: 'Generate Captions',
				value: 'generateCaptions',
				description: 'Write caption variants with AI from a short brief',
				action: 'Generate captions for a post',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a post and what happened on each channel',
				action: 'Get a post',
			},
			{
				name: 'Get Best Times',
				value: 'getBestTimes',
				description: 'Suggest good times to post, from your own posting history',
				action: 'Get best times to post',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many posts',
				action: 'Get many posts',
			},
			{
				name: 'Publish Draft',
				value: 'publish',
				description: 'Publish a saved draft now or schedule it',
				action: 'Publish a draft post',
			},
			{
				name: 'Refresh Insights',
				value: 'refreshInsights',
				description: 'Fetch fresh reach and engagement numbers from Facebook and Instagram',
				action: 'Refresh insights of a post',
			},
			{
				name: 'Reject',
				value: 'reject',
				description: 'Reject a post that is waiting for approval',
				action: 'Reject a post',
			},
			{
				name: 'Retry',
				value: 'retry',
				description: 'Publish a failed post again; channels that already published are skipped',
				action: 'Retry a failed post',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Edit a post that has not been published yet',
				action: 'Update a post',
			},
		],
		default: 'create',
	},
];

export const postFields: INodeProperties[] = [
	// ----------------------------------------------------------------- shared
	{
		displayName: 'Post',
		name: 'postId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a post...',
				typeOptions: { searchListMethod: 'searchPosts', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 3a2f6c1e-5b1d-4f0e-9a41-0b6a2c9d7e55',
			},
		],
		displayOptions: forPost(postIdOperations),
	},

	// ----------------------------------------------------------------- create
	{
		displayName: 'Channel Names or IDs',
		name: 'channelIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getPostChannels' },
		default: [],
		displayOptions: forPost(['create']),
		description:
			'Where to publish. Required unless you save a draft. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Caption',
		name: 'caption',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: forPost(['create']),
		description:
			'The text of the post. Limits depend on the channels: X 280 characters, Instagram and TikTok 2,200, LinkedIn 3,000.',
	},
	{
		displayName: 'Media URLs',
		name: 'mediaUrls',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://example.com/photo-1.jpg, https://example.com/photo-2.jpg',
		displayOptions: forPost(['create']),
		description:
			'Public https links separated by commas: up to 10 images, or one video. Instagram and TikTok need at least one. Use Media > Upload first for a file that is not on a public link.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: forPost(['create']),
		options: [
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				description:
					'Your own reference, for example a listing or product ID. Returned on the post and usable as a filter.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1042-confirmation',
				description:
					'A retry with the same key returns the first result instead of posting twice. Remembered for 24 hours.',
			},
			{
				displayName: 'Label Names or IDs',
				name: 'labelIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getLabels' },
				default: [],
				description:
					'Labels to put on the post. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Require Approval',
				name: 'requireApproval',
				type: 'boolean',
				default: false,
				description:
					'Whether to hold the post until an admin or supervisor approves it. Cannot be combined with Save as Draft.',
			},
			{
				displayName: 'Save as Draft',
				name: 'draft',
				type: 'boolean',
				default: false,
				description:
					'Whether to save the post without publishing it. Channels and platform rules are checked later, when the draft is published.',
			},
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				description:
					'When to publish. Leave empty to publish now. A time without a zone is read in the workflow time zone.',
			},
			...tiktokFields,
		],
	},

	// ----------------------------------------------------------------- update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: forPost(['update']),
		options: [
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			{
				displayName: 'Channel Names or IDs',
				name: 'channelIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getPostChannels' },
				default: [],
				description:
					'Replaces the channels of the post. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Label Names or IDs',
				name: 'labelIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getLabels' },
				default: [],
				description:
					'Replaces the labels of the post. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Media URLs',
				name: 'mediaUrls',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/photo-1.jpg, https://example.com/photo-2.jpg',
				description: 'Replaces the media of the post. Public https links separated by commas.',
			},
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				description: 'A time without a zone is read in the workflow time zone',
			},
			...tiktokFields,
		],
	},

	// ---------------------------------------------------------------- publish
	{
		displayName: 'Options',
		name: 'publishOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: forPost(['publish']),
		options: [
			{
				displayName: 'Channel Names or IDs',
				name: 'channelIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getPostChannels' },
				default: [],
				description:
					'Only needed if the draft has no channels yet. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Scheduled At',
				name: 'scheduledAt',
				type: 'dateTime',
				default: '',
				description:
					'Leave empty to publish now. A time without a zone is read in the workflow time zone.',
			},
		],
	},

	// ------------------------------------------------------- wait for result
	{
		displayName: 'Wait Until Published',
		name: 'waitUntilPublished',
		type: 'boolean',
		default: false,
		displayOptions: forPost(['create', 'publish', 'approve', 'retry']),
		description:
			'Whether to wait for the channels to answer and return the final result with the live links. Off: the post is returned as soon as it is accepted. Ignored for drafts, scheduled posts and posts waiting for approval.',
	},
	{
		displayName: 'Max Wait (Seconds)',
		name: 'maxWaitSeconds',
		type: 'number',
		typeOptions: { minValue: 5, maxValue: 600 },
		default: 120,
		displayOptions: {
			show: {
				resource: ['post'],
				operation: ['create', 'publish', 'approve', 'retry'],
				waitUntilPublished: [true],
			},
		},
		description:
			'How long to wait before returning the post as it is. Videos can take a few minutes. The post keeps publishing either way.',
	},

	// ----------------------------------------------------------------- reject
	{
		displayName: 'Reason',
		name: 'reason',
		type: 'string',
		default: '',
		displayOptions: forPost(['reject']),
		description: 'Shown to the team in the Ghamalim app',
	},

	// ---------------------------------------------------------------- getAll
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: forPost(['getAll']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['post'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: forPost(['getAll']),
		options: [
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				description: 'Find the post you created with this reference',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Draft', value: 'draft' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Partially Published', value: 'partially_published' },
					{ name: 'Pending Approval', value: 'pending_approval' },
					{ name: 'Published', value: 'published' },
					{ name: 'Publishing', value: 'publishing' },
					{ name: 'Rejected', value: 'rejected' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: 'published',
			},
		],
	},

	// ------------------------------------------------------ generateCaptions
	{
		displayName: 'Brief',
		name: 'brief',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: forPost(['generateCaptions']),
		description:
			'What the post is about, up to 2,000 characters. Sent to the AI provider. Counts as one AI session of the plan.',
	},
	{
		displayName: 'Options',
		name: 'captionOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: forPost(['generateCaptions']),
		options: [
			{
				displayName: 'Platforms',
				name: 'platforms',
				type: 'multiOptions',
				options: [
					{ name: 'Facebook', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'LinkedIn', value: 'linkedin' },
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'X', value: 'x' },
				],
				default: [],
				description: 'One caption is written for each platform',
			},
			{
				displayName: 'Tone',
				name: 'tone',
				type: 'string',
				default: '',
				placeholder: 'e.g. friendly, professional',
			},
		],
	},

	// ---------------------------------------------------------- getBestTimes
	{
		displayName: 'Options',
		name: 'bestTimeOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: forPost(['getBestTimes']),
		options: [
			{
				displayName: 'Channel Names or IDs',
				name: 'channelIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getPostChannels' },
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Number of Suggestions',
				name: 'suggestions',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 10 },
				default: 4,
			},
			{
				displayName: 'Time Zone',
				name: 'timezone',
				type: 'string',
				default: '',
				placeholder: 'e.g. Asia/Manila',
				description: 'IANA time zone name. Leave empty to use the workflow time zone.',
			},
		],
	},
];
