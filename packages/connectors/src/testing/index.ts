/**
 * `@prisme/connectors/testing` — recorded transports and fixture-backed clients.
 *
 * A separate entry point so that the thing which makes a network call and the
 * thing which guarantees one cannot happen are never confused at an import
 * site. W04, W05 and W12 build their own tests on these rather than inventing a
 * second fake of the same interface.
 */

export {
  createFixtureTransport,
  createSequenceTransport,
  type FixtureTransport,
  type RecordedRoute,
} from './fixture-transport.js';

export {
  createRecordedBindings,
  createRecordedDocToolClient,
  createRecordedTaskToolClient,
  type RecordedClient,
  type RecordedDocToolFixture,
  type RecordedTaskToolFixture,
} from './recorded.js';
