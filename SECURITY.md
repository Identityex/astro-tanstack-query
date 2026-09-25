# Security policy

## Supported versions

Until 1.0, only the latest published minor version receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Identityex/astro-tanstack-query/security/advisories/new).

Include the affected version, your Astro adapter and runtime, and a reproduction if you have
one. You should get an acknowledgement within a week. Once a fix is released, the advisory is
published with credit to you, unless you prefer to stay anonymous.

## What is in scope

The areas that matter most for this package:

- **Cross-request data leakage** on the server, where one request sees another request's
  cached or prefetched data.
- **Script injection through dehydrated state**, where a value breaks out of the emitted
  `<script type="application/json">` element.
- **Errors or data that should not be dehydrated reaching the HTML.**

Deliberately prefetching private data into a page is not a vulnerability in this package: it
embeds exactly what you prefetch.
