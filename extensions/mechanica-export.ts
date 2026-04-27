import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, parse, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const OUTPUT_FILE = "manifest.json";
const MODEL_ASSETS_DIR = "assets/models";
const MANIFEST_FORMAT = "wyld-tinkers-mechanica.scene";
const GENERATED_BY = "wyld-tinkers-workshop-mechanica-ext";
const SUPPORTED_MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);

type Vector3 = [number, number, number];

type ModelAsset = {
  id: string;
  type: "gltf";
  src: string;
  [key: string]: unknown;
};

type ManifestAssets = {
  models: ModelAsset[];
  textures: unknown[];
  materials: unknown[];
  [key: string]: unknown;
};

type MechanicaObject = {
  id: string;
  type: string;
  name?: string;
  assetRef?: string;
  position?: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
  selectable?: boolean;
  transformable?: boolean;
  [key: string]: unknown;
};

type MechanicaSceneManifest = {
  manifestVersion: 2;
  format: typeof MANIFEST_FORMAT;
  name: string;
  description: string;
  requirements: string;
  units: "meters";
  generatedBy: typeof GENERATED_BY;
  assets: ManifestAssets;
  scene: {
    background: string;
    grid: {
      visible: boolean;
      size: number;
      divisions: number;
      [key: string]: unknown;
    };
    camera: {
      type: "perspective";
      position: Vector3;
      target: Vector3;
      fov: number;
      [key: string]: unknown;
    };
    lights: unknown[];
    objects: MechanicaObject[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PreparedModelAsset = ModelAsset & {
  sourcePath: string;
  outputPath: string;
  outputFilename: string;
};

function hashText(input: string, length = 12): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function manifestSrcFor(projectRoot: string, outputPath: string): string {
  return normalizePath(relative(projectRoot, outputPath));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function buildDefaultManifest(requirements: string): MechanicaSceneManifest {
  const trimmedRequirements = requirements.trim();

  return {
    manifestVersion: 2,
    format: MANIFEST_FORMAT,
    name: "Mechanica Export",
    description: trimmedRequirements || "Minimal Mechanica scene exported from Pi.",
    requirements: trimmedRequirements,
    units: "meters",
    generatedBy: GENERATED_BY,
    assets: {
      models: [],
      textures: [],
      materials: []
    },
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
      objects: []
    }
  };
}

async function loadManifest(manifestPath: string, requirements: string, warnings: string[]): Promise<MechanicaSceneManifest> {
  const defaults = buildDefaultManifest(requirements);

  let existingJson: string;
  try {
    existingJson = await readFile(manifestPath, "utf8");
  } catch (error) {
    return defaults;
  }

  try {
    const parsed: unknown = JSON.parse(existingJson);
    if (!isPlainObject(parsed)) {
      warnings.push(`Existing manifest is not a JSON object and will be replaced: ${manifestPath}`);
      return defaults;
    }

    const existingAssets = isPlainObject(parsed.assets) ? parsed.assets : {};
    const existingScene = isPlainObject(parsed.scene) ? parsed.scene : {};

    return {
      ...defaults,
      ...parsed,
      manifestVersion: 2,
      format: MANIFEST_FORMAT,
      generatedBy: GENERATED_BY,
      assets: {
        ...defaults.assets,
        ...existingAssets,
        models: Array.isArray(existingAssets.models) ? (existingAssets.models as ModelAsset[]) : [],
        textures: Array.isArray(existingAssets.textures) ? existingAssets.textures : [],
        materials: Array.isArray(existingAssets.materials) ? existingAssets.materials : []
      },
      scene: {
        ...defaults.scene,
        ...existingScene,
        objects: Array.isArray(existingScene.objects) ? (existingScene.objects as MechanicaObject[]) : []
      }
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to parse existing manifest and will replace it: ${manifestPath}: ${reason}`);
    return defaults;
  }
}

function uniqueOutputFilename(sourcePath: string, usedFilenames: Set<string>): string {
  const originalBasename = basename(sourcePath);
  if (!usedFilenames.has(originalBasename)) {
    usedFilenames.add(originalBasename);
    return originalBasename;
  }

  const parsed = parse(originalBasename);
  const normalizedSourcePath = normalizePath(sourcePath);
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

function deterministicAssetId(sourcePath: string): string {
  return `model-${hashText(normalizePath(sourcePath))}`;
}

function resolveAssetId(sourcePath: string): string {
  return deterministicAssetId(sourcePath);
}

function safeBasename(path: string): string {
  return basename(path.replace(/\\/g, "/"));
}

function isAbsoluteOrRootRelativeSrc(src: string): boolean {
  return src.startsWith("/") || /^[A-Za-z]:[\\/]/.test(src);
}

function normalizeExistingModelSrcs(manifest: MechanicaSceneManifest, warnings: string[]): void {
  for (const model of manifest.assets.models) {
    if (typeof model.src !== "string" || !isAbsoluteOrRootRelativeSrc(model.src)) {
      continue;
    }

    const previousSrc = model.src;
    if (previousSrc.startsWith(`/${MODEL_ASSETS_DIR}/`)) {
      model.src = previousSrc.slice(1);
    } else {
      model.src = `${MODEL_ASSETS_DIR}/${safeBasename(previousSrc)}`;
    }
    warnings.push(`Model asset ${model.id} used an absolute or root-relative src (${previousSrc}); rewrote to ${model.src}.`);
  }
}

function reserveExistingModelFilenames(manifest: MechanicaSceneManifest): Set<string> {
  const filenames = new Set<string>();
  for (const model of manifest.assets.models) {
    if (typeof model.src === "string" && model.src.startsWith(`${MODEL_ASSETS_DIR}/`)) {
      filenames.add(safeBasename(model.src));
    }
  }
  return filenames;
}

async function reservePhysicalModelFilenames(projectRoot: string, usedFilenames: Set<string>): Promise<void> {
  try {
    const entries = await readdir(resolve(projectRoot, MODEL_ASSETS_DIR), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        usedFilenames.add(entry.name);
      }
    }
  } catch (error) {
    // The caller creates the directory before preparing assets; ignore races or unreadable directories here.
  }
}

async function prepareModelAssets(args: string, projectRoot: string, manifest: MechanicaSceneManifest, warnings: string[]): Promise<PreparedModelAsset[]> {
  const sourcePaths = findModelPathArgs(args);
  const preparedAssets: PreparedModelAsset[] = [];
  const seenSources = new Set<string>();
  const usedFilenames = reserveExistingModelFilenames(manifest);
  await reservePhysicalModelFilenames(projectRoot, usedFilenames);

  for (const pathArg of sourcePaths) {
    const sourcePath = resolve(projectRoot, pathArg);
    const normalizedSourcePath = normalizePath(sourcePath);

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

    const id = resolveAssetId(sourcePath);
    const existing = manifest.assets.models.find((model) => model.id === id && typeof model.src === "string");
    const sourceIsAlreadyInModelsDir = dirname(sourcePath) === resolve(projectRoot, MODEL_ASSETS_DIR);
    const outputFilename = existing?.src?.startsWith(`${MODEL_ASSETS_DIR}/`)
      ? safeBasename(existing.src)
      : sourceIsAlreadyInModelsDir
        ? basename(sourcePath)
        : uniqueOutputFilename(sourcePath, usedFilenames);
    usedFilenames.add(outputFilename);
    const outputPath = resolve(projectRoot, MODEL_ASSETS_DIR, outputFilename);
    const src = manifestSrcFor(projectRoot, outputPath);

    preparedAssets.push({
      id,
      type: "gltf",
      src,
      sourcePath,
      outputPath,
      outputFilename
    });
  }

  return preparedAssets;
}

async function copyModelAssets(assets: PreparedModelAsset[], warnings: string[]): Promise<ModelAsset[]> {
  if (assets.length === 0) {
    return [];
  }

  await mkdir(dirname(assets[0].outputPath), { recursive: true });
  const copiedAssets: ModelAsset[] = [];

  for (const asset of assets) {
    try {
      if (asset.sourcePath !== asset.outputPath) {
        await copyFile(asset.sourcePath, asset.outputPath);
      }
      copiedAssets.push({ id: asset.id, type: asset.type, src: asset.src });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to copy model asset ${asset.sourcePath}: ${reason}`);
    }
  }

  return copiedAssets;
}

function buildModelObject(asset: ModelAsset, index: number): MechanicaObject {
  return {
    id: `object-${asset.id}`,
    type: "model",
    name: index === 0 ? "Primary Model" : `Model ${index + 1}`,
    assetRef: asset.id,
    position: [index * 1.5, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    selectable: true,
    transformable: true
  };
}

function mergeCopiedAssets(manifest: MechanicaSceneManifest, copiedAssets: ModelAsset[], warnings: string[]): void {
  const modelIndexById = new Map<string, number>();
  manifest.assets.models.forEach((model, index) => modelIndexById.set(model.id, index));

  for (const asset of copiedAssets) {
    const existingIndex = modelIndexById.get(asset.id);
    if (existingIndex === undefined) {
      manifest.assets.models.push(asset);
      modelIndexById.set(asset.id, manifest.assets.models.length - 1);
      continue;
    }

    const existing = manifest.assets.models[existingIndex];
    if (existing.type === asset.type && existing.src === asset.src) {
      manifest.assets.models[existingIndex] = { ...existing, ...asset };
      continue;
    }

    warnings.push(`Model asset id collision for ${asset.src}; existing asset ${asset.id} points to ${existing.src}. Skipping duplicate asset.`);
  }
}

function mergeModelObjects(manifest: MechanicaSceneManifest, copiedAssets: ModelAsset[]): void {
  const existingObjectIds = new Set(manifest.scene.objects.map((object) => object.id));
  const existingModelAssetRefs = new Set(
    manifest.scene.objects.filter((object) => object.type === "model" && typeof object.assetRef === "string").map((object) => object.assetRef as string)
  );

  copiedAssets.forEach((asset, index) => {
    if (existingModelAssetRefs.has(asset.id)) {
      return;
    }

    const object = buildModelObject(asset, index);
    if (existingObjectIds.has(object.id)) {
      object.id = `${object.id}-${hashText(asset.src, 8)}`;
    }
    manifest.scene.objects.push(object);
    existingObjectIds.add(object.id);
    existingModelAssetRefs.add(asset.id);
  });
}

function validateAssetRefs(manifest: MechanicaSceneManifest): string[] {
  const warnings: string[] = [];
  const modelIds = new Set(manifest.assets.models.map((model) => model.id));

  for (const object of manifest.scene.objects) {
    if (object.type === "model" && typeof object.assetRef === "string" && !modelIds.has(object.assetRef)) {
      warnings.push(`Object ${object.id} references missing model asset ${object.assetRef}`);
    }
  }

  return warnings;
}

function logPreparedAsset(asset: PreparedModelAsset): void {
  console.log(`Mechanica asset copy path: ${asset.outputPath}`);
  console.log(`Mechanica asset relative src: ${asset.src}`);
  console.log(`Mechanica asset id: ${asset.id}`);
}

export default function mechanicaExportExtension(pi: ExtensionAPI): void {
  pi.registerCommand("mechanica-export", {
    description: "Export or merge a Mechanica scene manifest to ./manifest.json",
    handler: async (args, ctx) => {
      const warnings: string[] = [];
      const projectRoot = ctx.cwd;
      const manifestPath = resolve(projectRoot, OUTPUT_FILE);
      const modelsOutputDir = resolve(projectRoot, MODEL_ASSETS_DIR);

      console.log(`Mechanica project root: ${projectRoot}`);
      await mkdir(modelsOutputDir, { recursive: true });

      const manifest = await loadManifest(manifestPath, args || "", warnings);
      normalizeExistingModelSrcs(manifest, warnings);
      const preparedModelAssets = await prepareModelAssets(args || "", projectRoot, manifest, warnings);
      preparedModelAssets.forEach(logPreparedAsset);

      const copiedModelAssets = await copyModelAssets(preparedModelAssets, warnings);
      mergeCopiedAssets(manifest, copiedModelAssets, warnings);
      mergeModelObjects(manifest, copiedModelAssets);
      warnings.push(...validateAssetRefs(manifest));

      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const notify = ctx.ui.notify as (message: string, type?: "info" | "warning" | "error") => void;
      for (const warning of warnings) {
        console.warn(warning);
        notify(warning, "warning");
      }

      const message = `Mechanica scene manifest exported: ${manifestPath}`;
      console.log(message);
      notify(message, warnings.length > 0 ? "warning" : "info");
    }
  });
}
