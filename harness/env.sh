# The local harness's environment. Sourced by `up.sh`; every value is a
# development throwaway and none of it describes a real instance.
#
# It lives in a tracked file on purpose. The alternative — each session writing
# its own — is what made this harness get rebuilt and thrown away ten times, and
# the values are the part that took the longest to get right: they have to agree
# across three processes, and the issuer in particular has to be byte-identical
# to what the provider signs and the API verifies.
#
# Ports, and why these three:
#   9099  the fake provider        (loopback only — see idp.mjs)
#   3200  the API                  (3001 is the web tier, so the API steps aside)
#   3001  the web tier             (matches .env.example, and the OIDC redirect)
#
# The redirect URI must share an origin with PRISME_BASE_URL, and the session
# cookie is scoped to it — which is why the web tier is `localhost:3001` here
# while the API is `127.0.0.1:3200`. Both are loopback; the names differ only
# because the cookie is `__Host-` and must not carry a Domain.

export DATABASE_URL='postgres://prisme:prisme@127.0.0.1:5432/prisme'

# The web tier.
export PRISME_BASE_URL='http://localhost:3001'
export PRISME_API_URL='http://127.0.0.1:3200'

# The identity provider, and the subject allow-list that decides which of its
# tokens authenticate anybody. This is the one place a token can be refused for
# a reason no earlier check can reach.
export AUTH_ISSUER_URL='http://localhost:9099'
export AUTH_JWKS_URL='http://localhost:9099/jwks'
export AUTH_AUDIENCE='prisme-local'
export AUTH_ALLOWED_SUBJECTS='local-owner'

# Required, and not a leftover. ADR-0026 removed the assertion header from the
# **way in** — the web tier runs the login flow itself and reads no header — but
# the web tier then forwards the token it verified to the API in this header, and
# the API reads it there. Two checks in drive.mjs depend on the distinction: the
# API accepts the forwarded token, and the *web* tier refuses a valid token
# presented in this header directly.
export AUTH_ASSERTION_HEADER='x-prisme-assertion'

export OIDC_CLIENT_ID='prisme-local'
export OIDC_REDIRECT_URI='http://localhost:3001/auth/callback'
export OIDC_AUTHORIZATION_ENDPOINT='http://localhost:9099/authorize'
export OIDC_TOKEN_ENDPOINT='http://localhost:9099/token'
export OIDC_END_SESSION_ENDPOINT='http://localhost:9099/end-session'

# No `OIDC_CLIENT_SECRET`, and its absence is the point: the client is public and
# PKCE is what holds the property (ADR-0026 rule 4). `config` has no such
# variable, so setting one would do nothing while looking like it did.

# Named `harness-...` so a leak is obvious in a log. None is a secret: the
# outward tools are never called by this harness, and the pepper protects
# nothing that exists here.
export TOKEN_PEPPER='harness-pepper-not-a-secret'
export DOCTOOL_API_TOKEN='harness-not-a-secret'
export TASKTOOL_API_TOKEN='harness-not-a-secret'

# The write freeze stays ON. The harness drives reads and a login; nothing it
# does should be able to write outward, and turning this on in a scratch
# environment is how somebody discovers it applies to a real one too.
export SYNC_WRITE_ENABLED='false'
export SYNC_ENABLED='false'

export LOG_LEVEL='info'
export TZ='UTC'
