/**
 * The initiative screen's **Open page**, as a pure function.
 *
 * The same rule as `focus-view.ts`, `create-view.ts` and `timeline-view.ts`:
 * everything a screen decides is a function that can be tested without a
 * browser. This one is small, and it is a function rather than an inline
 * expression because of the two things it refuses.
 *
 * ## Why a template, and not a base URL
 *
 * prisme holds **no page URL**, deliberately. The document tool returns one on
 * every page and `packages/connectors/src/doc-tool` refuses to read it, because
 * it identifies the workspace (`wire.ts`, *"Deliberately not read"*). Nor is
 * `DOCTOOL_BASE_URL` the answer: that is the **API host**, which serves JSON, and
 * a person cannot open a page at it.
 *
 * So the operator supplies a template with `{id}` in it and this substitutes the
 * identifier the API already returns. The workspace stays out of git and no tier
 * of this application learns a vendor's URL layout — which is the property the
 * connectors' refusal exists to protect.
 *
 * ## The two refusals
 *
 * **No template, or no identifier, is `undefined`** — not an empty string and
 * not a half-link. The caller renders a disabled control that says why, which is
 * every instance's state until somebody sets the variable.
 *
 * **An identifier that changes the origin is refused.** The identifier arrives
 * from the document tool and is therefore third-party data: it is a string of up
 * to 200 characters with no character class enforced on it. A `{id}` in the path
 * cannot reach the host by itself, but this is a link a person clicks, and the
 * check costs one `new URL` — so the substituted URL must still be on the same
 * origin as the template that produced it.
 */
export function pageUrl(
  template: string | undefined,
  externalPageId: string | null,
): string | undefined {
  if (template === undefined) return undefined;
  if (externalPageId === null || externalPageId.trim() === '') return undefined;
  // The loader refuses a template with no placeholder, so this cannot arrive
  // from configuration. It is checked anyway because the function must not
  // depend on who called it: without the guard, a template with no `{id}`
  // returns the *same link for every page*, which looks configured and is
  // never right.
  if (!template.includes('{id}')) return undefined;

  const substituted = template.replace('{id}', externalPageId);

  try {
    const origin = new URL(template.replace('{id}', 'placeholder')).origin;
    const candidate = new URL(substituted);
    if (candidate.origin !== origin) return undefined;
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return undefined;
  } catch {
    // A template the loader would have refused, and an identifier that cannot
    // be part of a URL at all. Either way there is no honest link to render.
    return undefined;
  }

  /*
   * The substituted string, deliberately **not** `candidate.href`.
   *
   * `new URL` percent-encodes braces, so reading the link back through `.href`
   * would turn any *other* placeholder an operator used into `%7B…%7D`. What
   * they wrote is what they get; the parsing above is for validation only.
   */
  return substituted;
}
