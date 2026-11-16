# n8n-nodes-ghamalim

An [n8n](https://n8n.io/) community node for **Ghamalim**: publish social posts, reply to customers on
any connected channel (WhatsApp, LINE, Messenger, Instagram, Telegram, web chat and more), and start
workflows when something happens in your inbox.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) ·
[Trigger](#trigger) · [Examples](#examples) · [Good to know](#good-to-know) · [Development](#development)

## Installation

In n8n: **Settings > Community Nodes > Install**, enter `n8n-nodes-ghamalim`.
See the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. In Ghamalim, open **Settings > API Keys** (admin or supervisor) and create a key. It is shown once.
2. In n8n, create a **Ghamalim API** credential and paste the key. Leave *Base URL* as it is.

The credential test calls `GET /channels`, so "Connection tested successfully" means the key works.

## Operations

| Resource | Operations |
|---|---|
| **Post** | Create (publish now, schedule, or save a draft) · Get · Get Many · Update · Delete · Publish Draft · Approve · Reject · Retry · Refresh Insights · Generate Captions (AI) · Get Best Times |
| **Message** | Send to a ticket or straight to a contact (text, or a file from the input data) · Send WhatsApp Template (on a ticket, or to a phone number to start a conversation) · Get Many · Moderate Comment (hide, unhide, delete) |
| **Ticket** | Get · Get Many (filter by status, priority, assignee, group, channel, contact, tag, created or updated after) · Update (resolve, reopen, put on hold, snooze, priority, assign to a person or a group, unassign) · Add Tag · Remove Tag · Add Note · Get Notes · Send Form |
| **Contact** | Create · Update · Create or Update (matched on phone, email or your own ID) · Get · Get Many (search by name, email or phone; look up by phone, email or your own user ID) · Get Channels (where and whether the contact can be messaged right now) |
| **Channel** | Get · Get Many · Get WhatsApp Templates · Get TikTok Options |
| **Media** | Upload (returns a public link to use in a post) · Get Many |
| **Label** | Create (returns the existing label when the name is taken) · Delete · Get Many |
| **Custom Field** | Get Many |
| **Report** | Get Summary (tickets, response times, per day, per channel, per agent) |
| **Group** | Get Many |
| **Saved Reply** | Get Many (search by keyword or text) |
| **Form** | Get Many · Get Responses |
| **Satisfaction Rating** | Get Many (filter by score, ticket, created after) |

The node can also be used as a tool by n8n's AI Agent.

## Trigger

**Ghamalim Trigger** starts a workflow on any of 26 events: `message.received`, `message.sent`,
`message.failed`, `ticket.created`, `ticket.resolved`, `ticket.assigned`, `contact.created`,
`csat.submitted`, `form.submitted`, `note.created`, `sla.breached`, `post.published`, `post.failed` and others.

It registers itself in Ghamalim when the workflow is activated and removes itself when it is
deactivated. Every delivery is checked before the workflow runs: the signature must match the secret
Ghamalim issued for this workflow, and deliveries older than five minutes are refused. An event that
Ghamalim delivers a second time (a retry) starts the workflow only once.

Each run receives:

```json
{
  "id": "evt_…",
  "event": "message.received",
  "created_at": "2026-11-15T07:30:00.000Z",
  "data": { "ticket_id": "…", "contact_id": "…", "channel_id": "…", "channel_type": "line", "message_type": "text", "content": "Is this still available?" }
}
```

## Examples

- **Auto-post new listings**: your site's webhook or an RSS trigger → *Media: Upload* → *Post: Create*
  on Facebook and Instagram.
- **Answer after hours**: *Ghamalim Trigger* (`message.received`) → AI Agent → *Message: Send* with
  `{{ $json.data.ticket_id }}`.
- **Order updates**: your shop's "order shipped" event → *Contact: Get Many* (by phone) →
  *Message: Send* with **Send To: Contact**. The node finds the conversation where the customer can
  be messaged right now, or stops with the reason (for example WhatsApp's 24-hour window).
- **Tell the team**: *Ghamalim Trigger* (`sla.breached`, `post.failed`) → Slack or email.

Every place that needs one conversation, contact or post has a picker: **From List** to choose it,
or **By ID** to use an ID from an earlier step, for example `{{ $json.data.ticket_id }}`.

### Guide workflows

`examples/` holds seven ready-made workflows that show every operation with notes on the canvas:
posts, inbox (tickets, messages, contacts), channels/media/labels, the trigger, inbox actions (update,
tags, notes, contacts, WhatsApp templates, forms), team/saved replies/forms/satisfaction, and the
trigger for forms, notes, tags and priority. In n8n choose
**Import from File**, then select the **Ghamalim API** credential on the nodes. Steps that publish or
message a customer are deactivated until you switch them on.

## Good to know

- **Your n8n must be reachable on a public `https` address** for the trigger. Ghamalim refuses
  `http`, `localhost` and private addresses, so "Listen for test event" on a laptop needs a tunnel
  (`n8n start --tunnel`, or `WEBHOOK_URL` set to your public address).
- **A customer can only be messaged where they have written before.** *Send To: Contact* picks that
  conversation for you (set *Preferred Channel Type* to favour one, otherwise the most recent is
  used). *Contact: Get Channels* shows the same information as data.
- **WhatsApp after 24 hours, or writing first.** WhatsApp only delivers an approved template once
  the customer has been silent for 24 hours, and a template is the only way to write to someone
  first. Use *Message: Send WhatsApp Template*: on a ticket, or to a phone number (a contact and a
  conversation are created when the number is new). *Channel: Get WhatsApp Templates* lists the
  template names, languages and how many parameters each one needs. Templates with a picture or
  video header, or with a button that needs a value, cannot be sent yet.
- **Who made the change.** A ticket update, tag or note made by the node is recorded in Ghamalim as
  made by the team member who created the API key. Resolving a ticket also sends your satisfaction
  survey when one is set up, exactly as in the inbox.
- **One contact per person.** *Contact: Create* always adds a new contact. Use *Create or Update*
  with *Match On* to keep one record per phone number, email or your own ID.
- **Avoid double sends.** On *Message: Send* and *Post: Create*, set the *Idempotency Key* option
  (for example `{{ $execution.id }}-{{ $itemIndex }}`) when the node has "Retry On Fail" switched on.
- **Schedule times** without a zone are read in the workflow's time zone.
- **Posting takes a moment.** By default *Post: Create* answers as soon as the post is accepted.
  Switch on **Wait Until Published** to get the final result in the same step: the status and, per
  channel, the live link or the platform's reason for a failure. If the time limit passes first the
  post is returned as it is with `wait_timed_out: true` (it keeps publishing). For long videos, use
  the `post.published` / `post.failed` trigger events instead.
- **Several channels in one step.** Choose as many channels as you like on one *Post: Create*; there
  is no need for one node per platform. For a carousel, put the image links in *Media URLs*
  separated by commas.
- **Limits**: 120 requests a minute per API key. Errors show Ghamalim's own reason.
- Not covered yet: bulk post import, RSS schedules, watermarks, managing webhooks by hand. They are
  available through the [API](https://docs.ghamalim.net) with n8n's HTTP Request node and this credential.

## Compatibility

Built and tested against n8n 2.35 (Node.js 22). Needs Node.js 18 or newer.

## Development

```bash
npm install
npm run build     # compile to dist/
npm run lint      # n8n's community-node rules
npm test          # builds, then runs the node against a local fake of the API (no network)
npm run dev       # n8n on http://localhost:5678 with this node loaded
```

`test/node.test.js` covers request shapes, pagination, file upload, error messages, the trigger's
registration lifecycle and signature checks.

## License

MIT
