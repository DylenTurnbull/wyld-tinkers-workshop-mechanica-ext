# wyld-tinkers-workshop-mechanica-ext

Standalone Pi package that adds a `/mechanica-export` slash command for exporting a Wyld Tinkers Mechanica scene manifest into the current Forge project root.

## Command

```text
/mechanica-export [requirements] [model.glb|model.gltf ...]
```

The command treats Pi's `ctx.cwd` as the Forge project root. It writes and merges only this manifest file:

```text
./manifest.json
```

It does **not** create `mechanica-working-out/` and does **not** write the legacy `scene.manifest.json` file.

Any text after the command is stored as the manifest `requirements` field for a new manifest and, when present, is also used as the default description. If `./manifest.json` already exists, the exporter loads it, preserves existing scene data and unknown fields, then merges in new model assets and model objects.

If command arguments include paths ending in `.glb` or `.gltf`, those files are treated as model assets. Relative paths are resolved from the Forge project root (`ctx.cwd`). Valid files are copied into:

```text
./assets/models/
```

The directory is created if it does not exist. The copied asset preserves the original filename unless that filename would collide with an existing model asset/file, in which case a deterministic hash suffix is added. Re-exporting the same source file uses the same deterministic model asset ID and does not duplicate manifest assets, scene objects, or asset files.

Examples:

```text
/mechanica-export Create a simple workbench-sized calibration scene.
/mechanica-export Import ./models/gearbox.glb as a selectable model.
/mechanica-export "Use the reference model" "./models/example assembly.gltf"
```

## Install / uninstall

Pi loads TypeScript extensions directly. This package does not require `npm install`, TypeScript compilation, or a build step.

For local development, install this extension into Pi's global auto-discovery directory with the checked-in helper script:

```bash
scripts/install-pi-extension.sh
```

The script:

- detects this repository root;
- verifies `pi` is installed and on `PATH`;
- honors `PI_CODING_AGENT_DIR` when set;
- otherwise derives Pi's actual agent directory from the installed Pi source after verifying the installed docs/source describe the default `~/.pi/agent` workflow and global extension auto-discovery;
- creates `agent-dir/extensions/` if needed;
- symlinks only `extensions/mechanica-export.ts` as `wyld-tinkers-workshop-mechanica-export.ts`;
- refuses to overwrite unrelated extensions.

After install, run Pi normally from any Forge project root. No `-e` flag is required:

```bash
cd /path/to/forge-project
pi
# then use:
# /mechanica-export Import ./models/gearbox.glb
```

Uninstall only this extension symlink/file with:

```bash
scripts/uninstall-pi-extension.sh
```

Both scripts are safe to rerun. Install refreshes an existing symlink that already points at this repo; uninstall reports success/no-op if the extension is already absent.

Optional validation without touching your real Pi agent directory:

```bash
tmp_agent_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$tmp_agent_dir" scripts/install-pi-extension.sh
PI_CODING_AGENT_DIR="$tmp_agent_dir" scripts/uninstall-pi-extension.sh
rm -rf "$tmp_agent_dir"
```

For a one-off test without installing, you can still use Pi's explicit extension flag:

```bash
pi -e ./extensions/mechanica-export.ts
```

Pi package metadata is also declared in `package.json`:

```json
{
  "pi": {
    "extensions": ["./extensions/mechanica-export.ts"]
  }
}
```

## Export behavior

- Project root: `ctx.cwd`.
- Manifest output: `./manifest.json` only.
- Model asset directory: `./assets/models/`.
- Manifest version: `manifestVersion: 2`.
- Manifest format: `format: "wyld-tinkers-mechanica.scene"`.
- Model asset `src` values are project-relative paths such as `assets/models/gearbox.glb`.
- Model asset `src` values never include a leading slash, absolute path, or system path.
- Scene objects created for imported models use `type: "model"` and `assetRef`.
- Model asset IDs are deterministic from the resolved source path.
- Existing manifest fields, existing scene data, and unknown fields are preserved during merge.
- Missing model files, copy failures, and ID collisions are reported as warnings.
- The command logs the project root, each asset copy path, each resolved relative `src`, and each asset ID.

## Example `manifest.json`

After running:

```text
/mechanica-export Import ./models/gearbox.glb as a selectable model.
```

The project root may contain:

```text
./manifest.json
./assets/models/gearbox.glb
```

A checked-in copy of this style of manifest is available at [`examples/manifest.json`](examples/manifest.json).

Example manifest:

```json
{
  "manifestVersion": 2,
  "format": "wyld-tinkers-mechanica.scene",
  "name": "Mechanica Export",
  "description": "Import ./models/gearbox.glb as a selectable model.",
  "requirements": "Import ./models/gearbox.glb as a selectable model.",
  "units": "meters",
  "generatedBy": "wyld-tinkers-workshop-mechanica-ext",
  "assets": {
    "models": [
      {
        "id": "model-84f0a9c1d2e3",
        "type": "gltf",
        "src": "assets/models/gearbox.glb"
      }
    ],
    "textures": [],
    "materials": []
  },
  "scene": {
    "background": "#20242b",
    "grid": {
      "visible": true,
      "size": 20,
      "divisions": 20
    },
    "camera": {
      "type": "perspective",
      "position": [4, 3, 5],
      "target": [0, 0.6, 0],
      "fov": 60
    },
    "lights": [
      {
        "type": "ambient",
        "color": "#ffffff",
        "intensity": 0.6
      },
      {
        "type": "directional",
        "color": "#ffffff",
        "intensity": 1,
        "position": [8, 10, 6]
      }
    ],
    "objects": [
      {
        "id": "object-model-84f0a9c1d2e3",
        "type": "model",
        "name": "Primary Model",
        "assetRef": "model-84f0a9c1d2e3",
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1],
        "selectable": true,
        "transformable": true
      }
    ]
  }
}
```

The shown IDs are examples; actual IDs are stable hashes of resolved source paths in your project.

## MVP scope constraints

This is an MVP exporter. It intentionally does not synthesize full scenes from natural language, generate meshes, validate against a formal schema, change Mechanica/runtime behavior, or add configuration systems. The command only writes a Manifest v2 scene scaffold and merges optional copied glTF/GLB model assets into the Forge project root workflow.
