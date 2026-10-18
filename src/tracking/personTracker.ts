import { Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface TrackedPerson {
  slotIndex: number;
  active: boolean;
  confidence: number;
  torsoScale: number; // screen-space torso length (depth/proximity proxy: larger = closer)
  landmarks: NormalizedLandmark[];
  worldLandmarks: Landmark[];
}

export interface PersonTrackerOptions {
  minConfidence?: number;
  maxPeople?: number;
  gracePeriodFrames?: number;
  minConsecutiveFrames?: number;
}

interface InternalSlot {
  slotIndex: number;
  active: boolean;
  consecutiveSeen: number;
  framesMissing: number;
  lastCentroid: { x: number; y: number };
  lastTorsoScale: number;
  lastConfidence: number;
  lastLandmarks: NormalizedLandmark[];
  lastWorldLandmarks: Landmark[];
}

export class PersonIdentityTracker {
  private minConfidence: number = 0.70;
  private maxPeople: number = 4;
  private gracePeriodFrames: number = 6; // Retain outfit for 6 frames (~200ms) on momentary drop
  private minConsecutiveFrames: number = 2; // Require 2 consistent frames before showing to prevent glitch flickers

  private slots: InternalSlot[] = [];

  constructor(options?: PersonTrackerOptions) {
    if (options?.minConfidence !== undefined) this.minConfidence = options.minConfidence;
    if (options?.maxPeople !== undefined) this.maxPeople = options.maxPeople;
    if (options?.gracePeriodFrames !== undefined) this.gracePeriodFrames = options.gracePeriodFrames;
    if (options?.minConsecutiveFrames !== undefined) this.minConsecutiveFrames = options.minConsecutiveFrames;

    for (let i = 0; i < 4; i++) {
      this.slots.push({
        slotIndex: i,
        active: false,
        consecutiveSeen: 0,
        framesMissing: 999,
        lastCentroid: { x: 0.5, y: 0.5 },
        lastTorsoScale: 0.3,
        lastConfidence: 0,
        lastLandmarks: [],
        lastWorldLandmarks: []
      });
    }
  }

  public updateSettings(options: PersonTrackerOptions): void {
    if (options.minConfidence !== undefined) this.minConfidence = options.minConfidence;
    if (options.maxPeople !== undefined) this.maxPeople = Math.min(4, Math.max(1, options.maxPeople));
    if (options.gracePeriodFrames !== undefined) this.gracePeriodFrames = options.gracePeriodFrames;
    if (options.minConsecutiveFrames !== undefined) this.minConsecutiveFrames = options.minConsecutiveFrames;
  }

  /**
   * Processes all raw detected poses from MediaPipe, associates identities,
   * handles hysteresis, filters out far/low-confidence people, and returns top tracked people.
   */
  public update(
    allLandmarks: NormalizedLandmark[][] | undefined,
    allWorldLandmarks: Landmark[][] | undefined
  ): TrackedPerson[] {
    const rawPoses: Array<{
      landmarks: NormalizedLandmark[];
      worldLandmarks: Landmark[];
      centroid: { x: number; y: number };
      torsoScale: number;
      confidence: number;
    }> = [];

    if (allLandmarks && allLandmarks.length > 0) {
      for (let i = 0; i < allLandmarks.length; i++) {
        const lms = allLandmarks[i];
        const wLms = allWorldLandmarks?.[i] || [];
        if (!lms || lms.length < 25) continue;

        const leftShoulder = lms[11];
        const rightShoulder = lms[12];
        const leftHip = lms[23];
        const rightHip = lms[24];

        // Overall key-joint confidence
        const keyVis = [
          leftShoulder?.visibility ?? 0,
          rightShoulder?.visibility ?? 0,
          leftHip?.visibility ?? 0,
          rightHip?.visibility ?? 0
        ];
        const avgConfidence = keyVis.reduce((a, b) => a + b, 0) / keyVis.length;

        // Strict confidence gate
        if (avgConfidence < this.minConfidence) continue;

        // Centroid & scale computation
        const shoulderMidX = (leftShoulder.x + rightShoulder.x) * 0.5;
        const shoulderMidY = (leftShoulder.y + rightShoulder.y) * 0.5;
        const hipMidX = (leftHip.x + rightHip.x) * 0.5;
        const hipMidY = (leftHip.y + rightHip.y) * 0.5;

        const centroid = {
          x: (shoulderMidX + hipMidX) * 0.5,
          y: (shoulderMidY + hipMidY) * 0.5
        };

        const torsoScale = Math.hypot(shoulderMidX - hipMidX, shoulderMidY - hipMidY);

        // Discard impossibly tiny poses (passerby far in the background)
        if (torsoScale < 0.08) continue;

        rawPoses.push({
          landmarks: lms,
          worldLandmarks: wLms,
          centroid,
          torsoScale,
          confidence: avgConfidence
        });
      }
    }

    // 1. Enforce spatial exclusivity: remove duplicate detections of the same person
    const deduplicatedPoses: typeof rawPoses = [];
    for (const pose of rawPoses) {
      const isDuplicate = deduplicatedPoses.some((existing) => {
        const d = Math.hypot(existing.centroid.x - pose.centroid.x, existing.centroid.y - pose.centroid.y);
        return d < 0.12; // within 12% screen distance
      });
      if (!isDuplicate) {
        deduplicatedPoses.push(pose);
      }
    }

    // 2. Sort by proximity to camera (torsoScale descending: largest/closest first)
    deduplicatedPoses.sort((a, b) => b.torsoScale - a.torsoScale);

    // Limit to allowed maxPeople
    const topDetections = deduplicatedPoses.slice(0, this.maxPeople);

    // 3. Spatial Identity Association:
    // Match current top detections to existing active/recent slots using greedy nearest-neighbor
    const matchedSlotIndices = new Set<number>();
    const matchedDetectionIndices = new Set<number>();

    // Pass A: Match existing active slots with highest spatial continuity
    for (let slotIdx = 0; slotIdx < 4; slotIdx++) {
      const slot = this.slots[slotIdx];
      if (!slot.active && slot.framesMissing > this.gracePeriodFrames) continue;

      let bestDetIdx = -1;
      let minCost = Infinity;

      for (let detIdx = 0; detIdx < topDetections.length; detIdx++) {
        if (matchedDetectionIndices.has(detIdx)) continue;
        const det = topDetections[detIdx];

        const spatialDist = Math.hypot(det.centroid.x - slot.lastCentroid.x, det.centroid.y - slot.lastCentroid.y);
        const scaleDiff = Math.abs(det.torsoScale - slot.lastTorsoScale);
        const cost = spatialDist + scaleDiff * 0.5;

        // Max matching tolerance: 0.35 normalized screen distance
        if (cost < 0.35 && cost < minCost) {
          minCost = cost;
          bestDetIdx = detIdx;
        }
      }

      if (bestDetIdx !== -1) {
        const matched = topDetections[bestDetIdx];
        matchedDetectionIndices.add(bestDetIdx);
        matchedSlotIndices.add(slotIdx);

        // Reject rapid impossible motion jumps (>0.4 screen width in 1 frame)
        const jumpDist = Math.hypot(matched.centroid.x - slot.lastCentroid.x, matched.centroid.y - slot.lastCentroid.y);
        if (jumpDist > 0.42 && slot.active) {
          // Clamp jump towards new centroid rather than instant teleport
          matched.centroid.x = slot.lastCentroid.x + (matched.centroid.x - slot.lastCentroid.x) * 0.35;
          matched.centroid.y = slot.lastCentroid.y + (matched.centroid.y - slot.lastCentroid.y) * 0.35;
        }

        slot.active = true;
        slot.framesMissing = 0;
        slot.consecutiveSeen++;
        slot.lastCentroid = matched.centroid;
        slot.lastTorsoScale = matched.torsoScale;
        slot.lastConfidence = matched.confidence;
        slot.lastLandmarks = matched.landmarks;
        slot.lastWorldLandmarks = matched.worldLandmarks;
      }
    }

    // Pass B: Assign unmatched new detections to empty slots
    for (let detIdx = 0; detIdx < topDetections.length; detIdx++) {
      if (matchedDetectionIndices.has(detIdx)) continue;
      const det = topDetections[detIdx];

      // Find first inactive slot
      let availableSlot: InternalSlot | null = null;
      for (const slot of this.slots) {
        if (!slot.active && slot.framesMissing > this.gracePeriodFrames && !matchedSlotIndices.has(slot.slotIndex)) {
          availableSlot = slot;
          break;
        }
      }

      if (availableSlot) {
        matchedDetectionIndices.add(detIdx);
        matchedSlotIndices.add(availableSlot.slotIndex);

        availableSlot.consecutiveSeen++;
        availableSlot.framesMissing = 0;
        availableSlot.lastCentroid = det.centroid;
        availableSlot.lastTorsoScale = det.torsoScale;
        availableSlot.lastConfidence = det.confidence;
        availableSlot.lastLandmarks = det.landmarks;
        availableSlot.lastWorldLandmarks = det.worldLandmarks;

        // Activate once minimum consecutive consistent frames are reached
        if (availableSlot.consecutiveSeen >= this.minConsecutiveFrames) {
          availableSlot.active = true;
        }
      }
    }

    // Pass C: Handle missing frames for unassociated slots (Hysteresis Grace Period)
    for (const slot of this.slots) {
      if (!matchedSlotIndices.has(slot.slotIndex)) {
        slot.framesMissing++;
        if (slot.framesMissing > this.gracePeriodFrames) {
          slot.active = false;
          slot.consecutiveSeen = 0;
        }
      }
    }

    // 4. Build output active tracked person list
    const results: TrackedPerson[] = [];
    for (const slot of this.slots) {
      if (slot.active && slot.slotIndex < this.maxPeople) {
        results.push({
          slotIndex: slot.slotIndex,
          active: true,
          confidence: slot.lastConfidence,
          torsoScale: slot.lastTorsoScale,
          landmarks: slot.lastLandmarks,
          worldLandmarks: slot.lastWorldLandmarks
        });
      }
    }

    return results;
  }

  public get peopleLimit(): number {
    return this.maxPeople;
  }
}
