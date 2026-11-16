# Changelog

## 0.5.0

- **Ticket, Contact, Post and Message** selectors are now pickers: choose **From List** (newest first,
  with a name you can recognise; contacts can be searched) or **By ID** for an ID from an expression
  such as `{{ $json.data.ticket_id }}`.
- **Workflows made with 0.4 or earlier:** the value of these fields changed shape. Open the node and
  choose the item again, or paste the ID in **By ID**. The seven example workflows are updated.

## 0.4.1

- **Ticket** and **Contact**: a Simplify switch on Get and Get Many returns the most used fields
  (tickets with the contact flattened and tags as names). Off by default, so existing workflows keep
  their output.
- Placeholders start with "e.g." and the generic error text no longer uses the word "failed".

## 0.4.0

- **Message → Get Many** returns a working link for attachments, the sender's name and the reason a
  message was not delivered, and can filter by Created After.
- **Ghamalim Trigger**: Message Received now carries the message ID and a link to the attached photo,
  voice note or file.
- **Contact → Update**: Automatic Replies switch (hand a conversation to a person, or back to the AI
  agent).
- **Ticket** output includes the channel ID.
- New resources: **Custom Field** (Get Many) and **Report** (Get Summary).

## 0.3.0

- **Ticket**: Get Many filters (priority, assignee or unassigned, group, channel, contact, tag,
  created after, updated after), Update can assign to a group, new Send Form operation.
- **Contact**: Get Many can search by part of the name, email or phone, and filter by created after.
- **Label**: Create and Delete.
- New resources: **Group**, **Saved Reply**, **Form** (list forms, read responses) and
  **Satisfaction Rating**.
- **Ghamalim Trigger**: four new events: Form Submitted, Note Created, Tag Removed and Ticket Priority
  Changed (26 in total).

## 0.2.0

- **Ticket**: Update (resolve, reopen, put on hold, snooze, change priority, assign or unassign), Add
  Tag (by name or from the list), Remove Tag, Add Note, Get Notes.
- **Contact**: Create, Update, and Create or Update (matched on phone, email or your own ID). Custom
  attributes are added to the existing ones.
- **Message**: Send WhatsApp Template, on a ticket or to a phone number. Sending to a number starts
  the conversation when there is none.
- Changes made by the node are recorded in Ghamalim as made by the member who created the API key.

## 0.1.0

First version.

- **Ghamalim** node: posts (create, schedule, draft, update, delete, publish draft, approve, reject,
  retry, refresh insights, AI captions, best times), messages (send text or a file to a ticket or a
  contact, list, moderate comments), tickets, contacts, channels, media upload, labels.
- "Wait Until Published" on post create, publish draft, approve and retry returns the final result
  with the live links.
- **Ghamalim Trigger** node: 22 events, self-registering webhook, signature and replay checks, and a
  retried delivery starts the workflow only once.
- **Ghamalim API** credential (API key).
