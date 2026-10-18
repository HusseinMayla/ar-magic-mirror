import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from "@pixiv/three-vrm";
import { TPose } from "kalidokit";
import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { CategoryDefinition } from "../ui/categories";

export type AvatarVisualMode = "ghost" | "full" | "hidden";

export interface AvatarSlot {
  vrm: VRM | null;
  modelUrl: string;
  isLoaded: boolean;
  isLoading: boolean;
  loadToken: number; // bumped on every new load, so a superseded load is discarded when it finishes
  active: boolean;
  modelHipRestY: number;
  modelTorsoDist: number;
  modelShoulderWidth: number;
  modelScale: number; // per-costume size multiplier from the category list
  targetPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  targetScale: THREE.Vector3;
  currentScale: THREE.Vector3;
}

export interface VRMManagerOptions {
  canvas: HTMLCanvasElement;
  initialCategory?: CategoryDefinition;
  onLoaded?: () => void;
  onError?: (err: Error) => void;
}

export class VRMManager {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Lighting
  private ambientLight: THREE.AmbientLight;
  private dirLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;

  // View & Render settings
  private visualMode: AvatarVisualMode = "full";
  private currentOpacity: number = 0.85;

  // Global calibration modifiers (tweakable in real time via Admin Panel)
  private scaleModifier: number = 1.0;
  private yOffsetModifier: number = 0.0;

  // Fixed camera depth plane for projection
  private readonly depthPlane: number = -2.5;

  // Multi-avatar pool (up to 4 slots)
  private slots: AvatarSlot[] = [];
  private currentCategory: CategoryDefinition | null = null;

  // Time tracking for VRM springbones and animations
  private clock: THREE.Clock = new THREE.Clock();

