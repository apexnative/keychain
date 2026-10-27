# Security policy

`@apexnative/keychain` stores secrets: a vulnerability in it can expose the secrets of the apps that use it. Please
report one privately, never in a public issue, pull request or discussion.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: on the repository's **Security** tab, choose
[Report a vulnerability](https://github.com/apexnative/keychain/security/advisories/new). Only you and the
repository's maintainers see the report.

Include what you can of:

- the version of `@apexnative/keychain` and of React Native;
- the platform and its version, and the device or simulator;
- the options of the items involved;
- what an attacker gains, and what they need for it: physical access, another app on the device, a backup, a rooted
  or jailbroken device;
- the steps or the code that reproduce it.

## What happens next

The maintainer answers in the advisory, works out the fix there with you, and publishes it as a new version together
with the advisory. You are credited in the advisory, unless you'd rather not be named.

## Supported versions

Fixes go into the newest version on npm. Until 1.0.0 is released, that is the newest pre-release; older pre-releases
get no fixes.

## Scope

What the package protects against, and what it leaves to the operating system or to the app, is in the
[threat model](https://keychain.apexnative.dev/docs/security/threat-model). What the threat model names as out of
reach of the package, such as code running inside the app on a rooted or jailbroken device, isn't a vulnerability of
the package; a way around a protection it claims is.
