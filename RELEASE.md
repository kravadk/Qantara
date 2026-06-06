# Qantara Release Guide

Releases are created from Git tags and packaged by `.github/workflows/release.yml`.

## Version Rules

The release tag must use this shape:

```text
vMAJOR.MINOR.PATCH
```

The workflow validates that these package versions match the tag without the
leading `v`:

- `backend/package.json`
- `qie-app/package.json`
- `contracts/package.json`
- `tg-bot/package.json`

The SDK may match the same version or the same version with `-beta.1`.

## Create A Release

1. Update package versions.
2. Run the normal verification set:

```bash
cd backend && npm run lint && npm test && npm run build
cd ../qie-app && npm run lint && npm test && npm run build
cd ../contracts && npm run build && npm test && node --check scripts/check-deploy-hardening.cjs && node --check scripts/regen-verified.cjs && node --check scripts/check-verified-manifest.cjs && node scripts/check-deploy-hardening.cjs && node scripts/regen-verified.cjs && node scripts/check-verified-manifest.cjs
cd ../packages/qantara-sdk && npm run lint && npm run build
cd ../../tg-bot && node --check index.js
node scripts/production-hygiene.mjs
node --check scripts/production-preflight.mjs
```

3. Create and push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds the release from clean checkout state.

## Release Artifacts

The workflow publishes:

- `qantara-backend-<version>.tar.gz`
- `qantara-frontend-<version>.tar.gz`
- `qantara-contracts-<version>.tar.gz`
- `qantara-docs-<version>.tar.gz`
- `qantara-sdk-<version>.tgz`
- `SHA256SUMS.txt`
- `release-manifest.json`

The backend bundle contains compiled `dist`, package metadata, Dockerfile, and
Railway config. The frontend bundle contains static `dist`, package metadata,
Dockerfile, and nginx config. The contracts bundle contains production contract
sources, QIE deployment records, and the one-file verification bundle. Test
contracts, generated artifacts, and Hardhat network records are excluded.
The SDK artifact is created with `npm pack` from `packages/qantara-sdk` and
contains only the package allowlist from `package.json`. The docs bundle
contains operator and deployment documents.

Release bundle validation rejects test contracts, Hardhat cache and artifacts,
generated type bindings, Hardhat network records, and token test-contract
sources. Source hygiene and release packaging also exclude build outputs such as
`qie-app/dist`, `packages/qantara-sdk/dist`, `backend/dist`,
`contracts/artifacts`, `contracts/cache`, and `contracts/typechain-types` from
source scans and production source bundles. Production contract bundles should
contain only deployed contract sources, deployment registry files, and
verification documents.
Release bundles must not contain runtime environment files, SQLite databases,
WAL/SHM sidecars, backup directories, pre-restore snapshots, dependency
directories, build caches, coverage output, or generated contract artifacts.
Frontend release bundles must not contain API keys or other runtime secrets;
the production frontend image does not accept API keys as build arguments.
The release workflow validates these exclusions before checksums and manifests
are produced.
Release promotion should also run `node scripts/production-preflight.mjs
.env.production` against the intended deployment environment. Production QUSDC
must point to a real token; addresses whose metadata contains non-production
labels are not acceptable for production release.

Deploy-hardening checks run before release packaging through
`contracts/scripts/check-deploy-hardening.cjs`; a release should not be promoted
when those checks fail.
The contracts release job also regenerates `qieMainnet.verified.json` and then
validates it with `contracts/scripts/check-verified-manifest.cjs` before
packaging, so stale source, bytecode, address, compiler, or constructor metadata
blocks the release.

## Verify A Release

After downloading artifacts:

```bash
sha256sum -c SHA256SUMS.txt
```

Compare `release-manifest.json` with the downloaded file names, byte sizes, and
hashes.

## Manual Packaging

The release workflow can also be started manually from GitHub Actions with a
version input. Manual runs upload artifacts but do not publish a GitHub release
unless triggered from a tag.
