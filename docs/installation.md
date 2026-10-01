# Local installation, update and rollback

`python3 scripts/install.py install` installs the current built payload under `~/plugins/oso-code-codex`, creates `~/.local/bin/oso-codex`, adds five uniquely named `~/.codex/agents/oso-code-codex-*.toml` roles, appends its own personal-marketplace entry, and asks the native Codex CLI to install it. A receipt at `~/.local/state/oso-code-codex-install/receipt.json` records owned hashes. The source repository itself is not the installed cache.

The installer preflights ownership and symlink destinations before mutation. It preserves other marketplace entries and settings. An interrupted install retains both old and pending file hashes; rerunning the same source version resumes. If that pending source was changed, use the original pending payload or remove the owned partial installation before installing a different version. A user-modified file is preserved and reported explicitly rather than overwritten. Existing owned versions are backed up under the receipt directory.

After installing or changing the payload, validate native discovery and trust only the plugin's current hook through the supported native API:

```sh
python3 scripts/codex-probe.py --project "$PWD" --trust-owned --output /tmp/oso-code-codex-load.json
```

The probe exits unsuccessfully if a required skill is absent or disabled, the owned PreToolUse hook is absent, an owned hook remains disabled/untrusted after the native update, or skill/hook paths resolve to different payloads. Its report retains `validation.status` and the concrete problems. Pass `--expected-version VERSION` when validating an update to reject a coherent but stale cache. Open a new Codex thread to load the changed plugin. Existing threads can retain old instructions or cached paths.

Before continuing in that new thread, preserve the current Engram plan/index position and reconcile its existing runtime. If an old thread repeatedly reports `Hook failed` and the named cache no longer exists, the hook command cannot start. A successful probe of the new payload does not repair that old thread. Do not recreate managed cache directories or disable Oso as a recovery mechanism; the supported update handoff is a fresh thread loading the installed payload. A stable CLI launcher does not change the hook path already loaded by the host.

## Update a development installation

Build and validate first, then use the official helper to change the cache identity:

```sh
npm run build
npm run validate
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py" "$PWD"
python3 scripts/install.py install
python3 scripts/codex-probe.py --project "$PWD" --trust-owned --output /tmp/oso-code-codex-load.json
```

The helper path resolves to the current user's Codex home. Do not hand-edit the native plugin cache or reset unrelated Codex configuration. Changing a version while an installation is pending is intentionally refused to preserve recoverability.

## Remove or revert

```sh
python3 scripts/install.py remove
```

Removal calls native removal for this plugin when it is registered, removes only hash-verified owned files and its marketplace entry, and retains unrelated settings, integrations, source history and project run records. Locally customized owned files stop removal before mutation so they can be preserved intentionally. Empty parent directories and native cached history may remain; they are harmless and are not recursively deleted.

For a prior source release, use a separate checkout of that known commit, run its documented build/validation and reinstall from that checkout after removal. The original OsoCode installation is not automatically restored or modified. Do not run the old bootstrap merely to remove this fork.

Parking and roadmap authority can upgrade a run to state version 2; finite recovery control uses version 3. New AUTO policy, explicit AUTO adoption and external-fulfillment provenance require version 4 with minimum reader 4. Durable roadmap lineage and truthful coordination/configuration/contribution accounting require version 5 with minimum reader 5. The current reader accepts v1–v5. Reading or installing alone does not migrate records; supported creation, authorized amendment or compatible reconciliation constructs and validates a complete promoted record before atomic replacement. Legacy finite policies remain binding until actually authorized adoption.

Retain a reader supporting the highest adopted version when reverting the plugin: older readers explicitly reject v5, and an older payload backup cannot resume its records. Rollback preserves those records and their evidence; reinstall a compatible payload to resume. Reinstallation does not adopt policies, downgrade records or convert another host's old green evidence into current checks. See [correction compatibility](../references/correction-recovery.md) and [lifecycle compatibility](../references/runtime-recovery.md).

The installer supports `--target TEMP --stage-only` for isolated payload/ownership tests. Native personal activation requires the real user directory. This prevents a test target from silently registering the wrong personal plugin.
