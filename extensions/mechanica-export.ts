import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, parse, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const OUTPUT_DIR = "mechanica-working-out";
const OUTPUT_FILE = "manifest.json";
const LEGACY_OUTPUT_FILE = "scene.manifest.json";
const MODEL_ASSETS_DIR = "assets/models";
const SUPPORTED_MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);

type Vector3 = [number, number, number];

type ModelAsset = {
  id: string;
  type: "gltf";
  src: string;
};

type ManifestAssets = {
  models: ModelAsset[];
  textures: [];
  materials: [];
};

type MechanicaObject =
  | {
      id: string;
      type: "model";
      name: string;
      assetRef: string;
      position: Vector3;
      rotation: Vector3;
      scale: Vector3;
      selectable: boolean;
      transformable: boolean;
    }
  | {
      id: string;
      type: "box";
      name: string;
      size: Vector3;
      position: Vector3;
      rotation: Vector3;
      material: {
        color: string;
        roughness: number;
        metalness: number;
      };
      selectable: boolean;
      transformable: boolean;
    };

type MechanicaSceneManifest = {
  manifestVersion: 2;
  format: "wyld-tinkers-mechanica.scene";
  name: string;
  description: string;
  requirements: string;
  units: "meters";
  generatedBy: "wyld-tinkers-workshop-mechanica-ext";
  assets: ManifestAssets;
  scene: {
    background: string;
    grid: {
      visible: boolean;
      size: number;
      divisions: number;
    };
    camera: {
      type: "perspective";
      position: Vector3;
      target: Vector3;
      fov: number;
    };
    lights: Array<
      | {
          type: "ambient";
          color: string;
          intensity: number;
        }
      | {
          type: "directional";
          color: string;
          intensity: number;
          position: Vector3;
        }
    >;
    objects: MechanicaObject[];
  };
};

type PreparedModelAsset = ModelAsset & {
  sourcePath: string;
  outputFilename: string;
};

class AssetRegistry {
  private readonly models = new Map<string, ModelAsset>();

  registerModel(asset: ModelAsset, warnings: string[]): string {
    const existing = this.models.get(asset.id);
    if (!existing) {
      this.models.set(asset.id, asset);
      return asset.id;
    }

    if (existing.type === asset.type && existing.src === asset.src) {
      return asset.id;
    }

    for (const hashLength of [8, 12, 16, 20, 24, 32]) {
      const candidateId = `${asset.id}-${hashText(asset.src, hashLength)}`;
      if (!this.models.has(candidateId)) {
        this.models.set(candidateId, { ...asset, id: candidateId });
        warnings.push(`Model asset id collision for ${asset.src}; using ${candidateId} instead of ${asset.id}.`);
        return candidateId;
      }
    }

    let counter = 2;
    let fallbackId = `${asset.id}-${hashText(`${asset.src}:${counter}`, 32)}-${counter}`;
    while (this.models.has(fallbackId)) {
      counter += 1;
      fallbackId = `${asset.id}-${hashText(`${asset.src}:${counter}`, 32)}-${counter}`;
    }

    this.models.set(fallbackId, { ...asset, id: fallbackId });
    warnings.push(`Model asset id collision for ${asset.src}; using ${fallbackId} instead of ${asset.id}.`);
    return fallbackId;
  }

  toManifestAssets(): ManifestAssets {
    return {
      models: Array.from(this.models.values()),
      textures: [],
      materials: []
    };
  }
}

function hashText(input: string, length = 12): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function normalizeSourcePath(path: string): string {
  return path.split(sep).join("/");
}

function tokenizeArgs(args: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(args)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
  }

  return tokens;
}

function cleanPotentialPath(token: string): string {
  return token.trim().replace(/^[<({\[]+/, "").replace(/[>)}\],.;:!?]+$/, "");
}

function findModelPathArgs(args: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const token of tokenizeArgs(args)) {
    const candidate = cleanPotentialPath(token);
    if (!SUPPORTED_MODEL_EXTENSIONS.has(extname(candidate).toLowerCase())) {
      continue;
    }

    if (!seen.has(candidate)) {
      seen.add(candidate);
      paths.push(candidate);
    }
  }

  return paths;
}

