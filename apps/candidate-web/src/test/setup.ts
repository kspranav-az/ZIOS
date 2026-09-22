import '@testing-library/jest-dom/vitest';

// react-router v7 data routers (createMemoryRouter) build `new Request(url,
// { signal })` on every navigation. Under vitest's jsdom environment the
// signal comes from jsdom's AbortController, but Node's undici Request only
// accepts Node's own AbortSignal primordial ("Expected signal to be an
// instance of AbortSignal") — so navigate() rejected and data-router tests
// never changed location. Wrapping Request to drop foreign signals keeps
// navigation working; nothing in component-route tests aborts requests.
const OriginalRequest = globalThis.Request;

class TestRequest extends OriginalRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init && 'signal' in init) {
      const rest = { ...init };
      delete rest.signal;
      super(input, rest);
    } else {
      super(input, init);
    }
  }
}

Object.defineProperty(globalThis, 'Request', {
  value: TestRequest,
  writable: true,
  configurable: true,
});
