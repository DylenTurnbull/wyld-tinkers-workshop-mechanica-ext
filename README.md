# wyld-tinkers-workshop-mechanica-ext

Standalone Pi package that adds a `/mechanica-export` slash command for exporting a minimal Wyld Tinkers Mechanica scene manifest.

## Command

```text
/mechanica-export [requirements] [model.glb|model.gltf ...]
```

The command writes a deterministic starter scene manifest. Any text after the command is stored as the manifest `requirements` field and, when present, is also used as the manifest description.

If the command arguments include paths ending in `.glb` or `.gltf`, those model files are treated as external assets. Relative paths are resolved from Pi's current working directory, valid files are copied once into the export's `assets/models` directory, and Manifest v2 model assets plus scene model objects are generated for them. Missing files or copy failures are reported as warnings and skipped.

Examples:

```text
/mechanica-export Create a simple workbench-sized calibration cube scene.
/mechanica-export Import ./models/gearbox.glb as a selectable model.
/mechanica-export "Use the reference model" "./models/example assembly.gltf"
```

## Local install / load

Pi loads TypeScript extensions directly. This package does not require `npm install`, TypeScript compilation, or a build step.

From this package directory:

```bash
pi install ./
```

For a project-local install, write the package entry to `.pi/settings.json` instead of global settings:

```bash
pi install -l ./
```

For a one-off test without installing:

```bash
pi -e ./
```

Pi loads the TypeScript extension declared in `package.json` directly:

```json
{
  "pi": {
    "extensions": ["./extensions/mechanica-export.ts"]
  }
}
```

## Output

The command creates the output directory if needed and writes the preferred manifest:

```text
./mechanica-working-out/manifest.json
```

For compatibility with earlier exports, it also writes the same JSON to:

```text
./mechanica-working-out/scene.manifest.json
```

Copied model assets are written under:

```text
./mechanica-working-out/assets/models/
```

Model asset `src` values use root-relative manifest paths such as `/assets/models/gearbox.glb`. Running the command again overwrites the manifests and recopies referenced assets.

## Manifest contents

The exported JSON includes:

```json
{
  "manifestVersion": 2,
  "assets": {
    "models": [
      { "id": "model-<stable-hash>", "type": "gltf", "src": "/assets/models/gearbox.glb" }
    ],
    "textures": [],
    "materials": []
  },
  "scene": {
    "objects": [
      { "id": "primary-model-object", "type": "model", "assetRef": "model-<stable-hash>" },
      { "id": "primary-cube", "type": "box", "name": "Primary Cube" }
    ]
  }
}
```

Summary:

- `manifestVersion: 2`
- `format: "wyld-tinkers-mechanica.scene"`
- `name`, `description`, and `requirements`
- `units: "meters"`
- `generatedBy: "wyld-tinkers-workshop-mechanica-ext"`
- top-level `assets` with exactly `models`, `textures`, and `materials`
  - one deterministic glTF model asset for each valid `.glb`/`.gltf` path in the command arguments
  - stable model asset IDs derived from normalized resolved source paths
  - root-relative model asset sources under `/assets/models/`
  - empty `textures` and `materials` arrays
- `scene` data containing:
  - background color
  - visible grid settings
  - perspective camera position, target, and FOV
  - ambient and directional lights
  - one selectable, transformable model object per copied model asset
  - one selectable, transformable blue box object named `Primary Cube` as a primitive fallback/test object

## MVP scope constraints

This is an MVP exporter. It intentionally does not synthesize full scenes from natural language, generate meshes, validate against a formal schema, or preserve prior exports beyond writing the legacy manifest filename. The output is a fixed minimal Manifest v2 scene scaffold with optional copied glTF/GLB assets and the user's requirements captured for downstream tooling.