function uniqueOutputFilename(sourcePath: string, usedFilenames: Set<string>): string {
  const originalBasename = basename(sourcePath);
  if (!usedFilenames.has(originalBasename)) {
    usedFilenames.add(originalBasename);
    return originalBasename;
  }

  const parsed = parse(originalBasename);
  const normalizedSourcePath = normalizeSourcePath(sourcePath);
  for (const hashLength of [8, 12, 16, 20, 24, 32]) {
    const collisionSafeName = `${parsed.name}-${hashText(normalizedSourcePath, hashLength)}${parsed.ext}`;
    if (!usedFilenames.has(collisionSafeName)) {
      usedFilenames.add(collisionSafeName);
      return collisionSafeName;
    }
  }

  let counter = 2;
  let fallbackName = `${parsed.name}-${hashText(normalizedSourcePath, 32)}-${counter}${parsed.ext}`;
  while (usedFilenames.has(fallbackName)) {
    counter += 1;
    fallbackName = `${parsed.name}-${hashText(`${normalizedSourcePath}:${counter}`, 32)}-${counter}${parsed.ext}`;
  }
  usedFilenames.add(fallbackName);
  return fallbackName;
}

function uniqueAssetId(normalizedSourcePath: string, usedAssetIds: Map<string, string>, pathArg: string, warnings: string[]): string {
  const baseId = `model-${hashText(normalizedSourcePath)}`;
  const existingSource = usedAssetIds.get(baseId);
  if (!existingSource) {
    usedAssetIds.set(baseId, normalizedSourcePath);
    return baseId;
  }

  if (existingSource === normalizedSourcePath) {
    return baseId;
  }

  for (const hashLength of [16, 20, 24, 32, 40, 48, 64]) {
    const candidateId = `model-${hashText(normalizedSourcePath, hashLength)}`;
    const candidateSource = usedAssetIds.get(candidateId);
    if (!candidateSource) {
      usedAssetIds.set(candidateId, normalizedSourcePath);
      warnings.push(`Model asset id collision for ${pathArg}; using ${candidateId} instead of ${baseId}.`);
      return candidateId;
    }

    if (candidateSource === normalizedSourcePath) {
      return candidateId;
    }
  }

  let counter = 2;
  let fallbackId = `model-${hashText(`${normalizedSourcePath}:${counter}`, 64)}-${counter}`;
  while (usedAssetIds.has(fallbackId)) {
    counter += 1;
    fallbackId = `model-${hashText(`${normalizedSourcePath}:${counter}`, 64)}-${counter}`;
  }

  usedAssetIds.set(fallbackId, normalizedSourcePath);
  warnings.push(`Model asset id collision for ${pathArg}; using ${fallbackId} instead of ${baseId}.`);
  return fallbackId;
}

async function prepareModelAssets(args: string, cwd: string, warnings: string[]): Promise<PreparedModelAsset[]> {
  const sourcePaths = findModelPathArgs(args);
  const preparedAssets: PreparedModelAsset[] = [];
  const seenSources = new Set<string>();
  const usedFilenames = new Set<string>();
  const usedAssetIds = new Map<string, string>();

  for (const pathArg of sourcePaths) {
    const sourcePath = resolve(cwd, pathArg);
    const normalizedSourcePath = normalizeSourcePath(sourcePath);

    if (seenSources.has(normalizedSourcePath)) {
      continue;
    }
    seenSources.add(normalizedSourcePath);

    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) {
        warnings.push(`Model path is not a file and was skipped: ${pathArg}`);
        continue;
      }
    } catch (error) {
      warnings.push(`Model file was not found and was skipped: ${pathArg}`);
      continue;
    }

    const outputFilename = uniqueOutputFilename(sourcePath, usedFilenames);
    preparedAssets.push({
      id: uniqueAssetId(normalizedSourcePath, usedAssetIds, pathArg, warnings),
      type: "gltf",
      src: `/${MODEL_ASSETS_DIR}/${outputFilename}`,
      sourcePath,
      outputFilename
    });
  }

  return preparedAssets;
}

