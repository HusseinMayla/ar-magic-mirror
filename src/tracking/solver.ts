import * as THREE from "three";
import { Pose as KalidoPose, Hand as KalidoHand, TPose } from "kalidokit";
import { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

/**
 * Pure Forward Kinematics (FK) Swing-Twist arm solver.
 * Calculates exact 3D orientation including full axial shoulder rotation (internal/external twist)
 * and physiological elbow flexion (up to 140 deg) without joint popping or analytical IK instability.
 */
function solveArmFK(
  shoulder: NormalizedLandmark,
  elbow: NormalizedLandmark,
  wrist: NormalizedLandmark | undefined,
  shoulder3D: Landmark | undefined,
  elbow3D: Landmark | undefined,
  wrist3D: Landmark | undefined,
  isLeftAvatarArm: boolean, // true for LeftUpperArm/LeftLowerArm (+X screen-right), false for Right (-X screen-left)
  aspect: number = 1.333,
  torsoYaw: number = 0
): { upperArm: { x: number; y: number; z: number; w: number }; lowerArm: { x: number; y: number; z: number; w: number } } {
  // In standard Three-VRM normalized humanoid:
  // Left arm rest axis points along +X (1, 0, 0), hinge bends around (0, -1, 0)
  // Right arm rest axis points along -X (-1, 0, 0), hinge bends around (0, 1, 0)
  const vRest = isLeftAvatarArm ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
  const hRest = isLeftAvatarArm ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
  const hLocal = isLeftAvatarArm ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);

  // In mirrored view (CSS scaleX(-1)):
  // Screen-right is +X, Up is +Y, Forward (toward camera) is +Z
  const ux = -(elbow.x - shoulder.x) * aspect;
  const uy = elbow.y - shoulder.y;
  const rawUz = shoulder3D && elbow3D ? -(elbow3D.z - shoulder3D.z) : 0;
  const uz = rawUz * 0.35;

  const u = new THREE.Vector3(ux, uy, uz);
  if (u.lengthSq() < 1e-6) {
    u.set(isLeftAvatarArm ? 0.05 : -0.05, 1, 0);
  }
  u.normalize();

  // Transform arm vector into chest local coordinate space by counter-rotating by torsoYaw
  if (torsoYaw !== 0) {
    u.applyAxisAngle(new THREE.Vector3(0, 1, 0), -torsoYaw);
  }

  let f: THREE.Vector3 | null = null;
  if (wrist) {
    const fx = -(wrist.x - elbow.x) * aspect;
    const fy = wrist.y - elbow.y;
    const rawFz = wrist3D && elbow3D ? -(wrist3D.z - elbow3D.z) : 0;
    
    // In monocular 2D camera feeds, MediaPipe has a forward-depth bias when elbows flex,
    // pulling coronal poses (like double biceps) 45 deg forward.
    // Damping rawFz by 0.35 and prioritizing true 2D vertical span allows the forearm to reach full verticality.
    const fz = rawFz * 0.35;
    const fVec = new THREE.Vector3(fx, fy, fz);
    if (fVec.lengthSq() > 1e-6) {
      f = fVec.normalize();
      if (torsoYaw !== 0) {
        f.applyAxisAngle(new THREE.Vector3(0, 1, 0), -torsoYaw);
      }
    }
  }

  // 1. Swing Rotation (shortest arc from rest bone axis to tracked direction u)
  const qSwing = new THREE.Quaternion().setFromUnitVectors(vRest, u);

  // 2. Elbow Flexion & Shoulder Axial Twist
  let thetaFlex = 0;
  let qTwist = new THREE.Quaternion();

  if (f) {
    const dot = THREE.MathUtils.clamp(u.dot(f), -1, 1);
    // Physiological elbow bend [0, 2.45 rad (~140 deg)]
    thetaFlex = Math.min(Math.max(Math.acos(dot), 0), 2.45);

    if (thetaFlex > 0.12) {
      // Normal to the arm plane (hinge bend axis)
      const nArm = new THREE.Vector3().crossVectors(u, f).normalize();
      const hSwung = hRest.clone().applyQuaternion(qSwing).normalize();

      // Signed angle from hSwung to nArm around the upper arm axis u
      const cosPhi = THREE.MathUtils.clamp(hSwung.dot(nArm), -1, 1);
      const crossH = new THREE.Vector3().crossVectors(hSwung, nArm);
      const sinPhi = crossH.dot(u);
      const phi = Math.atan2(sinPhi, cosPhi);

      // Smoothly blend in axial twist as the elbow bends (avoids singularity when arm is straight)
      const blend = THREE.MathUtils.clamp((thetaFlex - 0.12) / 0.2, 0, 1);
      qTwist.setFromAxisAngle(u, phi * blend);
    }
  }

  // Final upper arm orientation: Axial Twist * Directional Swing
  const qUpper = qTwist.clone().multiply(qSwing);

  // Final lower arm orientation: Pure hinge flexion around local elbow axis
  const qLower = new THREE.Quaternion().setFromAxisAngle(hLocal, thetaFlex);

  return {
    upperArm: { x: qUpper.x, y: qUpper.y, z: qUpper.z, w: qUpper.w },
    lowerArm: { x: qLower.x, y: qLower.y, z: qLower.z, w: qLower.w }
  };
}

