import { supabase } from "./supabase";

const BUCKET = "post-images";
const MAX_BYTES = 5 * 1024 * 1024; // mirrors the bucket's file_size_limit

// True when the URL can be rendered with <img>: a direct image file or a
// public object in our bucket. Google Drive share links fail this check and
// are shown as plain links instead (the pre-upload workflow).
export function isRenderableImage(url: string | null): url is string {
  if (!url) return false;
  return (
    /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(url) ||
    url.includes(`/storage/v1/object/public/${BUCKET}/`)
  );
}

// Uploads into the shared post-images bucket under `${prefix}/…`. Posts use
// their post id as the prefix; articles use their article id.
async function uploadImage(prefix: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (PNG, JPG, GIF or WebP).");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image is too large — max 5 MB.");
  }
  const path = `${prefix}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export function uploadPostImage(postId: string, file: File): Promise<string> {
  return uploadImage(postId, file);
}

export function uploadArticleImage(articleId: string, file: File): Promise<string> {
  return uploadImage(`article-${articleId}`, file);
}