async function copyModelAssets(assets: PreparedModelAsset[], outputDir: string, warnings: string[]): Promise<ModelAsset[]> {
  if (assets.length === 0) {
    return [];
  }

  const modelsOutputDir = join(outputDir, MODEL_ASSETS_DIR);
  await mkdir(modelsOutputDir, { recursive: true });
  const copiedAssets: ModelAsset[] = [];

  for (const asset of assets) {
    try {
      await copyFile(asset.sourcePath, join(modelsOutputDir, asset.outputFilename));
      copiedAssets.push({ id: asset.id, type: asset.type, src: asset.src });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to copy model asset ${asset.sourcePath}: ${reason}`);
    }
  }

  return copiedAssets;
}

function buildModelObject(assetRef: string, index: number): MechanicaObject {
  return {
    id: index === 0 ? "primary-model-object" : `model-object-${index + 1}`,
    type: "model",
    name: index === 0 ? "Primary Model" : `Model ${index + 1}`,
    assetRef,
    position: [index * 1.5, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    selectable: true,
    transformable: true
  };
}

function buildCubeObject(): MechanicaObject {
  return {
    id: "primary-cube",
    type: "box",
    name: "Primary Cube",
    size: [1.2, 1.2, 1.2],
    position: [0, 0.6, 0],
    rotation: [0, 0, 0],
    material: {
      color: "#4ea1ff",
      roughness: 0.5,
      metalness: 0.1
    },
    selectable: true,
    transformable: true
  };
}

function validateAssetRefs(manifest: MechanicaSceneManifest): string[] {
  const warnings: string[] = [];
  const modelIds = new Set(manifest.assets.models.map((model) => model.id));

  for (const object of manifest.scene.objects) {
    if (object.type === "model" && !modelIds.has(object.assetRef)) {
      warnings.push(`Object ${object.id} references missing model asset ${object.assetRef}`);
    }
  }

  return warnings;
}

function buildManifest(requirements: string, modelAssets: ModelAsset[]): { manifest: MechanicaSceneManifest; warnings: string[] } {
  const trimmedRequirements = requirements.trim();
  const assetRegistry = new AssetRegistry();
  const objects: MechanicaObject[] = [];
  const warnings: string[] = [];

  modelAssets.forEach((asset, index) => {
    const assetRef = assetRegistry.registerModel(asset, warnings);
    objects.push(buildModelObject(assetRef, index));
  });

  objects.push(buildCubeObject());

  const manifest: MechanicaSceneManifest = {
    manifestVersion: 2,
    format: "wyld-tinkers-mechanica.scene",
    name: "Mechanica Export",
    description: trimmedRequirements || "Minimal Mechanica scene exported from Pi.",
    requirements: trimmedRequirements,
    units: "meters",
    generatedBy: "wyld-tinkers-workshop-mechanica-ext",
    assets: assetRegistry.toManifestAssets(),
    scene: {
      background: "#20242b",
      grid: {
        visible: true,
        size: 20,
        divisions: 20
      },
      camera: {
        type: "perspective",
        position: [4, 3, 5],
        target: [0, 0.6, 0],
        fov: 60
      },
      lights: [
        {
          type: "ambient",
          color: "#ffffff",
          intensity: 0.6
        },
        {
          type: "directional",
          color: "#ffffff",
          intensity: 1,
          position: [8, 10, 6]
        }
      ],
      objects
    }
  };

  warnings.push(...validateAssetRefs(manifest));
  return { manifest, warnings };
}

export default function mechanicaExportExtension(pi: ExtensionAPI): void {
  pi.registerCommand("mechanica-export", {
    description: "Export a Mechanica scene manifest to ./mechanica-working-out/manifest.json",
    handler: async (args, ctx) => {
      const warnings: string[] = [];
      const outputDir = resolve(ctx.cwd, OUTPUT_DIR);
      const outputPath = join(outputDir, OUTPUT_FILE);
      const legacyOutputPath = join(outputDir, LEGACY_OUTPUT_FILE);
      const preparedModelAssets = await prepareModelAssets(args || "", ctx.cwd, warnings);

      await mkdir(outputDir, { recursive: true });
      const copiedModelAssets = await copyModelAssets(preparedModelAssets, outputDir, warnings);
      const { manifest, warnings: validationWarnings } = buildManifest(args || "", copiedModelAssets);
      warnings.push(...validationWarnings);

      const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(outputPath, manifestJson, "utf8");
      await writeFile(legacyOutputPath, manifestJson, "utf8");

      const notify = ctx.ui.notify as (message: string, type?: "info" | "warning" | "error") => void;
      for (const warning of warnings) {
        console.warn(warning);
        notify(warning, "warning");
      }

      const message = `Mechanica scene manifest exported: ${outputPath}`;
      console.log(message);
      notify(message, warnings.length > 0 ? "warning" : "info");
    }
  });
}
