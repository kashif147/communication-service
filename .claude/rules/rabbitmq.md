# RabbitMQ

`rabbitMQ/index.js` binds one queue per event family (`communication.user.events`,
`communication-service.membership.events`, `communication-service.events.events`) to topic
exchanges (`user.events`, `membership.events`, `events.events`) via
`@projectShell/rabbitmq-middleware`.

Add new inbound event types by extending the relevant `bindQueue` routing-key list and
registering a handler in `setupConsumers()`. Each handler lives in its own
`rabbitMQ/listeners/*.listener.js` module that stays thin and defers real work to a
`services/*Comms.service.js` file — don't put business logic directly in a listener module.

`publishDomainEvent()` exists for outbound events, but nothing in this service currently uses it
heavily — most side effects here (e.g. audit logging) go over plain HTTP instead (see the
cross-service-calls topic), not through a published event.
