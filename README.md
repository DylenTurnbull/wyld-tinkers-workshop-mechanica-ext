# wyld-tinkers-workshop-mechanica-ext

Standalone Pi package that adds a `/mechanica-export` slash command for exporting a minimal Wyld Tinkers Mechanica scene manifest.

## Command

```text
/mechanica-export [requirements]
```

The command writes a deterministic starter scene manifest. Any text after the command is stored as the manifest `requirements` field and, when present, is also used as the manifest description.

Example:

```text
/mechanica-export Create a simple workbench-sized calibration cube scene.
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

The command creates the output directory if needed and writes:

```text
./mechanica-working-out/scene.manifest.json
```

The path is relative to Pi's current working directory for the active session. Running the command again overwrites the same manifest file.

## Manifest contents

The exported JSON includes:

```json
{
  "manifestVersion": 2,
  "assets": {
    "models": [
      { "id": "primary-model", "type": "gltf", "src": "assets/models/primary.glb" }
    ],
    "textures": [],
    "materials": []
  },
  "scene": {
    "objects": [
      { "id": "primary-model-object", "type": "model", "assetRef": "primary-model" },
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
  - one deterministic glTF model asset: `{ "id": "primary-model", "type": "gltf", "src": "assets/models/primary.glb" }`
  - empty `textures` and `materials` arrays
- `scene` data containing:
  - background color
  - visible grid settings
  - perspective camera position, target, and FOV
  - ambient and directional lights
  - one selectable, transformable model object referencing the registered model asset
  - one selectable, transformable blue box object named `Primary Cube` as a primitive fallback/test object

## MVP scope constraints

This is an MVP exporter. It intentionally does not synthesize full scenes from natural language, generate meshes, validate against a formal schema, or preserve prior exports. The output is a fixed minimal Manifest v2 scene scaffold with a deterministic model asset reference and the user's requirements captured for downstream tooling.
