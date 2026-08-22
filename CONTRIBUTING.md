# Contributing

Use Node 24 and the pnpm version pinned in `package.json`. Create a focused branch and keep unrelated local work out of the change.

Before opening a pull request, run:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm security:secrets
pnpm security:dependencies
```

Add tests for authorization failures and side effects, not only success responses. A mock or unit test must not be labelled as live Discord or Cloudflare evidence.

Do not add user-token libraries, self-bot packages, voice receivers, audio generators, Opus encoders, FFmpeg, transcription, synthetic activity, broad Discord permissions, arbitrary target IDs, or secrets.

Documentation and user-visible messages should state facts, limits, and evidence. Remove generic filler, inflated claims, fake quotations, and unsupported security or readiness language.