  constructor(options: VRMManagerOptions) {
    this.canvas = options.canvas;

    // 1. Scene setup
    this.scene = new THREE.Scene();

    // 2. Camera setup - origin at (0, 0, 0) looking down -Z
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100.0);
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);

    // 3. Renderer with transparent background (alpha: true)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // 4. Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.dirLight.position.set(0, 2, 2);
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 0.8);
    this.rimLight.position.set(0, 1, -2);
    this.scene.add(this.rimLight);

    // 5. Initialize 4 empty avatar slots
    for (let i = 0; i < 4; i++) {
      this.slots.push({
        vrm: null,
        modelUrl: "",
        isLoaded: false,
        isLoading: false,
        loadToken: 0,
        active: false,
        modelHipRestY: 1.0268,
        modelTorsoDist: 0.3892,
        modelShoulderWidth: 0.36,
        modelScale: 1,
        targetPosition: new THREE.Vector3(0, -0.65, this.depthPlane),
        currentPosition: new THREE.Vector3(0, -0.65, this.depthPlane),
        targetScale: new THREE.Vector3(1, 1, 1),
        currentScale: new THREE.Vector3(1, 1, 1)
      });
    }

    if (options.initialCategory) {
      this.loadCategory(options.initialCategory, options.onLoaded, options.onError);
    }
  }

  /**
   * Loads or switches all 4 slots to the models of the target category.
   */
  public loadCategory(
    category: CategoryDefinition,
    onLoaded?: () => void,
    onError?: (err: Error) => void
  ): void {
    this.currentCategory = category;
    let loadedCount = 0;
    let settledCount = 0;
    const totalToLoad = Math.min(category.models.length, 4);

    // Report completion once every slot has finished, even if some failed,
    // so a broken file can't leave the loading screen up forever
    const onSlotSettled = () => {
      settledCount++;
      if (settledCount >= totalToLoad) {
        console.log(`[VRMManager] Category '${category.name}' loaded (${loadedCount}/${totalToLoad} models).`);
        onLoaded?.();
      }
    };

    for (let i = 0; i < 4; i++) {
      const model = category.models[i];
      if (model) {
        this.slots[i].modelScale = model.scale ?? 1;
        this.loadSlotModel(i, model.url, () => {
          loadedCount++;
          onSlotSettled();
        }, (err) => {
          onError?.(err);
          onSlotSettled();
        });
      } else {
        // Clear slot if category has fewer than 4 models
        this.clearSlot(i);
      }
    }
  }

  private loadSlotModel(
    slotIndex: number,
    modelUrl: string,
    onLoaded?: () => void,
    onError?: (err: Error) => void
  ): void {
    const slot = this.slots[slotIndex];
    if (!slot) return;

    // If identical model is already loaded, reuse it
    if (slot.modelUrl === modelUrl && slot.vrm && slot.isLoaded) {
      onLoaded?.();
      return;
    }

    // Clean up previous VRM in this slot
    if (slot.vrm) {
      this.scene.remove(slot.vrm.scene);
      VRMUtils.deepDispose(slot.vrm.scene);
      slot.vrm = null;
      slot.isLoaded = false;
    }

    slot.modelUrl = modelUrl;
    slot.isLoading = true;
    const token = ++slot.loadToken;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      modelUrl,
      (gltf) => {
        // A newer load replaced this one while it was downloading: throw this model away
        if (token !== slot.loadToken) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }

        const vrm = gltf.userData.vrm as VRM;
        if (!vrm) {
          slot.isLoading = false;
          const err = new Error(`Failed to parse VRM from: ${modelUrl}`);
          onError?.(err);
          return;
        }

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        VRMUtils.rotateVRM0(vrm);

        // Hide initially until a person is tracked
        vrm.scene.visible = slot.active;
        this.scene.add(vrm.scene);
        slot.vrm = vrm;

        // Dynamically measure model metrics for accurate body scaling & hip positioning
        vrm.scene.updateMatrixWorld(true);
        const hips = vrm.humanoid?.getNormalizedBoneNode("hips");
        const leftArm = vrm.humanoid?.getNormalizedBoneNode("leftUpperArm");
        const rightArm = vrm.humanoid?.getNormalizedBoneNode("rightUpperArm");
        if (hips && leftArm && rightArm) {
          const hipPos = new THREE.Vector3();
          const lPos = new THREE.Vector3();
          const rPos = new THREE.Vector3();
          hips.getWorldPosition(hipPos);
          leftArm.getWorldPosition(lPos);
          rightArm.getWorldPosition(rPos);

          slot.modelHipRestY = hipPos.y;
          const shoulderCenter = lPos.clone().add(rPos).multiplyScalar(0.5);
          slot.modelTorsoDist = Math.max(0.25, hipPos.distanceTo(shoulderCenter));
          slot.modelShoulderWidth = Math.max(0.2, lPos.distanceTo(rPos));
        }

        this.applyVisualModeToSlot(slot);

        slot.isLoaded = true;
        slot.isLoading = false;
        onLoaded?.();
      },
      undefined,
      (err) => {
        if (token !== slot.loadToken) return;
        console.error(`[VRMManager] Error loading model ${modelUrl}:`, err);
        slot.isLoading = false;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
  }

  private clearSlot(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    if (!slot) return;
    slot.loadToken++; // cancel any load still in flight for this slot
    if (slot.vrm) {
      this.scene.remove(slot.vrm.scene);
      VRMUtils.deepDispose(slot.vrm.scene);
      slot.vrm = null;
    }
    slot.isLoaded = false;
    slot.isLoading = false;
    slot.active = false;
    slot.modelUrl = "";
  }

  public setSlotActive(slotIndex: number, active: boolean): void {
    const slot = this.slots[slotIndex];
    if (!slot) return;
    slot.active = active;
    if (slot.vrm) {
      slot.vrm.scene.visible = active && this.visualMode !== "hidden";
    }
  }

  /**
   * Unprojects NDC screen coordinates to a 3D point at the target Z plane.
   */
  private unprojectToZ(ndcX: number, ndcY: number, targetZ: number): THREE.Vector3 {
    const v = new THREE.Vector3(ndcX, ndcY, 0.5);
    v.unproject(this.camera);
    const dir = v.sub(this.camera.position).normalize();
    const distance = (targetZ - this.camera.position.z) / dir.z;
    return this.camera.position.clone().add(dir.multiplyScalar(distance));
  }

  /**
   * Aligns specific avatar slot position and scale to match a tracked person's 2D landmarks.
   */
  public updateSlotAlignment(
    slotIndex: number,
    landmarks: NormalizedLandmark[] | undefined,
    videoRect: { x: number; y: number; width: number; height: number },
    screenCssWidth: number,
    screenCssHeight: number
  ): void {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.vrm) return;

    const vrmScene = slot.vrm.scene;

    if (landmarks && landmarks.length >= 25) {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];

      const hipsVis = (leftHip?.visibility ?? 1) > 0.35 && (rightHip?.visibility ?? 1) > 0.35;
      const shouldersVis = (leftShoulder?.visibility ?? 1) > 0.35 && (rightShoulder?.visibility ?? 1) > 0.35;

      if (hipsVis && shouldersVis) {
        // Mirrored pixel coordinates on video rect
        const hipPixelX = videoRect.x + (1 - (leftHip.x + rightHip.x) / 2) * videoRect.width;
        const hipPixelY = videoRect.y + ((leftHip.y + rightHip.y) / 2) * videoRect.height;

        const shoulderPixelX = videoRect.x + (1 - (leftShoulder.x + rightShoulder.x) / 2) * videoRect.width;
        const shoulderPixelY = videoRect.y + ((leftShoulder.y + rightShoulder.y) / 2) * videoRect.height;

        // Convert to Normalized Device Coordinates (NDC: [-1, 1])
        const hipNdcX = (hipPixelX / screenCssWidth) * 2 - 1;
        const hipNdcY = -(hipPixelY / screenCssHeight) * 2 + 1;

        const shoulderNdcX = (shoulderPixelX / screenCssWidth) * 2 - 1;
        const shoulderNdcY = -(shoulderPixelY / screenCssHeight) * 2 + 1;

        const hip3D = this.unprojectToZ(hipNdcX, hipNdcY, this.depthPlane);
        const shoulder3D = this.unprojectToZ(shoulderNdcX, shoulderNdcY, this.depthPlane);

        // Vertical torso distance is invariant under yaw rotation
        const verticalTorsoDist = Math.abs(hip3D.y - shoulder3D.y);
        const userTorsoDist = Math.max(verticalTorsoDist, hip3D.distanceTo(shoulder3D) * 0.85);
        const scaleTorso = userTorsoDist / slot.modelTorsoDist;

        const dynamicScale = THREE.MathUtils.clamp(scaleTorso * slot.modelScale * this.scaleModifier, 0.35, 2.8);

        // Root position: Hips are at (hip3D.x, hip3D.y)
        const rootX = hip3D.x;
        const rootY = hip3D.y - (slot.modelHipRestY * dynamicScale) + this.yOffsetModifier;
        const rootZ = this.depthPlane;

        slot.targetPosition.set(rootX, rootY, rootZ);
        slot.targetScale.set(dynamicScale, dynamicScale, dynamicScale);
      }
    }

    // Smoothly interpolate to remove tracking jitter
    slot.currentPosition.lerp(slot.targetPosition, 0.35);
    slot.currentScale.lerp(slot.targetScale, 0.30);

    vrmScene.position.copy(slot.currentPosition);
    vrmScene.scale.copy(slot.currentScale);
  }

  private rigBone(
    vrm: VRM,
    boneName: VRMHumanBoneName,
    rotation: { x: number; y: number; z: number; w?: number; rotationOrder?: string } | undefined,
    dampener: number = 1,
    lerpFactor: number = 0.35
  ): void {
    if (!rotation || !vrm.humanoid) return;
    const boneNode = vrm.humanoid.getNormalizedBoneNode(boneName);
    if (!boneNode) return;

    let targetQuat: THREE.Quaternion;
    if (typeof rotation.w === "number") {
      targetQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    } else {
      const euler = new THREE.Euler(
        rotation.x * dampener,
        rotation.y * dampener,
        rotation.z * dampener,
        (rotation.rotationOrder as any) || "XYZ"
      );
      targetQuat = new THREE.Quaternion().setFromEuler(euler);
    }
    boneNode.quaternion.slerp(targetQuat, lerpFactor);
  }

  /**
   * Applies solved body bone rotations to a specific avatar slot.
   */
  public applySlotPose(slotIndex: number, pose: TPose | undefined, lerpFactor: number = 0.35): void {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.vrm || !pose) return;
    const vrm = slot.vrm;

    // 1. Hips Rotation
    if (pose.Hips && (pose.Hips as any).rotation) {
      this.rigBone(vrm, "hips", (pose.Hips as any).rotation, 1.0, lerpFactor);
    }

    // 2. Torso (Spine & Chest)
    if (pose.Spine) this.rigBone(vrm, "spine", pose.Spine, 1.0, lerpFactor);
    if ((pose as any).Chest) this.rigBone(vrm, "chest", (pose as any).Chest, 1.0, lerpFactor);

    // 3. Head & Neck
    if ((pose as any).Neck) this.rigBone(vrm, "neck", (pose as any).Neck, 1.0, lerpFactor);
    if ((pose as any).Head) this.rigBone(vrm, "head", (pose as any).Head, 1.0, lerpFactor);

    // 4. Arms
    this.rigBone(vrm, "rightUpperArm", pose.RightUpperArm as any, 1.0, lerpFactor);
    this.rigBone(vrm, "rightLowerArm", pose.RightLowerArm as any, 1.0, lerpFactor);
    this.rigBone(vrm, "leftUpperArm", pose.LeftUpperArm as any, 1.0, lerpFactor);
    this.rigBone(vrm, "leftLowerArm", pose.LeftLowerArm as any, 1.0, lerpFactor);

    // 5. Hands fallback
    if (pose.RightHand) this.rigBone(vrm, "rightHand", pose.RightHand, 1.0, lerpFactor);
    if (pose.LeftHand) this.rigBone(vrm, "leftHand", pose.LeftHand, 1.0, lerpFactor);

    // 6. Legs
    this.rigBone(vrm, "rightUpperLeg", pose.RightUpperLeg as any, 1.0, 0.25);
    this.rigBone(vrm, "rightLowerLeg", pose.RightLowerLeg as any, 1.0, 0.25);
    this.rigBone(vrm, "leftUpperLeg", pose.LeftUpperLeg as any, 1.0, 0.25);
    this.rigBone(vrm, "leftLowerLeg", pose.LeftLowerLeg as any, 1.0, 0.25);
  }

  /**
   * Applies precise hand & wrist rotations from 21-point hand tracking to a slot.
   */
  public applySlotHandPose(slotIndex: number, hand: any, side: "Left" | "Right"): void {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.vrm?.humanoid || !hand) return;
    const vrm = slot.vrm;

    const prefix = side === "Left" ? "left" : "right";
    const wristBone = (prefix + "Hand") as VRMHumanBoneName;

    const wristRot = side === "Left" ? hand.LeftWrist : hand.RightWrist;
    if (wristRot) {
      this.rigBone(vrm, wristBone, { x: wristRot.x, y: wristRot.y, z: wristRot.z }, 0.65, 0.4);
    }

    const fingers = ["Thumb", "Index", "Middle", "Ring", "Little"];
    const joints = ["Proximal", "Intermediate", "Distal"];

    for (const f of fingers) {
      for (const j of joints) {
        const key = `${side}${f}${j}`;
        const rot = hand[key];
        if (rot) {
          const boneName = (prefix + f + j) as VRMHumanBoneName;
          this.rigBone(vrm, boneName, rot, 1, 0.35);
        }
      }
    }
  }

  public relaxSlotHandPose(slotIndex: number, side: "Left" | "Right"): void {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.vrm?.humanoid) return;
    const vrm = slot.vrm;

    const prefix = side === "Left" ? "left" : "right";
    const wristBone = (prefix + "Hand") as VRMHumanBoneName;
    this.rigBone(vrm, wristBone, { x: 0, y: 0, z: 0 }, 1, 0.15);

    const fingers = ["Thumb", "Index", "Middle", "Ring", "Little"];
    const joints = ["Proximal", "Intermediate", "Distal"];

    for (const f of fingers) {
      for (const j of joints) {
        const boneName = (prefix + f + j) as VRMHumanBoneName;
        this.rigBone(vrm, boneName, { x: 0, y: 0, z: 0 }, 1, 0.15);
      }
    }
  }

  public render(): void {
    if (this.visualMode === "hidden") {
      this.renderer.clear();
      return;
    }

    const delta = this.clock.getDelta();
    for (const slot of this.slots) {
      if (slot.vrm && slot.active) {
        slot.vrm.update(delta);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  public setVisualMode(mode: AvatarVisualMode, opacity: number = 0.85): void {
    this.visualMode = mode;
    this.currentOpacity = opacity;
    for (const slot of this.slots) {
      this.applyVisualModeToSlot(slot);
    }
  }

  private applyVisualModeToSlot(slot: AvatarSlot): void {
    if (!slot.vrm) return;

    const isGhost = this.visualMode === "ghost";
    const opacity = isGhost ? this.currentOpacity : 1.0;
    const isVisible = this.visualMode !== "hidden" && slot.active;

    slot.vrm.scene.visible = isVisible;

    slot.vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          // Remember the model's own settings the first time, so "full" mode can restore them.
          // Forcing every material opaque breaks alpha-blended parts (beards, lenses, glasses, web lines).
          if (mat.userData.baseTransparent === undefined) {
            mat.userData.baseTransparent = mat.transparent;
            mat.userData.baseOpacity = mat.opacity;
            mat.userData.baseDepthWrite = mat.depthWrite;
          }
          mat.transparent = isGhost || mat.userData.baseTransparent;
          mat.opacity = mat.userData.baseOpacity * opacity;
          mat.depthWrite = isGhost ? true : mat.userData.baseDepthWrite;
        }
      }
    });
  }

  public setScaleModifier(val: number): void {
    this.scaleModifier = THREE.MathUtils.clamp(val, 0.6, 1.6);
  }

  public setYOffsetModifier(val: number): void {
    this.yOffsetModifier = THREE.MathUtils.clamp(val, -0.4, 0.4);
  }

  public get ready(): boolean {
    return this.slots.some((s) => s.isLoaded && s.vrm !== null);
  }

  public get category(): CategoryDefinition | null {
    return this.currentCategory;
  }
}
