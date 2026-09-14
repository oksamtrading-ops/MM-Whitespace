# Sign-in is an email address and a password

**Decided 14 September 2026. Reverses doc 11's "magic link only for the pilot;
no passwords."**

## Why

The magic link worked. What did not work was the mail behind it: the pilot's
Resend account has no verified domain, so it delivers to one inbox, and **Kay
Ampofo — who owns the workbook and the domain knowledge — could not sign in.**
Unblocking that meant buying a domain, changing DNS and rotating a key before
anybody could log in at all.

An authentication path that depends on an external vendor being correctly
configured is not more available than one that does not. Three smaller reasons
agreed with it: the inbox round-trip is slow for reviewers working in repeated
sessions, a stakeholder asked for a conventional login, and removing mail from
the auth path removes a moving part from operating the system.

**This was an assumption, not an approved decision.** `QUESTIONS-PACK.md` lists
magic-link-only under *"six things the design assumed… stated so it can be
challenged"*, distinct from Decision 1, which is the one legal approved.
Doc 18 had already set the precedent for a later document reversing an earlier.

**Deloitte SSO is still the destination.** Nothing here moves away from it:
`ClaimSource` is untouched, and SSO remains a change to one function.

## What the old decision bought, and what replaces each part

| Removed by magic links | Back? | What answers it |
|---|---|---|
| Credential stuffing | Yes | An invite-only roster of ~5 accounts, behind a per-address and per-IP throttle |
| Password reuse | Yes | **Accepted.** Nothing here detects it. The blast radius is one pilot account |
| Reset flows | **No** | There is no self-serve reset, because there is no mail. An Admin issues a temporary password out of band; the holder must replace it |
| — | New | Account lockout, which the throttle creates. See below |

## scrypt, and why one notch below the published floor

`ln=15` (N=32768), r=8, p=1, 32-byte key, 16-byte salt, `maxmem` set explicitly
to 128 MB. Measured: **55 ms** per hash, 33.5 MB of working set.

OWASP's floor for scrypt is 2^17, which is 128 MB. **This is deliberately two
notches under it, and the reason is memory, not time.**

Every concurrent verify allocates its full working set, on an endpoint that by
definition has not authenticated anybody. At 128 MB per request a cheap flood of
`/signin` exhausts the function's memory and takes the deployment with it — the
dashboard, the cron tick, the worker. That is a worse outcome, and a far easier
one to cause, than the offline cracking this would buy against for a five-person
invite-only roster. 33 MB is still far above any GPU core's private cache, which
is the property scrypt is actually bought for.

Two things make it safe to revisit rather than permanent: the hash is
self-describing (`$scrypt$ln=15,r=8,p=1$…`), so raising the cost is one constant
and `needsRehash` upgrades each account on its next sign-in; and a semaphore
bounds how many hashes are in flight, so the flood queues before it allocates
rather than after.

**`maxmem` must be passed.** Node's default is 32 MB, the job needs 33.5, and
omitting it throws — in production, on the first sign-in, having passed every
test that used a smaller N.

## The property, restated honestly

Doc 11 and the sign-in action used to claim **one answer, whoever asks**: a link
was mailed or it was not, and the form said the same sentence either way. That
cannot survive a password, because somebody holding the right one is let in and
already knows the account exists.

What is defended now:

> **Every refusal reads the same, and takes the same time.** Success looks
> different, because somebody with the correct password already knows the
> account exists.

Two things buy it, and both are load-bearing. An address with **no account is
verified against a decoy hash** rather than returned early, so it pays the same
55 ms. And every refusal is **floored to one wall-clock minimum**, because the
throttle can refuse without hashing at all — and a refusal that comes back in
five milliseconds instead of sixty says "this address is under attack", which
says "this address exists".

The floor must exceed the *slowest* refusal, not the fastest. That matters again
the day `needsRehash` starts upgrading accounts, because a hash left at a lower
cost verifies faster than the decoy and reopens the same oracle.

The old claim was left standing nowhere. A comment asserting a property the
system no longer has is what a reviewer checks *instead of* the code — which is
the lesson migration `0024` was written under.

## Lockout is a denial of service, knowingly

Eight failures against one address in fifteen minutes refuses everything from
that address, correct password included. **Anybody who knows a colleague's
address can spend those eight guesses on their behalf**, and both pilot Admins
use guessable gmail addresses.

Accepted, because:

1. The window **slides and expires on its own**. Fifteen minutes, no manual
   unlock, so the worst sustained is a rolling nuisance.
2. **There is no unlock screen, deliberately.** One on `/access` would be the
   deadlock it is meant to solve: both Admins locked out, cure behind an Admin
   session.
3. The refusal is **indistinguishable** from any other, so an attacker cannot
   confirm it landed.
4. The break-glass is **`scripts/set_temp_password.mjs`**, which clears the
   counter and runs outside the application entirely. Reaching it means already
   having the database URL.

A per-IP ceiling sits beside it, because a per-address counter is blind to one
guess against each of thirty accounts.

## Where the hash lives, and where it does not

**`auth_passwords`, not a column on `app_users`.** Migration `0010` says of the
session tables: *"a row in either is a credential's shadow. No application role
reads them."* `app_users` is not in that category — it is read by six screens
and joined for owner names and actor emails. So the secret sits in its own table
under `0010`'s grants: revoked from every role, RLS on, no policies.

`must_change_password` stays on `app_users`, because a boolean about an
account's state is not a credential, and keeping it there means `resolveUser`
and `userForSession` each read one more column rather than taking a join on the
authorisation path.

## The gate

`PasswordChangeRequired` is thrown by `assertRole` — the one function every
route, action and guarded page already calls. **It extends `Unauthenticated`,
and that is the design**: nothing anywhere catches `Unauthenticated` by name, so
a subclass lands in the else branch of all 16 page catch blocks and the route
handlers, rendering the "Sign in" refusal with its own message and returning
401, with no file edited.

A redirect would not work. `redirect()` throws `NEXT_REDIRECT`, and those same
catch blocks would swallow it into a refusal that never navigates.

The way past is `requireRole(roles, { allowPasswordChange: true })`, used by
exactly the change-password page and its action. It is **not** a new guard name
in `check_role_assertions.mjs`: adding one would let any action in the repository
satisfy the check while requiring no role. A test asserts the set of files
mentioning it, because that checker never scans a `page.tsx` at all.

## Three things found while building this, worth keeping

- **`AppUser` has two constructors.** `resolveUser` and `userForSession`, which
  builds one from its own join. The field is required rather than optional so
  the compiler names the second; optional, a miss would be `undefined`, falsy,
  and the gate would let everybody already signed in straight through.
- **`e2e:isolated` could not see a deletion.** It builds a worktree at `HEAD`
  then rsyncs the working tree over it — without `--delete`, so a deleted file
  survived and kept being served. Journey 6 passed against `/auth/verify` after
  that route was removed. Fixed with `--delete`; it was never specific to this
  change.
- **The form field's border was below the non-text floor on dark** (1.54:1
  against 3), because `check:contrast` was never told to look at a form field.
  `--input-border` is `--rule-raised` now, and the pair is checked.
