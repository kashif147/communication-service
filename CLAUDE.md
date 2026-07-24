# CLAUDE.md

`communication-service` owns everything that sends something to a member: bulk email campaigns
(via AWS SES), one-off mail-merged letters (Word/PDF, via OneDrive/SharePoint templates + Azure
Blob storage), and event-driven "comms" triggered by other services over RabbitMQ (gap letters,
undergraduate graduation letters, event registration confirmations). It owns its own MongoDB
(Mongoose) — templates, campaigns, generated letters, outbound communication log, bookmark field
definitions.

Its `Template` model here is for mail-merge **content** templates (Word/HTML), not a grid
Save-View filter template — see `TEMPLATE_IMPLEMENTATION_PLAYBOOK.md` (repo root) if working from
the full projectShell checkout; correspondence/notification-admin *grid* templates are owned by
notification-service, not here.

## Commands and dev environment
@.claude/rules/dev-commands.md

## Deployment
@.claude/rules/deployment.md

## Auth
@.claude/rules/auth.md

## The three send paths
@.claude/rules/send-paths.md

## Bookmark merge system
@.claude/rules/bookmark-merge.md

## RabbitMQ
@.claude/rules/rabbitmq.md

## Cross-service calls
@.claude/rules/cross-service-calls.md

## SES/SNS delivery webhook
@.claude/rules/ses-webhook.md

## Response envelope & errors
@.claude/rules/response-envelope.md
