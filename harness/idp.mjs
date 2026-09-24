/**
 * A throwaway OpenID Connect provider, for driving the real login flow locally.
 *
 *   node harness/idp.mjs        # listens on 9099, prints the issuer
 *
 * Started by [`up.sh`](up.sh); you do not normally run it by itself.
 *
 * ## Why this exists rather than a mock of prisme's own code
 *
 * Every assertion in [`drive.mjs`](drive.mjs) is about the *seam*: the PKCE
 * challenge the application stored against the verifier it sends back, the
 * cookie attributes, which failures refuse and which redirect. A stub that
 * returned a token without checking anything would let all of those pass while
 * being wrong, because the thing under test is the agreement between two
 * parties and this is the second party.
 *
 * So this provider is **strict on purpose**, and each strictness is something
 * prisme should fail against:
 *
 *   - `code_challenge` is S256 of the `code_verifier` presented at the token
 *     endpoint, recomputed here. A flow that dropped the verifier, or that
 *     stored the challenge instead of the verifier, fails here and nowhere else.
 *   - the authorization code is **single use** and is deleted when redeemed, so
 *     a replayed callback gets `invalid_grant`.
 *   - `state` is echoed exactly as received, so a flow that lost it is refused
 *     by the application rather than passing quietly.
 *   - `redirect_uri` must match the one the code was issued for.
 *
 * ## Nothing here is a secret, and nothing here is real
 *
 * The keypair is generated at boot and lives only in memory, so a restart
 * invalidates every token this process signed — which is the desired behaviour
 * and the reason the provider must be up before the API probes the key set. The
 * issuer, the client id and the subject are invented; the reserved `.invalid`
 * name is used nowhere here precisely because the issuer must be a host the
 * application can actually reach.
 *
 * This is a development tool and it authenticates anybody who asks. It is not
 * to be exposed, and `up.sh` binds it to the loopback interface.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const PORT = Number(process.env['HARNESS_IDP_PORT'] ?? '9099');
const HOST = '127.0.0.1';
const ISSUER = `http://localhost:${PORT}`;
const CLIENT_ID = 'prisme-local';
const AUDIENCE = 'prisme-local';
const SUBJECT = 'local-owner';
/** `drive.mjs` asserts `exp - iat` is exactly this. */
const TTL_SECONDS = 300;

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: 'harness', alg: 'RS256', use: 'sig' };

/** code → { challenge, redirectUri } — and an authorization code is single use. */
const codes = new Map();

async function idToken(overrides = {}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const subject = overrides.subject ?? SUBJECT;
  return new SignJWT({ preferred_username: subject })
    .setProtectedHeader({ alg: 'RS256', kid: 'harness' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(subject)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (overrides.ttl ?? TTL_SECONDS))
    .sign(privateKey);
}

const base64url = (buffer) => buffer.toString('base64url');

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'cache-control': 'no-store', ...headers });
  response.end(body);
}

function json(response, status, value) {
  send(response, status, JSON.stringify(value), { 'content-type': 'application/json' });
}

async function readForm(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

/** The token endpoint, in `application/x-www-form-urlencoded`. */
async function mint(response, form) {
  if (form.get('grant_type') !== 'authorization_code') {
    json(response, 400, { error: 'unsupported_grant_type' });
    return;
  }

  const code = form.get('code') ?? '';
  const issued = codes.get(code);
  if (issued === undefined) {
    // Includes the replay: the code was deleted when it was first redeemed.
    json(response, 400, { error: 'invalid_grant', error_description: 'unknown or spent code' });
    return;
  }
  codes.delete(code);

  if (form.get('redirect_uri') !== issued.redirectUri) {
    json(response, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return;
  }

  const verifier = form.get('code_verifier') ?? '';
  const recomputed = base64url(createHash('sha256').update(verifier, 'ascii').digest());
  if (recomputed !== issued.challenge) {
    json(response, 400, {
      error: 'invalid_grant',
      error_description: 'code_verifier does not match the code_challenge',
    });
    return;
  }

  json(response, 200, {
    access_token: randomUUID(),
    token_type: 'Bearer',
    expires_in: TTL_SECONDS,
    id_token: await idToken(),
  });
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', ISSUER);

    if (url.pathname === '/jwks') {
      json(response, 200, { keys: [jwk] });
      return;
    }

    if (url.pathname === '/authorize') {
      const clientId = url.searchParams.get('client_id');
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const challenge = url.searchParams.get('code_challenge') ?? '';

      /*
       * Refused loudly rather than redirected. An error sent back through
       * `redirect_uri` would arrive at the application as a callback it has to
       * interpret; a 400 here names the parameter that was wrong, which is what
       * somebody debugging the flow actually needs.
       */
      if (clientId !== CLIENT_ID || redirectUri === '' || challenge === '') {
        send(response, 400, 'authorize: client_id, redirect_uri and code_challenge are required');
        return;
      }
      if (url.searchParams.get('response_type') !== 'code') {
        send(response, 400, 'authorize: response_type must be code');
        return;
      }
      if (url.searchParams.get('code_challenge_method') !== 'S256') {
        // Plain PKCE defeats the point, and the application must never ask.
        send(response, 400, 'authorize: code_challenge_method must be S256');
        return;
      }

      const code = randomUUID();
      codes.set(code, { challenge, redirectUri });

      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      // Echoed exactly. A provider that invented its own state would make the
      // application's own check vacuous.
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      send(response, 303, '', { location: back.toString() });
      return;
    }

    /*
     * The token endpoint. Omitted on the first draft of this file, and the
     * failure is worth recording because nothing pointed at it: `/token`
     * answered 404, the application classified that as an *unrecognised* error
     * rather than a refusal, and every later assertion failed downstream with
     * no line in any log naming the provider.
     */
    if (url.pathname === '/token') {
      if (request.method !== 'POST') {
        send(response, 405, 'token: POST only\n');
        return;
      }
      await mint(response, await readForm(request));
      return;
    }

    /*
     * Not a browser-facing page and not an end session either: it answers 200
     * so the redirect is observable, and the assertion about it lives in
     * drive.mjs — that the application sends the browser *here* rather than
     * only clearing its own cookie.
     */
    if (url.pathname === '/end-session') {
      send(response, 200, '<!doctype html><title>signed out</title>end session\n', {
        'content-type': 'text/html; charset=utf-8',
      });
      return;
    }

    /*
     * Two tokens that are signed correctly and must nevertheless be refused: one
     * expired, one for a subject outside the allow-list. They exist because
     * "the signature verifies" and "this token authenticates somebody" are
     * different claims, and only a positive control can tell them apart.
     */
    if (url.pathname === '/expired-token') {
      send(response, 200, await idToken({ ttl: -3600 }), { 'content-type': 'text/plain' });
      return;
    }

    if (url.pathname === '/wrong-subject-token') {
      send(response, 200, await idToken({ subject: 'somebody-else' }), {
        'content-type': 'text/plain',
      });
      return;
    }

    send(response, 404, 'not found\n');
  })().catch((error) => {
    // A crashed handler must not take the provider down mid-drive: the drive
    // would then fail everywhere and name nothing. Answer 500 with the reason.
    send(response, 500, `idp: ${String(error)}\n`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`harness idp listening on ${ISSUER}  (jwks /jwks · issuer ${ISSUER})`);
});
