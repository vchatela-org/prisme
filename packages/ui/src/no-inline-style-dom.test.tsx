// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CspNonceProvider } from './lib/csp-nonce.js';
import { Dialog, DialogContent, DialogTitle } from './primitives/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './primitives/select.js';

/**
 * **A popup that opens must not inject a stylesheet the policy refuses.**
 *
 * The sibling guard, [`no-inline-style.test.tsx`](no-inline-style.test.tsx),
 * renders components with `react-dom/server` and refuses every `style`
 * *attribute* in the markup. It cannot see what this file exists for: Radix
 * appends `<style>` **elements** to the document at the moment a popup opens —
 * the select viewport's scrollbar rule, and the page-scroll lock underneath it —
 * and nothing about them is server-rendered. They were invisible to every check
 * the repository had, which is how they survived W07's clean-up and were only
 * found by opening a `Select` in a browser: **two violations, on every open**.
 *
 * A `<style>` element is what `style-src 'self' 'nonce-…'` exists to authorise,
 * and a nonce cannot authorise a `style` attribute — the two guards cover one
 * half each and neither is optional. What is asserted here is the mechanism,
 * end to end: a component mounted under the provider must give **every**
 * stylesheet it injects the page's nonce, so the browser applies it instead of
 * refusing it.
 *
 * It is also the guard that makes depending on a library's nonce support safe:
 * a bump that stops reading it turns this red rather than putting the
 * violations quietly back.
 *
 * jsdom has no layout and no observers, so the few APIs Radix and floating-ui
 * reach for at mount are stubbed below. None of them is what is being asserted:
 * the assertions are about the elements that end up in the document.
 */

// --- The minimum a headless DOM needs to open a Radix popup ---
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
globalThis.ResizeObserver = NoopObserver;
// `IntersectionObserver` has members this stub does not implement (`rootMargin`, `thresholds`),
// and nothing here observes anything: the assertion is the shortest honest way to say so.
globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

// React refuses to batch inside `act` without saying so out loud, and a
// component test in the repository's *node* project has no runner setting it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NONCE = 'test-nonce-not-a-secret';

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = '';
});

/** Mounts `node` under the nonce provider and returns the container. */
function mount(node: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<CspNonceProvider nonce={NONCE}>{node}</CspNonceProvider>);
  });
  mounted.push(() => {
    act(() => root.unmount());
  });
  return host;
}

/** Opens a Radix select by keyboard — the pointer path needs a real mouse. */
async function open(trigger: Element | null): Promise<void> {
  act(() => {
    trigger?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  // The popper positions asynchronously, and the scroll lock is injected from
  // an effect. One macrotask is what a browser would also wait for.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function injectedStylesheets(): HTMLStyleElement[] {
  return Array.from(document.querySelectorAll('style'));
}

describe('a popup authorises every stylesheet it injects', () => {
  it('Select (Radix) — the viewport rule and the scroll lock both carry the nonce', async () => {
    const host = mount(
      <Select value="a">
        <SelectTrigger id="nonce-trigger">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
          <SelectItem value="b">B</SelectItem>
        </SelectContent>
      </Select>,
    );

    await open(host.querySelector('#nonce-trigger'));

    const sheets = injectedStylesheets();
    // The guard against a vacuous pass: if Radix ever stops injecting, or stops
    // opening, this fails rather than reporting a clean sweep of nothing. Two
    // is what is observed — the viewport's rule and the scroll lock.
    expect(
      sheets.length,
      'nothing was injected, so this test is asserting nothing — check that the popup opened',
    ).toBeGreaterThanOrEqual(2);
    expect(
      sheets.map((sheet) => sheet.nonce),
      'a stylesheet was injected without the page nonce. The policy is ' +
        "style-src 'self' 'nonce-…' with no unsafe-inline, so the browser refuses " +
        'that element and logs a violation. lib/csp-nonce.tsx is where the nonce ' +
        'comes from: a dependency that stopped reading it, or a provider that is ' +
        'no longer mounted above this component, is the cause.',
    ).toEqual(sheets.map(() => NONCE));
    // The popup really opened — an unopened one injects nothing either.
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('Dialog (Radix) — the scroll lock is shared, so a modal is covered too', () => {
    const host = mount(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>An invented dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(host.ownerDocument.querySelector('[role="dialog"]')).not.toBeNull();

    const sheets = injectedStylesheets();
    expect(sheets.length).toBeGreaterThanOrEqual(1);
    expect(sheets.map((sheet) => sheet.nonce)).toEqual(sheets.map(() => NONCE));
  });

  it('a provider with no nonce injects none, rather than inventing one', async () => {
    /*
     * The negative control, and the reason the two above mean something: with
     * no nonce supplied the element comes out bare — which is exactly the state
     * that logs a violation — so they are not passing on a value that was never
     * threaded through.
     *
     * It asserts on the **viewport** sheet, which is the one that comes from
     * this package's own context: `setNonce` is a module-level variable, so the
     * scroll lock keeps whatever a provider set earlier in the process. That is
     * a property of the mechanism rather than of the test — it is why the
     * provider sets it once for the whole document instead of per component —
     * and reading it here would make this case depend on test order.
     */
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <CspNonceProvider nonce={undefined}>
          <Select value="a">
            <SelectTrigger id="bare-trigger">
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">A</SelectItem>
            </SelectContent>
          </Select>
        </CspNonceProvider>,
      );
    });
    mounted.push(() => {
      act(() => root.unmount());
    });

    await open(host.querySelector('#bare-trigger'));

    const viewportSheets = injectedStylesheets().filter((sheet) =>
      (sheet.textContent ?? '').includes('data-radix-select-viewport'),
    );
    expect(viewportSheets.length).toBe(1);
    expect(viewportSheets[0]?.getAttribute('nonce')).toBeNull();
  });
});
