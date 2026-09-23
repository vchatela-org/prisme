# FUP · 2026-09-22 · The proxy provider cannot sign asymmetrically, so authentication moves

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** ADR proposed, stopped for review

Found by deploying prisme. [ADR-0021](../20-decisions/0021-verified-forward-auth-assertion.md)'s
first deployment obligation — *"the proxy provider has an asymmetric signing keypair assigned"* — is
**undeliverable on the identity provider this instance runs**, and the reason is that provider's
design rather than a misconfiguration. [ADR-0026](../20-decisions/0026-human-auth-via-oidc.md)
proposes the supersession and is **Proposed, not Accepted**; nothing was implemented against it.

## What was done

Diagnosis only. No code changed, in this repository or in the deployment's, beyond documentation:

- The clearing mechanism was pinned down, having defeated three earlier explanations.
- The claim that the approach is unsupported was checked against the provider's own source and its
  maintainers' record, rather than inferred from the symptom.
- ADR-0026 written; ADR-0021 flagged as proposed-for-supersession.
- The deployment repository's runbook and the registration script corrected to stop presenting the
  keypair as a solution (its own pull request).

## Decisions taken

**Diagnosis before any fix.** The first three explanations were all wrong, and each was wrong in an
instructive way — worth recording because the same three will occur to the next person:

1. *"A pod restarted."* Both pods showed an unchanged start time and zero restarts. True, and
   irrelevant: the reconcile runs **inside** the pod.
2. *"Something wrote it without logging."* The audit log genuinely had no entry. Also true, and the
   reason was not what it implied — the handler needs the request that owns the save, and there is
   none.
3. *"It's on a six-hour schedule."* Six hours was how often anyone **looked**. The cadence is
   traffic-driven: a server-side worker re-fork re-runs the startup reconcile, and only a re-fork that
   lands on a particular worker slot does it.

**A workaround was refused, deliberately.** A scheduled job that re-assigns the key would restore
service in an afternoon. It was rejected as the *answer* — not as an aid — because it treats designed
behaviour as a fault, needs a privileged job purely to defeat a reconcile, and leaves the system one
missed run from an outage. A control that must never fail is worse than a mechanism that does not
need one. The operator reached the same conclusion independently, which is why the investigation
went looking for the intended behaviour instead.

**The verification property is kept; only the login location moves.** ADR-0026 is not a retreat from
"verify a signature, never trust a header". The existing verifier already validates a JWT against a
configured key set with a fixed asymmetric allow-list, and an OIDC ID token is such a JWT. What
changes is where the token comes from, and what prisme must therefore hold.

**The cost is stated rather than absorbed.** ADR-0021 rule 5 said *"there is no prisme session to
steal, fixate, or forget to invalidate"*. OIDC requires a session, so that sentence stops being true
and the work it avoided becomes real. ADR-0026 says so in its Consequences rather than burying it.

## Surprises

**The security obligation was unachievable, and nothing said so.** The spec named it correctly, the
deployment implemented it as written, the implementation was verified working — and it silently
decayed. There is no error, no log line and no alarm; the key set simply becomes empty again, and the
first symptom is a crashlooping pod two layers away. A configuration whose correctness has a shelf
life is a category the spec set has no vocabulary for.

**Measuring the mechanism mattered more than measuring the symptom.** "The key is gone" was
established in minutes; "why" took most of a day and four hypotheses. The decisive step was not
another measurement but reading the provider's own source for who calls the function that nulls the
field, and then finding the caller that runs at a moment with no pod restart behind it.

**One claim was confirmed by an accident of the cluster.** That an OIDC provider keeps its keypair
while a proxy provider does not is established by another application on the same instance, whose key
has survived restarts. A controlled experiment would have been better and was not necessary.

## Follow-ups

- **ADR-0026 is Proposed.** Accepting it is a human step; implementing the login flow against it while
  it is Proposed would be exactly the silent-contradiction the protocol forbids.
- **The deployment is fragile in the meantime.** The key set is empty as of this writing, and the
  running API booted while it was populated. A restart lands in `CrashLoopBackOff`, and
  `docs/15-runtime.md` §6's obligation 1 should be read as undeliverable until 0026 lands.
- **Re-registration is a configuration change, not a data one.** There is one deployment and it is
  read-only, so nothing has to be migrated.

## Specs touched

None in this change beyond the ADR set — deliberately. `docs/15-runtime.md` §6 states obligation 1 as
a deployment requirement and it is now known to be undeliverable, but *which* text replaces it depends
on which way the supersession goes, and it is a different edit per outcome. Correcting it now would
pre-judge the decision 0026 exists to put to a human.