export class KinematicsSolver {
  public static solve(
    worldLandmarks: Landmark[] | undefined,
    landmarks: NormalizedLandmark[] | undefined,
    video: HTMLVideoElement | null = null
  ): TPose | undefined {
    if (
      !worldLandmarks ||
      !landmarks ||
      worldLandmarks.length < 33 ||
      landmarks.length < 33
    ) {
      return undefined;
    }

    try {
      const lShoulder = landmarks[11];
      const rShoulder = landmarks[12];
      const lElbow = landmarks[13];
      const rElbow = landmarks[14];
      const lWrist = landmarks[15];
      const rWrist = landmarks[16];
      const lHip = landmarks[23];
      const rHip = landmarks[24];
      const lKnee = landmarks[25];
      const rKnee = landmarks[26];
      const lAnkle = landmarks[27];
      const rAnkle = landmarks[28];

      const lShoulder3D = worldLandmarks[11];
      const rShoulder3D = worldLandmarks[12];
      const lElbow3D = worldLandmarks[13];
      const rElbow3D = worldLandmarks[14];
      const lWrist3D = worldLandmarks[15];
      const rWrist3D = worldLandmarks[16];
      const lHip3D = worldLandmarks[23];
      const rHip3D = worldLandmarks[24];

      const lArmVis = (lShoulder?.visibility ?? 1) > 0.3 && (lElbow?.visibility ?? 1) > 0.3;
      const rArmVis = (rShoulder?.visibility ?? 1) > 0.3 && (rElbow?.visibility ?? 1) > 0.3;
      const lWristVis = (lWrist?.visibility ?? 1) > 0.3 && lWrist.y >= 0.01 && lWrist.y <= 0.99;
      const rWristVis = (rWrist?.visibility ?? 1) > 0.3 && rWrist.y >= 0.01 && rWrist.y <= 0.99;
      const hipsVis = (lHip?.visibility ?? 1) > 0.35 && (rHip?.visibility ?? 1) > 0.35;
      const shouldersVis = (lShoulder?.visibility ?? 1) > 0.35 && (rShoulder?.visibility ?? 1) > 0.35;

      // 1. Calculate kinematics for hips using Kalidokit
      const hips = KalidoPose.calcHips(worldLandmarks as any, landmarks as any);

      // Lower-body landmark reliability & visibility checks (Fix 6: Pin legs when jittering / seated / out of frame)
      const lKneeVis = (lKnee?.visibility ?? 0) >= 0.45 && lKnee.y < 0.96;
      const rKneeVis = (rKnee?.visibility ?? 0) >= 0.45 && rKnee.y < 0.96;
      const lAnkleVis = (lAnkle?.visibility ?? 0) >= 0.35 && lAnkle.y < 0.98;
      const rAnkleVis = (rAnkle?.visibility ?? 0) >= 0.35 && rAnkle.y < 0.98;

      const leftLegReliable = hipsVis && lKneeVis && lAnkleVis;
      const rightLegReliable = hipsVis && rKneeVis && rAnkleVis;

      let leftUpperLegRot: any = { x: 0, y: 0, z: 0 };
      let leftLowerLegRot: any = { x: 0, y: 0, z: 0 };
      let rightUpperLegRot: any = { x: 0, y: 0, z: 0 };
      let rightLowerLegRot: any = { x: 0, y: 0, z: 0 };

      if (leftLegReliable || rightLegReliable) {
        const solvedLegs = KalidoPose.calcLegs(worldLandmarks as any);
        if (solvedLegs) {
          if (leftLegReliable && solvedLegs.UpperLeg?.l && solvedLegs.LowerLeg?.l) {
            const u = solvedLegs.UpperLeg.l;
            const l = solvedLegs.LowerLeg.l;
            // Upright standing deadband: if user is standing naturally straight,
            // pin small oscillations (< 0.08 rad) to 0 to eliminate fabric jitter.
            const isUpright = Math.abs(u.x) < 0.08 && Math.abs(u.z) < 0.08 && Math.abs(l.x) < 0.12;
            if (!isUpright) {
              leftUpperLegRot = u;
              leftLowerLegRot = l;
            }
          }

          if (rightLegReliable && solvedLegs.UpperLeg?.r && solvedLegs.LowerLeg?.r) {
            const u = solvedLegs.UpperLeg.r;
            const l = solvedLegs.LowerLeg.r;
            const isUpright = Math.abs(u.x) < 0.08 && Math.abs(u.z) < 0.08 && Math.abs(l.x) < 0.12;
            if (!isUpright) {
              rightUpperLegRot = u;
              rightLowerLegRot = l;
            }
          }
        }
      }

      // 2. Video Aspect Ratio
      const aspect = (video && video.videoWidth && video.videoHeight)
        ? video.videoWidth / video.videoHeight
        : 1.333;

      // 3. Stabilized Torso, Spine, Chest, and Head Kinematics:
      // Derive natural yaw, pitch, and roll for hips, chest, and head from 3D depth and landmarks.
      let spineRot = { x: 0, y: 0, z: 0 };
      let chestRot = { x: 0, y: 0, z: 0 };
      let hipsRot = { x: 0, y: 0, z: 0 };
      let neckRot = { x: 0, y: 0, z: 0 };
      let headRot = { x: 0, y: 0, z: 0 };

      let shoulderYaw = 0;
      let hipYaw = 0;
      let spineTiltZ = 0;
      let spinePitchX = 0;

      if (hipsVis && shouldersVis) {
        const hipMidX = (lHip.x + rHip.x) * 0.5;
        const hipMidY = (lHip.y + rHip.y) * 0.5;
        const shoulderMidX = (lShoulder.x + rShoulder.x) * 0.5;
        const shoulderMidY = (lShoulder.y + rShoulder.y) * 0.5;

        // In mirrored view:
        const torsoDx = -(shoulderMidX - hipMidX) * aspect;
        const torsoDy = -(shoulderMidY - hipMidY); // Up is positive

        // Lateral torso tilt (Roll): responds to genuine spinal bending
        const trueTiltZ = Math.atan2(torsoDx, Math.max(torsoDy, 0.05));
        spineTiltZ = THREE.MathUtils.clamp(trueTiltZ * 0.75, -0.6, 0.6);

        // Pelvis / Hip Yaw (amplified depth difference for full turning range)
        if (lHip3D && rHip3D) {
          const hipDz = -(lHip3D.z - rHip3D.z) * 1.5;
          const hipDx = Math.max(Math.abs(lHip3D.x - rHip3D.x), 0.08);
          hipYaw = THREE.MathUtils.clamp(Math.atan2(hipDz, hipDx), -1.4, 1.4);
        }

        // Shoulder / Upper-Body Yaw (amplified depth difference for full turning range)
        if (lShoulder3D && rShoulder3D) {
          const shoulderDz = -(lShoulder3D.z - rShoulder3D.z) * 1.5;
          const shoulderDx = Math.max(Math.abs(lShoulder3D.x - rShoulder3D.x), 0.08);
          shoulderYaw = THREE.MathUtils.clamp(Math.atan2(shoulderDz, shoulderDx), -1.5, 1.5);
        } else {
          shoulderYaw = hipYaw;
        }

        // Spine pitch (forward / backward tilt)
        if (lHip3D && rHip3D && lShoulder3D && rShoulder3D) {
          const hipMidZ = (lHip3D.z + rHip3D.z) * 0.5;
          const shoulderMidZ = (lShoulder3D.z + rShoulder3D.z) * 0.5;
          const torsoDz = -(shoulderMidZ - hipMidZ);
          const truePitchX = Math.atan2(torsoDz, Math.max(torsoDy, 0.05));
          spinePitchX = THREE.MathUtils.clamp(truePitchX * 0.6, -0.4, 0.4);
        }

        // Distribute rotations hierarchically across Hips -> Spine -> Chest:
        // Hips gets full pelvis rotation
        hipsRot.y = hipYaw * 0.85 + (shoulderYaw - hipYaw) * 0.15;
        hipsRot.x = spinePitchX * 0.2;
        hipsRot.z = spineTiltZ * 0.2;

        // Remaining torso twist to reach full shoulder orientation
        const remainingTorsoYaw = shoulderYaw - hipsRot.y;
        spineRot.y = remainingTorsoYaw * 0.45;
        spineRot.x = spinePitchX * 0.4;
        spineRot.z = spineTiltZ * 0.4;

        chestRot.y = remainingTorsoYaw * 0.55;
        chestRot.x = spinePitchX * 0.4;
        chestRot.z = spineTiltZ * 0.4;
      }

      // 4. Head & Neck Tracking (Landmarks 0: nose, 7: left ear, 8: right ear)
      const nose = landmarks[0];
      const lEar = landmarks[7];
      const rEar = landmarks[8];
      const lEar3D = worldLandmarks[7];
      const rEar3D = worldLandmarks[8];

      const faceVis = (nose?.visibility ?? 1) > 0.35 && (lEar?.visibility ?? 1) > 0.25 && (rEar?.visibility ?? 1) > 0.25;

      if (faceVis) {
        // 1. Head Yaw (Turning left / right)
        const earMidX = (lEar.x + rEar.x) * 0.5;
        const earDist2D = Math.max(lEar.x - rEar.x, 0.04);
        const noseOffset2D = -(nose.x - earMidX) / earDist2D; // Normalized offset ~[-1, 1]

        let headYaw = shoulderYaw;
        if (lEar3D && rEar3D) {
          const earDz = -(lEar3D.z - rEar3D.z);
          const earDx = Math.max(Math.abs(lEar3D.x - rEar3D.x), 0.10);
          const earYaw3D = Math.atan2(earDz, earDx);
          headYaw = THREE.MathUtils.clamp(earYaw3D * 0.5 + (noseOffset2D * 1.1) * 0.5, -1.3, 1.3);
        } else {
          headYaw = THREE.MathUtils.clamp(noseOffset2D * 1.1, -1.3, 1.3);
        }

        // 2. Head Pitch (Nodding up / down: +X is pitch down, -X is pitch up)
        const earMidY = (lEar.y + rEar.y) * 0.5;
        const rawPitch = (nose.y - earMidY) * 3.5;
        const headPitch = THREE.MathUtils.clamp(rawPitch, -0.6, 0.6);

        // 3. Head Roll (Tilting head sideways: lEar is to the right of rEar in video space -> earDx2D is positive)
        const earDx2D = Math.max((lEar.x - rEar.x) * aspect, 0.04);
        const earDy = -(lEar.y - rEar.y);
        const headRoll = THREE.MathUtils.clamp(Math.atan2(earDy, earDx2D), -0.6, 0.6);

        // Neck & Head are children of Chest (which already inherits shoulderYaw, spinePitchX, spineTiltZ)
        const relHeadYaw = headYaw - shoulderYaw;
        const relHeadPitch = headPitch - spinePitchX;
        const relHeadRoll = headRoll - spineTiltZ;

        neckRot = {
          x: relHeadPitch * 0.3,
          y: relHeadYaw * 0.35,
          z: relHeadRoll * 0.3,
        };

        headRot = {
          x: relHeadPitch * 0.7,
          y: relHeadYaw * 0.65,
          z: relHeadRoll * 0.7,
        };
      }

      // 5. Swing-Twist Forward Kinematics for Arms (Mirror-View Matched):
      // - Student physical Right Arm (Landmarks 12, 14, 16) -> Screen-Right (+X) -> Avatar LeftUpperArm / LeftLowerArm
      // - Student physical Left Arm (Landmarks 11, 13, 15) -> Screen-Left (-X) -> Avatar RightUpperArm / RightLowerArm

      // Default resting arm rotations (hanging straight down at sides).
      // solveArmFK treats +Y as down (image y grows downward), so these match its swing of the rest axis onto (0, 1, 0).
      let leftUpperArmRot: any = { x: 0, y: 0, z: 0.7071, w: 0.7071 }; // +90 deg on Z (hangs down)
      let leftLowerArmRot: any = { x: 0, y: 0, z: 0, w: 1 };
      let rightUpperArmRot: any = { x: 0, y: 0, z: -0.7071, w: 0.7071 }; // -90 deg on Z (hangs down)
      let rightLowerArmRot: any = { x: 0, y: 0, z: 0, w: 1 };

      if (rArmVis) {
        const solvedRightArm = solveArmFK(
          rShoulder,
          rElbow,
          rWristVis ? rWrist : undefined,
          rShoulder3D,
          rElbow3D,
          rWristVis ? rWrist3D : undefined,
          true, // avatar LeftArm (Screen-Right)
          aspect,
          shoulderYaw
        );
        leftUpperArmRot = solvedRightArm.upperArm;
        leftLowerArmRot = solvedRightArm.lowerArm;
      }

      if (lArmVis) {
        const solvedLeftArm = solveArmFK(
          lShoulder,
          lElbow,
          lWristVis ? lWrist : undefined,
          lShoulder3D,
          lElbow3D,
          lWristVis ? lWrist3D : undefined,
          false, // avatar RightArm (Screen-Left)
          aspect,
          shoulderYaw
        );
        rightUpperArmRot = solvedLeftArm.upperArm;
        rightLowerArmRot = solvedLeftArm.lowerArm;
      }

      return {
        RightUpperArm: rightUpperArmRot,
        RightLowerArm: rightLowerArmRot,
        LeftUpperArm: leftUpperArmRot,
        LeftLowerArm: leftLowerArmRot,
        RightHand: { x: 0, y: 0, z: 0 } as any,
        LeftHand: { x: 0, y: 0, z: 0 } as any,
        RightUpperLeg: rightUpperLegRot,
        RightLowerLeg: rightLowerLegRot,
        LeftUpperLeg: leftUpperLegRot,
        LeftLowerLeg: leftLowerLegRot,
        Hips: { ...hips.Hips, rotation: hipsRot as any },
        Spine: spineRot as any,
        Chest: chestRot as any,
        Neck: neckRot as any,
        Head: headRot as any,
      } as any;
    } catch (err) {
      console.warn("[KinematicsSolver] Pose solve exception:", err);
      return undefined;
    }
  }

