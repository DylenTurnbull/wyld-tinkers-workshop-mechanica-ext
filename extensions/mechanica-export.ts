import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const OUTPUT_DIR = "mechanica-working-out";
const OUTPUT_FILE = "scene.manifest.json";

type Vector3 = [number, number, number];

type MechanicaSceneManifest = {
  manifestVersion: 1;
  format: "wyld-tinkers-mechanica.scene";
  name: string;
  description: string;
  requirements: string;
  units: "meters";
  generatedBy: "wyld-tinkers-workshop-mechanica-ext";
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
    objects: Array<{
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
    }>;
  };
};

function buildManifest(requirements: string): MechanicaSceneManifest {
  const trimmedRequirements = requirements.trim();

  return {
    manifestVersion: 1,
    format: "wyld-tinkers-mechanica.scene",
    name: "Mechanica Export",
    description: trimmedRequirements || "Minimal Mechanica scene exported from Pi.",
    requirements: trimmedRequirements,
    units: "meters",
    generatedBy: "wyld-tinkers-workshop-mechanica-ext",
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
      objects: [
        {
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
        }
      ]
    }
  };
}

export default function mechanicaExportExtension(pi: ExtensionAPI): void {
  pi.registerCommand("mechanica-export", {
    description: "Export a minimal Mechanica scene manifest to ./mechanica-working-out/scene.manifest.json",
    handler: async (args, ctx) => {
      const outputDir = resolve(ctx.cwd, OUTPUT_DIR);
      const outputPath = join(outputDir, OUTPUT_FILE);
      const manifest = buildManifest(args || "");

      await mkdir(outputDir, { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

      const message = `Mechanica scene manifest exported: ${outputPath}`;
      console.log(message);
      const notify = ctx.ui.notify as (message: string, type?: "info" | "warning" | "error" | "success") => void;
      notify(message, "success");
    }
  });
}
