import type { Connect, Plugin } from "vite";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

// Download links and the uploaded copies are gone after 24 hours (local copies are kept)
const PHOTO_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
// Every photo is also kept here on the laptop (git-ignored), so none is lost without internet or a QR scan
const LOCAL_PHOTO_DIR = "photos";
// Give up on the cloud after this, so a slow or offline network can't keep the photo screen waiting
const UPLOAD_TIMEOUT_MS = 15_000;

/**
 * Adds POST /api/photo to the Vite dev/preview server. It saves the JPEG to photos/ on this laptop,
 * then uploads it to Supabase Storage and returns a 24-hour download link for the QR code.
 * Both steps are optional: SAVE_PHOTOS_LOCALLY=false turns off the local copy, and without Supabase
 * keys there is no upload. The secret key stays on the laptop: it is read from .env.local here and
 * never sent to the browser.
 *
 * Response: { url?: string, savedLocally: boolean }. No url means there is no QR code for this photo.
 */
export function photoUploadPlugin(env: Record<string, string>): Plugin {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_BUCKET || "photos";
  const saveLocally = env.SAVE_PHOTOS_LOCALLY !== "false";

  const timedFetch: typeof fetch = (input, init) => {
    const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  const supabase = url && key
    ? createClient(url, key, { auth: { persistSession: false }, global: { fetch: timedFetch } })
    : null;
  if (!supabase) {
    const fallback = saveLocally ? `photos are only saved to ${LOCAL_PHOTO_DIR}/` : "and SAVE_PHOTOS_LOCALLY=false, so photos are not kept";
    console.warn(`[photo-upload] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local: no QR codes, ${fallback}`);
  }

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== "/api/photo" || req.method !== "POST") return next();

    const send = (status: number, body: object) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };

    if (!supabase && !saveLocally) return send(503, { error: "Photo saving is turned off", savedLocally: false });

    let photo: Buffer;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_PHOTO_BYTES) return send(413, { error: "Photo too large", savedLocally: false });
        chunks.push(chunk as Buffer);
      }
      photo = Buffer.concat(chunks);
    } catch (err) {
      console.error("[photo-upload] Reading the photo failed:", err);
      return send(400, { error: "Could not read the photo", savedLocally: false });
    }

    // Every JPEG starts with FF D8 FF; anything else didn't come from the mirror
    if (photo.length < 3 || photo[0] !== 0xff || photo[1] !== 0xd8 || photo[2] !== 0xff) {
      return send(400, { error: "Not a JPEG", savedLocally: false });
    }

    // The local copy goes first: it needs no network, so the photo is kept even if the upload fails
    let savedLocally = false;
    if (saveLocally) {
      try {
        await mkdir(LOCAL_PHOTO_DIR, { recursive: true });
        await writeFile(path.join(LOCAL_PHOTO_DIR, localPhotoName(new Date())), photo);
        savedLocally = true;
      } catch (err) {
        console.error(`[photo-upload] Saving to ${LOCAL_PHOTO_DIR}/ failed:`, err);
      }
    }

    if (!supabase) return send(savedLocally ? 200 : 500, { savedLocally });

    try {
      const storagePath = `${Date.now()}-${randomUUID()}.jpg`;
      const upload = await supabase.storage.from(bucket).upload(storagePath, photo, { contentType: "image/jpeg" });
      if (upload.error) throw upload.error;

      // download: makes the phone save the file instead of only displaying it
      const signed = await supabase.storage
        .from(bucket)
        .createSignedUrl(storagePath, PHOTO_LIFETIME_SECONDS, { download: "magic-mirror.jpg" });
      if (signed.error) throw signed.error;

      send(200, { url: signed.data.signedUrl, savedLocally });

      deleteExpiredPhotos(supabase, bucket).catch((err) => console.warn("[photo-upload] Cleanup failed:", err));
    } catch (err) {
      console.error("[photo-upload] Upload failed:", err);
      // Still fine for the student if the local copy exists: the photo screen tells them to ask staff for it
      send(savedLocally ? 200 : 500, { error: "Upload failed", savedLocally });
    }
  };

  return {
    name: "photo-upload",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}

/** A readable name that sorts by time, e.g. magic-mirror_2026-10-05_14-32-07_1a2b3c4d.jpg (local time). */
function localPhotoName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `magic-mirror_${date}_${time}_${randomUUID().slice(0, 8)}.jpg`;
}

async function deleteExpiredPhotos(supabase: SupabaseClient, bucket: string): Promise<void> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list("", { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw error;

  const cutoff = Date.now() - PHOTO_LIFETIME_SECONDS * 1000;
  const expired = data
    .filter((file) => file.created_at && Date.parse(file.created_at) < cutoff)
    .map((file) => file.name);

  if (expired.length > 0) {
    const removal = await supabase.storage.from(bucket).remove(expired);
    if (removal.error) throw removal.error;
  }
}