  public static solveHand(
    handLandmarks: NormalizedLandmark[] | undefined,
    avatarSide: "Left" | "Right"
  ): any {
    if (!handLandmarks || handLandmarks.length < 21) {
      return undefined;
    }
    try {
      // In mirrored display space (transform: scaleX(-1)), the avatar is our mirror reflection:
      // User's physical Right hand -> avatar Left hand (Screen-Right, +X)
      // User's physical Left hand -> avatar Right hand (Screen-Left, -X)
      const physicalSide: "Left" | "Right" = avatarSide === "Left" ? "Right" : "Left";

      // Solve using genuine, unmirrored hand landmarks with its physical side.
      // This preserves normal vectors, cross-products, and palm geometry without chirality corruption.
      const rawHand = KalidoHand.solve(handLandmarks as any, physicalSide);
      if (!rawHand) return undefined;

      const mirroredHand: any = {};
      const rawWrist = (rawHand as any)[`${physicalSide}Wrist`];
      if (rawWrist) {
        // In mirror reflection:
        // - Pitch (X) is symmetric (up/down flexion unchanged)
        // - Roll (Y) inverts (clockwise twist becomes counter-clockwise)
        // - Yaw (Z) inverts (lateral tilt stays outward from torso)
        mirroredHand[`${avatarSide}Wrist`] = {
          x: rawWrist.x,
          y: -rawWrist.y,
          z: -rawWrist.z,
        };
      }

      const digits = ["Thumb", "Index", "Middle", "Ring", "Little"];
      const segments = ["Proximal", "Intermediate", "Distal"];

      for (const digit of digits) {
        for (const seg of segments) {
          const rawKey = `${physicalSide}${digit}${seg}`;
          const targetKey = `${avatarSide}${digit}${seg}`;
          const rawRot = (rawHand as any)[rawKey];
          if (rawRot) {
            // In VRM humanoid:
            // Standard left arm rest axis is +X, right arm rest axis is -X.
            // Finger flexion around local Z axis has opposite signs between Left and Right hands.
            // Inverting Z ensures that finger curling inward on user's hand curls inward on avatar.
            mirroredHand[targetKey] = {
              x: rawRot.x,
              y: -rawRot.y,
              z: -rawRot.z,
            };
          }
        }
      }

      return mirroredHand;
    } catch (err) {
      console.warn("[KinematicsSolver] Hand solve error:", err);
      return undefined;
    }
  }
}
